import fs from 'fs';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';
import type { SupabaseClient } from '@supabase/supabase-js';
import { requireAccountApi } from '@/lib/accounts';
import { renderVideo } from '@/lib/renderVideo';
import {
  uploadLocalAsset,
  createSignedUrl,
  downloadAssetBlob,
  VIDEO_ASSETS_BUCKET,
} from '@/lib/storage/videoAssets';
import { searchImageCandidateDetails } from '@/lib/searchImages';
import { downloadImage } from '@/lib/downloadImage';
import { generateWithOpenAIImage, OPENAI_IMAGE_MODEL } from '@/lib/generateWithOpenAIImage';
import { rankGoogleImageCandidates } from '@/lib/selectGoogleImageCandidate';
import { enforceGenerationGuardrails } from '@/lib/safetyGuardrails';
import { enforcePaidPlan } from '@/lib/planGuardrails';
import { insertUsageEvents, summarizeCostLines } from '@/lib/usage/record';
import { costGeminiText, costOpenAIImage2Low, PRICING, openAIImage2Usage, roundCost, type CostLine } from '@/lib/pricing';
import type { SegmentData, VideoSettings, ImageGenMode } from '@/types';

export const maxDuration = 300;
export const dynamic = 'force-dynamic';

async function downloadVideoAsset(supabase: SupabaseClient, storagePath: string) {
  return downloadAssetBlob(supabase, storagePath);
}

const publicLocalPathToAbsolute = (localPath: string): string => {
  const normalized = localPath.startsWith('/') ? localPath.slice(1) : localPath;
  return path.join(process.cwd(), 'public', normalized);
};

const localImageExists = (localImagePath: string | undefined): boolean => {
  if (!localImagePath) return false;
  try {
    const stat = fs.statSync(publicLocalPathToAbsolute(localImagePath));
    return stat.isFile() && stat.size > 1024;
  } catch {
    return false;
  }
};

type RenderEvent =
  | { type: 'step'; message: string }
  | { type: 'progress'; progress: number }
  | { type: 'done'; videoUrl: string }
  | { type: 'error'; message: string };

