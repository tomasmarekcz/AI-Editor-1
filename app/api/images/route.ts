import { generateImagePlans } from '@/lib/generateImagePlans';
import { searchImageCandidateDetails } from '@/lib/searchImages';
import { downloadImage } from '@/lib/downloadImage';
import { generateWithImagen } from '@/lib/generateWithImagen';
import { reviewImage } from '@/lib/reviewImage';
import { rankGoogleImageCandidates } from '@/lib/selectGoogleImageCandidate';
import { costGeminiText, PRICING, roundCost, type CostLine } from '@/lib/pricing';
import { insertUsageEvents } from '@/lib/usage/record';
import { requireAccountApi } from '@/lib/accounts';
import { enforceCostGuardrails } from '@/lib/safetyGuardrails';
import { enforcePaidPlan } from '@/lib/planGuardrails';
import type { SegmentData, VideoSettings, ImageSource, ImageGenMode } from '@/types';

export const maxDuration = 180;
export const dynamic = 'force-dynamic';

const MAX_REVIEW_ATTEMPTS = 3;

export async function POST(req: Request) {
  const { segments, settings, projectId, videoId } = (await req.json()) as {
    segments: SegmentData[];
    settings: Pick<VideoSettings, 'imageSource' | 'orientation'>;
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
        const usage = { serperQueries: 0, imagenImages: 0, generatedImages: 0, googleImageSelections: 0 };
        const source = settings.imageSource as Exclude<ImageSource, 'upload'>;

        // ── Step 1: Gemini generates search queries / image prompts ──────────
        send({ type: 'step', message: 'Gemini připravuje dotazy pro obrázky...' });

        let plans;
        try {
          plans = await generateImagePlans(segments, source, settings.orientation);
          const inputTokens = Math.ceil(segments.map((s) => s.text).join('\n').length / 4) + 700;
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
          const fallbackMode: ImageGenMode = source === 'google' ? 'google' : 'imagen';
          plans = segments.map((s) => ({ mode: fallbackMode, prompt: s.keywords }));
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
                  // Imagen 4 with automatic Google fallback
                  try {
                    localImagePath = await generateWithImagen(
                      currentPrompt, seg.id, settings.orientation,
                    );
                    usage.imagenImages += 1;
                  } catch (imagenErr) {
                    const msg = imagenErr instanceof Error ? imagenErr.message : String(imagenErr);
                    console.warn(`[images ${i}] Imagen failed (${msg}), falling back to Google`);
                    // Use keywords for Google fallback — verbose Imagen prompts return nothing on Google
                    const googleQuery = seg.keywords || seg.text.slice(0, 60);
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
                if (localImagePath) {
                  send({ type: 'reviewing', index: i, attempt: attempt + 1 });

                  try {
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
              };
              if (localImagePath) usage.generatedImages += 1;

              send({
                type: 'image_ready',
                index: i,
                imageUrl: localImagePath,
                prompt: currentPrompt,
                mode: usedMode,
                attempts: attempt + 1,
              });

            } catch (err) {
              const errorMsg = err instanceof Error ? err.message : String(err);
              console.error(`[images ${i}]`, errorMsg);
              updated[i] = {
                ...updated[i],
                imagePrompt: currentPrompt,
                imageGenMode: usedMode,
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
              provider: 'google',
              model: 'imagen-4.0-generate-001',
              step: 'image_generation',
              usage: { images: usage.imagenImages },
              costUsd: roundCost(usage.imagenImages * PRICING.google['imagen-4.0-generate-001'].usdPerImage),
            });
          }
          costLines.push({
            provider: 'google',
            model: 'gemini-2.5-flash-lite',
            step: 'image_review',
            usage: { estimatedReviews: usage.generatedImages, estimatedInputTokens: usage.generatedImages * 450, estimatedOutputTokens: usage.generatedImages * 50 },
            costUsd: costGeminiText(usage.generatedImages * 450, usage.generatedImages * 50),
          });
          await insertUsageEvents({ supabase, userId: user.id, accountId: account.id, projectId, videoId, lines: costLines, estimated: false });
          await supabase
            .from('videos')
            .update({
              segments: updated,
              generated_images_count: usage.generatedImages,
              serper_queries_count: usage.serperQueries,
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
