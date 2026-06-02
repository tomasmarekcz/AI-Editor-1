import path from 'path';
import { generateImagePlans } from '@/lib/generateImagePlans';
import { searchImageCandidateDetails } from '@/lib/searchImages';
import { downloadImage } from '@/lib/downloadImage';
import { generateWithOpenAIImage, OPENAI_IMAGE_MODEL } from '@/lib/generateWithOpenAIImage';
import { reviewImage } from '@/lib/reviewImage';
import { rankGoogleImageCandidates } from '@/lib/selectGoogleImageCandidate';
import { costGeminiText, costOpenAIImage2Low, PRICING, openAIImage2Usage, roundCost, type CostLine } from '@/lib/pricing';
import { insertUsageEvents } from '@/lib/usage/record';
import { requireAccountApi } from '@/lib/accounts';
import { enforceCostGuardrails } from '@/lib/safetyGuardrails';
import { enforcePaidPlan } from '@/lib/planGuardrails';
import {
  createStorageAdminClient,
  uploadLocalAsset,
  VIDEO_ASSETS_BUCKET,
} from '@/lib/storage/videoAssets';
import type { SegmentData, VideoSettings, ImageSource, ImageGenMode } from '@/types';

export const maxDuration = 600;
export const dynamic = 'force-dynamic';

const MAX_REVIEW_ATTEMPTS = 3;