export async function POST(req: Request, { params }: { params: { id: string } }) {
  const auth = await requireAccountApi();
  if (!auth.ok) return auth.response;
  const { supabase, user, account } = auth;

  const plan = enforcePaidPlan(account, 'videos/rerender');
  if (!plan.ok) return plan.response;

  const safety = await enforceGenerationGuardrails(supabase, 'videos/rerender');
  if (!safety.ok) return safety.response!;

  const videoId = params.id;

  const { data: video } = await supabase
    .from('videos')
    .select('id,project_id,settings,segments,edited_settings,edited_segments')
    .eq('id', videoId)
    .eq('account_id', account.id)
    .maybeSingle();

  if (!video) return Response.json({ error: 'Video not found' }, { status: 404 });

  const settings = ((video.edited_settings ?? video.settings) as Partial<VideoSettings>) as VideoSettings;
  const rawSegments = (video.edited_segments ?? video.segments) as Array<SegmentData & { _removed?: boolean; _regenerateImage?: boolean }>;

  // Filter removed segments
  const segments = rawSegments.filter((s) => !s._removed);
  const projectId = video.project_id as string;

  const stream = new ReadableStream({
    async start(controller) {
      const send = (event: RenderEvent) => {
        try {
          controller.enqueue(new TextEncoder().encode(`data: ${JSON.stringify(event)}\n\n`));
        } catch { /* stream closed */ }
      };

      try {
        // ── Step 1: Download audio from storage ───────────────────────────
        send({ type: 'step', message: 'Načítám audio...' });

        const { data: audioAsset } = await supabase
          .from('video_assets')
          .select('storage_path')
          .eq('video_id', videoId)
          .eq('kind', 'audio')
          .maybeSingle();

        if (!audioAsset?.storage_path) throw new Error('Audio asset not found. Re-render requires original audio.');

        const audioBytes = await downloadVideoAsset(supabase, audioAsset.storage_path);

        if (!audioBytes) throw new Error('Failed to download audio from storage.');

        const tmpDir = path.join(process.cwd(), 'public', 'tmp', 'audio');
        fs.mkdirSync(tmpDir, { recursive: true });
        const tmpAudioPath = path.join(tmpDir, `rerender_${videoId}.mp3`);
        fs.writeFileSync(tmpAudioPath, Buffer.from(await audioBytes.arrayBuffer()));
        const audioRelPath = `/tmp/audio/rerender_${videoId}.mp3`;

        // ── Step 2: Resolve images ─────────────────────────────────────────
        send({ type: 'step', message: 'Připravuji obrázky...' });

        const { data: imageAssets } = await supabase
          .from('video_assets')
          .select('segment_index,storage_path,source')
          .eq('video_id', videoId)
          .in('kind', ['image', 'uploaded_image'])
          .order('segment_index', { ascending: true });

        const imagesByIndex: Record<number, string> = {};
        for (const asset of (imageAssets ?? [])) {
          if (asset.segment_index != null && asset.storage_path) {
            imagesByIndex[asset.segment_index] = asset.storage_path;
          }
        }

        const imgTmpDir = path.join(process.cwd(), 'public', 'tmp', 'images');
        fs.mkdirSync(imgTmpDir, { recursive: true });

        // Original segment index mapping (before any removals/patches)
        const originalSegments = (video.segments as SegmentData[]) ?? [];
        const fullScript = segments.map((segment) => segment.text).join(' ');

        const resolvedSegments: SegmentData[] = [];
        const usage = {
          regeneratedImages: 0,
          imagenImages: 0,
          serperQueries: 0,
          googleImageSelections: 0,
        };

        for (let i = 0; i < segments.length; i++) {
          const seg = segments[i];
          // Find original index to look up asset by segment_index
          const origIdx = originalSegments.findIndex((s) => s.id === seg.id);
          const assetIdx = origIdx >= 0 ? origIdx : i;

          let localImagePath: string | undefined;

          if (localImageExists(seg.localImagePath)) {
            localImagePath = seg.localImagePath;
          } else if ((seg as SegmentData & { _regenerateImage?: boolean })._regenerateImage && seg.imagePrompt) {
            // Regenerate image
            send({ type: 'step', message: `Regeneruji obrázek pro scénu ${i + 1}...` });
            const fileId = `${seg.id}_r${Date.now()}`;
            let mode: ImageGenMode = (seg.imageGenMode ?? settings.imageSource as ImageGenMode) === 'imagen' ? 'imagen' : 'google';
            try {
              if (mode === 'imagen') {
                localImagePath = await generateWithOpenAIImage(seg.imagePrompt, fileId, settings.orientation ?? 'vertical');
                usage.imagenImages += 1;
              } else {
                const candidates = await searchImageCandidateDetails(seg.imagePrompt, 10);
                usage.serperQueries += 1;
                const ranked = await rankGoogleImageCandidates(
                  candidates,
                  seg.text,
                  fullScript,
                  settings.orientation ?? 'vertical',
                );
                usage.googleImageSelections += 1;
                localImagePath = await downloadImage(ranked.map((candidate) => candidate.imageUrl), fileId);
              }
              usage.regeneratedImages += 1;
            } catch (err) {
              console.warn('[rerender image]', err);
              localImagePath = undefined;
            }
          }

          if (!localImagePath && imagesByIndex[assetIdx]) {
            // Download existing image from storage
            const storagePath = imagesByIndex[assetIdx];
            const ext = path.extname(storagePath) || '.jpg';
            const localFilename = `rerender_${videoId}_${assetIdx}${ext}`;
            const localAbsPath = path.join(imgTmpDir, localFilename);

            if (!fs.existsSync(localAbsPath)) {
              const imgBytes = await downloadVideoAsset(supabase, storagePath);
              if (imgBytes) {
                fs.writeFileSync(localAbsPath, Buffer.from(await imgBytes.arrayBuffer()));
              }
            }
            if (fs.existsSync(localAbsPath)) {
              localImagePath = `/tmp/images/${localFilename}`;
            }
          }

          const { _removed, _regenerateImage, ...cleanSeg } = seg as SegmentData & { _removed?: boolean; _regenerateImage?: boolean };
          void _removed; void _regenerateImage;
          resolvedSegments.push({ ...cleanSeg, localImagePath, imageUrl: undefined });
        }

        // ── Step 3: Render ─────────────────────────────────────────────────
        send({ type: 'step', message: 'Renderuji video...' });

        const jobId = uuidv4();
        const videoLocalPath = await renderVideo(
          resolvedSegments,
          jobId,
          settings,
          audioRelPath,
          (pct) => send({ type: 'progress', progress: pct }),
        );

        // ── Step 4: Upload edited video ────────────────────────────────────
        send({ type: 'step', message: 'Nahrávám editované video...' });

        const editedAsset = await uploadLocalAsset({
          supabase,
          userId: user.id,
          projectId,
          videoId,
          folder: 'edited',
          localPath: videoLocalPath,
          filename: 'final.mp4',
        });

        // Upsert edited_final_video asset
        await supabase.from('video_assets').upsert(
          {
            user_id: user.id,
            account_id: account.id,
            project_id: projectId,
            video_id: videoId,
            kind: 'final_video',
            storage_bucket: VIDEO_ASSETS_BUCKET,
            storage_provider: editedAsset.storageProvider,
            storage_path: editedAsset.storagePath,
            mime_type: editedAsset.mimeType,
            size_bytes: editedAsset.sizeBytes,
            metadata: { type: 'edited', jobId },
          },
          { onConflict: 'video_id,kind,storage_path' },
        );

        await supabase
          .from('videos')
          .update({
            edited_segments: resolvedSegments,
            edited_video_path: editedAsset.storagePath,
            edited_video_size_bytes: editedAsset.sizeBytes,
            regenerated_images_count: usage.regeneratedImages,
            serper_queries_count: usage.serperQueries,
          })
          .eq('id', videoId);

        const costLines: CostLine[] = [];
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
            usage: openAIImage2Usage(usage.imagenImages, settings.orientation ?? 'vertical'),
            costUsd: costOpenAIImage2Low(usage.imagenImages, settings.orientation ?? 'vertical'),
          });
        }
        await insertUsageEvents({
          supabase,
          userId: user.id,
          accountId: account.id,
          projectId,
          videoId,
          lines: costLines,
          estimated: false,
        });
        if (costLines.length > 0) {
          const { data: actualEvents } = await supabase
            .from('usage_events')
            .select('provider,model,step,usage,cost_usd')
            .eq('video_id', videoId)
            .eq('estimated', false);
          const allActualLines: CostLine[] = (actualEvents ?? []).map((event) => ({
            provider: String(event.provider),
            model: event.model ? String(event.model) : undefined,
            step: String(event.step),
            usage: (event.usage ?? {}) as Record<string, number | string | boolean>,
            costUsd: Number(event.cost_usd ?? 0),
          }));
          await supabase
            .from('videos')
            .update({
              actual_cost_usd: roundCost(allActualLines.reduce((sum, line) => sum + line.costUsd, 0)),
              cost_breakdown: { actual: summarizeCostLines(allActualLines) },
            })
            .eq('id', videoId)
            .eq('account_id', account.id);
        }

        const signedUrl = await createSignedUrl(supabase, editedAsset.storagePath, 14400);
        send({ type: 'done', videoUrl: signedUrl ?? '' });

        // Cleanup tmp files
        try {
          fs.unlinkSync(tmpAudioPath);
        } catch { /* ignore */ }

      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.error('[rerender]', message);
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
