import path from 'path';
import { searchImageCandidateDetails } from '@/lib/searchImages';
import { downloadImage } from '@/lib/downloadImage';
import { generateWithOpenAIImage, OPENAI_IMAGE_MODEL } from '@/lib/generateWithOpenAIImage';
import { rankGoogleImageCandidates } from '@/lib/selectGoogleImageCandidate';
import { requireAccountApi } from '@/lib/accounts';
import { enforceCostGuardrails } from '@/lib/safetyGuardrails';
import { enforcePaidPlan } from '@/lib/planGuardrails';
import { insertUsageEvents, summarizeCostLines } from '@/lib/usage/record';
import { costGeminiText, costOpenAIImage2Low, PRICING, openAIImage2Usage, roundCost, type CostLine } from '@/lib/pricing';
import {
  createStorageAdminClient,
  uploadLocalAsset,
  VIDEO_ASSETS_BUCKET,
} from '@/lib/storage/videoAssets';
import type { ImageGenMode, Orientation } from '@/types';

export const maxDuration = 60;
export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  try {
    const auth = await requireAccountApi();
    if (!auth.ok) return auth.response;

    const plan = enforcePaidPlan(auth.account, 'images/regenerate');
    if (!plan.ok) return plan.response;

    const safety = await enforceCostGuardrails(auth.supabase, 'images/regenerate');
    if (!safety.ok) return safety.response!;

    const { segmentId, prompt, mode, orientation, projectId, videoId, segmentIndex } = (await req.json()) as {
      segmentId: string;
      prompt: string;
      mode: ImageGenMode;
      orientation: Orientation;
      projectId?: string;
      videoId?: string;
      segmentIndex?: number;
    };

    if (!segmentId || !prompt || !mode) {
      return Response.json({ error: 'segmentId, prompt and mode are required' }, { status: 400 });
    }

    // Use a unique file ID so the new image never collides with the cached old one
    const fileId = `${segmentId}_r${Date.now()}`;

    let localImagePath: string;
    let usedMode: ImageGenMode = mode;
    const usage = { serperQueries: 0, googleImageSelections: 0, imagenImages: 0 };

    if (mode === 'google') {
      const candidates = await searchImageCandidateDetails(prompt, 10);
      usage.serperQueries += 1;
      const ranked = await rankGoogleImageCandidates(
        candidates,
        prompt,
        prompt,
        orientation ?? 'vertical',
      );
      usage.googleImageSelections += 1;
      localImagePath = await downloadImage(ranked.map((candidate) => candidate.imageUrl), fileId);
    } else {
      localImagePath = await generateWithOpenAIImage(prompt, fileId, orientation ?? 'vertical');
      usage.imagenImages += 1;
    }

    if (projectId && videoId) {
      const { data: video } = await auth.supabase
        .from('videos')
        .select('id')
        .eq('id', videoId)
        .eq('project_id', projectId)
        .eq('account_id', auth.account.id)
        .maybeSingle();

      if (video) {
        if (Number.isInteger(segmentIndex)) {
          const assetClient = createStorageAdminClient() ?? auth.supabase;
          const imageAsset = await uploadLocalAsset({
            supabase: assetClient,
            userId: auth.user.id,
            projectId,
            videoId,
            folder: 'images',
            localPath: localImagePath,
            filename: `${String(segmentIndex! + 1).padStart(2, '0')}-${segmentId}-regen-${Date.now()}${path.extname(localImagePath) || '.jpg'}`,
          });
          const dbClient = createStorageAdminClient() ?? auth.supabase;
          await dbClient.from('video_assets').insert({
            user_id: auth.user.id,
            account_id: auth.account.id,
            project_id: projectId,
            video_id: videoId,
            kind: 'image',
            segment_id: segmentId,
            segment_index: segmentIndex,
            storage_bucket: VIDEO_ASSETS_BUCKET,
            storage_path: imageAsset.storagePath,
            mime_type: imageAsset.mimeType,
            size_bytes: imageAsset.sizeBytes,
            prompt,
            source: usedMode,
            metadata: {
              localImagePath,
              generatedDuring: 'regenerate',
            },
          });
        }

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
            usage: openAIImage2Usage(usage.imagenImages, orientation ?? 'vertical'),
            costUsd: costOpenAIImage2Low(usage.imagenImages, orientation ?? 'vertical'),
          });
        }
        await insertUsageEvents({
          supabase: auth.supabase,
          userId: auth.user.id,
          accountId: auth.account.id,
          projectId,
          videoId,
          lines: costLines,
          estimated: false,
        });

        if (costLines.length > 0) {
          const { data: actualEvents } = await auth.supabase
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
          await auth.supabase
            .from('videos')
            .update({
              actual_cost_usd: roundCost(allActualLines.reduce((sum, line) => sum + line.costUsd, 0)),
              cost_breakdown: { actual: summarizeCostLines(allActualLines) },
            })
            .eq('id', videoId)
            .eq('account_id', auth.account.id);
        }
      }
    }

    return Response.json({ localImagePath, usedMode });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[images/regenerate]', message);
    return Response.json({ error: message }, { status: 500 });
  }
}