export async function POST(req: Request) {
  const { segments, settings, projectId, videoId } = (await req.json()) as {
    segments: SegmentData[];
    settings: Pick<VideoSettings, 'imageSource' | 'orientation'> & Partial<Pick<VideoSettings, 'aiImageReview'>>;
    projectId?: string;
    videoId?: string;
  };

  if (!segments?.length) {
    return Response.json({ error: 'segments required' }, { status: 400 });
  }

  const auth = await requireAccountApi();
  if (!auth.ok) return auth.response;
  const { supabase, user, account } = auth;

  const plan = enforcePaidPlan(account, 'images');
  if (!plan.ok) return plan.response;

  const safety = await enforceCostGuardrails(supabase, 'images');
  if (!safety.ok) return safety.response!;

  let projectVisualStyle = '';

  if (projectId) {
    const { data: project } = await supabase
      .from('projects')
      .select('visual_style')
      .eq('id', projectId)
      .eq('account_id', account.id)
      .maybeSingle<{ visual_style: string | null }>();

    projectVisualStyle = project?.visual_style ?? '';
  }

  if (projectId && videoId) {
    const { data: video } = await supabase
      .from('videos')
      .select('id')
      .eq('id', videoId)
      .eq('project_id', projectId)
      .eq('account_id', account.id)
      .maybeSingle();
    if (!video) return Response.json({ error: 'Video not found' }, { status: 404 });
  }

  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      const send = (ev: Record<string, unknown>) => {
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(ev)}\n\n`));
        } catch { /* client disconnected */ }
      };

      try {
        const costLines: CostLine[] = [];
        const usage = { serperQueries: 0, imagenImages: 0, generatedImages: 0, googleImageSelections: 0, imageReviews: 0 };
        const source = settings.imageSource as Exclude<ImageSource, 'upload'>;
        const aiImageReview = settings.aiImageReview !== false;

        // ── Step 1: Gemini generates search queries / image prompts ──────────
        send({ type: 'step', message: 'Gemini připravuje dotazy pro obrázky...' });

        let plans;
        try {
          plans = await generateImagePlans(segments, source, settings.orientation, projectVisualStyle);
          const inputTokens = Math.ceil((segments.map((s) => s.text).join('\n').length * (source === 'hybrid' ? 1 : segments.length)) / 4) + 2000;
          const outputTokens = Math.ceil(JSON.stringify(plans).length / 4);
          costLines.push({
            provider: 'google',
            model: 'gemini-2.5-flash-lite',
            step: 'image_planning',
            usage: { estimatedInputTokens: inputTokens, estimatedOutputTokens: outputTokens, segments: segments.length },
            costUsd: costGeminiText(inputTokens, outputTokens),
          });
        } catch (err) {
          console.error('[images/plans]', err);
          const fallbackMode: ImageGenMode = source === 'imagen' ? 'imagen' : 'google';
          plans = segments.map((s) => ({
            mode: fallbackMode,
            prompt: fallbackMode === 'imagen'
              ? `Photorealistic cinematic documentary still, ${s.text}, realistic environment, emotional atmosphere, dramatic composition, natural lighting, no text, no logos`
              : s.keywords,
          }));
        }

        send({ type: 'plans_ready', plans });

        // Full script text — passed to reviewer for context
        const fullScript = segments.map((s) => s.text).join(' ');

        // ── Step 2: Fetch / generate + review images in parallel ─────────────
        send({ type: 'step', message: `Připravuji ${segments.length} obrázků...` });

        const updated: SegmentData[] = segments.map((s) => ({ ...s }));

        await Promise.all(
          segments.map(async (seg, i) => {
            const plan = plans[i];
            let localImagePath: string | undefined;
            let usedMode: ImageGenMode = plan.mode;
            let currentPrompt = plan.prompt;
            let fallbackReason: string | undefined;
            let attempt = 0;
            let approved = false;

            try {
              // ── Review loop: up to MAX_REVIEW_ATTEMPTS ────────────────────
              while (attempt < MAX_REVIEW_ATTEMPTS && !approved) {
                // ── Fetch or generate the image ──────────────────────────────
                if (usedMode === 'google') {
                  const candidates = await searchImageCandidateDetails(currentPrompt, 10);
                  usage.serperQueries += 1;
                  const ranked = await rankGoogleImageCandidates(
                    candidates,
                    seg.text,
                    fullScript,
                    settings.orientation,
                  );
                  usage.googleImageSelections += 1;
                  localImagePath = await downloadImage(ranked.map((candidate) => candidate.imageUrl), seg.id);
                } else {
                  // AI generation. In pure AI mode, keep the mode strict; hybrid may fall back.
                  try {
                    localImagePath = await generateWithOpenAIImage(
                      currentPrompt, seg.id, settings.orientation,
                    );
                    usage.imagenImages += 1;
                  } catch (aiImageErr) {
                    if (source !== 'hybrid') throw aiImageErr;

                    const msg = aiImageErr instanceof Error ? aiImageErr.message : String(aiImageErr);
                    console.warn(`[images ${i}] AI image generation failed (${msg}), falling back to Google`);
                    // Use keywords for Google fallback because verbose AI prompts return weak Google results.
                    const googleQuery = seg.keywords || seg.text.slice(0, 60);
                    fallbackReason = 'AI generation failed; Google fallback was used.';
                    const candidates = await searchImageCandidateDetails(googleQuery, 10);
                    usage.serperQueries += 1;
                    const ranked = await rankGoogleImageCandidates(
                      candidates,
                      seg.text,
                      fullScript,
                      settings.orientation,
                    );
                    usage.googleImageSelections += 1;
                    localImagePath = await downloadImage(ranked.map((candidate) => candidate.imageUrl), seg.id);
                    usedMode = 'google';
                    currentPrompt = googleQuery;
                  }
                }

                // ── AI review via Gemini + Files API ────────────────────────
                if (localImagePath && aiImageReview) {
                  send({ type: 'reviewing', index: i, attempt: attempt + 1 });

                  try {
                    usage.imageReviews += 1;
                    const review = await reviewImage(
                      localImagePath,
                      seg.text,
                      fullScript,
                      usedMode,
                      currentPrompt,
                    );

                    if (review.approved) {
                      approved = true;
                      console.log(`[images ${i}] ✓ approved on attempt ${attempt + 1}`);
                    } else {
                      console.log(
                        `[images ${i}] ✗ rejected (attempt ${attempt + 1}): ${review.reason ?? ''}`,
                        '→ new prompt:', review.newPrompt,
                      );
                      // Apply reviewer's suggested prompt for next iteration
                      if (review.newPrompt) {
                        currentPrompt = review.newPrompt;
                      }
                      attempt++;
                    }
                  } catch (reviewErr) {
                    // Review itself failed (network, quota, etc.) — approve by default
                    console.warn(`[images ${i}] review error (attempt ${attempt + 1}):`, reviewErr);
                    approved = true; // don't block on reviewer failure
                  }
                } else if (localImagePath) {
                  approved = true;
                } else {
                  // No image fetched at all — give up this attempt
                  attempt++;
                }
              }

              // ── Done (approved or max attempts) ──────────────────────────
              updated[i] = {
                ...updated[i],
                localImagePath,
                imagePrompt: currentPrompt,
                imageGenMode: usedMode,
                imageFallbackReason: fallbackReason,
              };
              if (localImagePath && usedMode === 'imagen') usage.generatedImages += 1;

              send({
                type: 'image_ready',
                index: i,
                imageUrl: localImagePath,
                prompt: currentPrompt,
                mode: usedMode,
                fallbackReason,
                attempts: attempt + 1,
              });

            } catch (err) {
              const errorMsg = err instanceof Error ? err.message : String(err);
              console.error(`[images ${i}]`, errorMsg);
              updated[i] = {
                ...updated[i],
                imagePrompt: currentPrompt,
                imageGenMode: usedMode,
                imageFallbackReason: fallbackReason,
              };
              send({
                type: 'image_failed',
                index: i,
                prompt: currentPrompt,
                mode: usedMode,
                error: errorMsg,
              });
            }
          }),
        );

        if (projectId && videoId) {
          if (usage.serperQueries > 0) {
            costLines.push({
              provider: 'serper',
              step: 'image_search',
              usage: { queries: usage.serperQueries },
              costUsd: roundCost(usage.serperQueries * PRICING.serper.imagesSearchUsdPerQuery),
            });
          }
          if (usage.googleImageSelections > 0) {
            costLines.push({
              provider: 'google',
              model: 'gemini-2.5-flash-lite',
              step: 'image_selection',
              usage: {
                estimatedSelections: usage.googleImageSelections,
                estimatedInputTokens: usage.googleImageSelections * 900,
                estimatedOutputTokens: usage.googleImageSelections * 40,
              },
              costUsd: costGeminiText(usage.googleImageSelections * 900, usage.googleImageSelections * 40),
            });
          }
          if (usage.imagenImages > 0) {
            costLines.push({
              provider: 'openai',
              model: OPENAI_IMAGE_MODEL,
              step: 'image_generation',
              usage: openAIImage2Usage(usage.imagenImages, settings.orientation),
              costUsd: costOpenAIImage2Low(usage.imagenImages, settings.orientation),
            });
          }
          if (usage.imageReviews > 0) {
            costLines.push({
              provider: 'google',
              model: 'gemini-2.5-flash-lite',
              step: 'image_review',
              usage: { estimatedReviews: usage.imageReviews, estimatedInputTokens: usage.imageReviews * 450, estimatedOutputTokens: usage.imageReviews * 50 },
              costUsd: costGeminiText(usage.imageReviews * 450, usage.imageReviews * 50),
            });
          }
          await insertUsageEvents({ supabase, userId: user.id, accountId: account.id, projectId, videoId, lines: costLines, estimated: false });

          const assetClient = createStorageAdminClient() ?? supabase;
          const imageAssetRows = [];
          for (const [index, segment] of updated.entries()) {
            if (!segment.localImagePath) continue;
            try {
              const imageAsset = await uploadLocalAsset({
                supabase: assetClient,
                userId: user.id,
                projectId,
                videoId,
                folder: 'images',
                localPath: segment.localImagePath,
                filename: `${String(index + 1).padStart(2, '0')}-${segment.id}-${Date.now()}${path.extname(segment.localImagePath) || '.jpg'}`,
              });
              imageAssetRows.push({
                user_id: user.id,
                account_id: account.id,
                project_id: projectId,
                video_id: videoId,
                kind: 'image',
                segment_id: segment.id,
                segment_index: index,
                storage_bucket: VIDEO_ASSETS_BUCKET,
                storage_provider: imageAsset.storageProvider,
                storage_path: imageAsset.storagePath,
                mime_type: imageAsset.mimeType,
                size_bytes: imageAsset.sizeBytes,
                prompt: segment.imagePrompt ?? null,
                source: segment.imageGenMode ?? source,
                metadata: {
                  text: segment.text,
                  keywords: segment.keywords,
                  localImagePath: segment.localImagePath,
                  fallbackReason: segment.imageFallbackReason,
                  generatedDuring: 'preview',
                },
              });
            } catch (assetErr) {
              console.warn(`[images asset ${index}]`, assetErr);
            }
          }
          if (imageAssetRows.length > 0) {
            const dbClient = createStorageAdminClient() ?? supabase;
            await dbClient.from('video_assets').insert(imageAssetRows);
          }

          await supabase
            .from('videos')
            .update({
              status: 'processing_images',
              current_step: 'images_saved',
              segments: updated,
              generated_images_count: usage.generatedImages,
              serper_queries_count: usage.serperQueries,
              updated_at: new Date().toISOString(),
            })
            .eq('id', videoId)
            .eq('account_id', account.id);
        }

        send({ type: 'done', segments: updated });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.error('[images]', message);
        send({ type: 'error', message });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    },
  });
}
