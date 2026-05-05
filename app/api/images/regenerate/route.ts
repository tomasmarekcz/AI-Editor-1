import { searchImageCandidateDetails } from '@/lib/searchImages';
import { downloadImage } from '@/lib/downloadImage';
import { generateWithImagen } from '@/lib/generateWithImagen';
import { rankGoogleImageCandidates } from '@/lib/selectGoogleImageCandidate';
import { requireAccountApi } from '@/lib/accounts';
import { enforceCostGuardrails } from '@/lib/safetyGuardrails';
import { enforcePaidPlan } from '@/lib/planGuardrails';
import { insertUsageEvents, summarizeCostLines } from '@/lib/usage/record';
import { costGeminiText, PRICING, roundCost, type CostLine } from '@/lib/pricing';
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

    const { segmentId, prompt, mode, orientation, projectId, videoId } = (await req.json()) as {
      segmentId: string;
      prompt: string;
      mode: ImageGenMode;
      orientation: Orientation;
      projectId?: string;
      videoId?: string;
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
      // Try Imagen, fall back to Google if unavailable
      try {
        localImagePath = await generateWithImagen(prompt, fileId, orientation ?? 'vertical');
        usage.imagenImages += 1;
      } catch (imagenErr) {
        const msg = imagenErr instanceof Error ? imagenErr.message : String(imagenErr);
        console.warn(`[regenerate] Imagen failed (${msg}), falling back to Google`);
        const searchQuery = prompt.split(',')[0].slice(0, 80).trim();
        const candidates = await searchImageCandidateDetails(searchQuery, 10);
        usage.serperQueries += 1;
        const ranked = await rankGoogleImageCandidates(
          candidates,
          prompt,
          prompt,
          orientation ?? 'vertical',
        );
        usage.googleImageSelections += 1;
        localImagePath = await downloadImage(ranked.map((candidate) => candidate.imageUrl), fileId);
        usedMode = 'google';
      }
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
            provider: 'google',
            model: 'imagen-4.0-generate-001',
            step: 'image_generation',
            usage: { images: usage.imagenImages },
            costUsd: roundCost(usage.imagenImages * PRICING.google['imagen-4.0-generate-001'].usdPerImage),
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
