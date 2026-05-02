import { searchImageCandidateDetails } from '@/lib/searchImages';
import { downloadImage } from '@/lib/downloadImage';
import { generateWithImagen } from '@/lib/generateWithImagen';
import { rankGoogleImageCandidates } from '@/lib/selectGoogleImageCandidate';
import { requireAccountApi } from '@/lib/accounts';
import { enforceCostGuardrails } from '@/lib/safetyGuardrails';
import { enforcePaidPlan } from '@/lib/planGuardrails';
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

    const { segmentId, prompt, mode, orientation } = (await req.json()) as {
      segmentId: string;
      prompt: string;
      mode: ImageGenMode;
      orientation: Orientation;
    };

    if (!segmentId || !prompt || !mode) {
      return Response.json({ error: 'segmentId, prompt and mode are required' }, { status: 400 });
    }

    // Use a unique file ID so the new image never collides with the cached old one
    const fileId = `${segmentId}_r${Date.now()}`;

    let localImagePath: string;
    let usedMode: ImageGenMode = mode;

    if (mode === 'google') {
      const candidates = await searchImageCandidateDetails(prompt, 10);
      const ranked = await rankGoogleImageCandidates(
        candidates,
        prompt,
        prompt,
        orientation ?? 'vertical',
      );
      localImagePath = await downloadImage(ranked.map((candidate) => candidate.imageUrl), fileId);
    } else {
      // Try Imagen, fall back to Google if unavailable
      try {
        localImagePath = await generateWithImagen(prompt, fileId, orientation ?? 'vertical');
      } catch (imagenErr) {
        const msg = imagenErr instanceof Error ? imagenErr.message : String(imagenErr);
        console.warn(`[regenerate] Imagen failed (${msg}), falling back to Google`);
        const searchQuery = prompt.split(',')[0].slice(0, 80).trim();
        const candidates = await searchImageCandidateDetails(searchQuery, 10);
        const ranked = await rankGoogleImageCandidates(
          candidates,
          prompt,
          prompt,
          orientation ?? 'vertical',
        );
        localImagePath = await downloadImage(ranked.map((candidate) => candidate.imageUrl), fileId);
        usedMode = 'google';
      }
    }

    return Response.json({ localImagePath, usedMode });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[images/regenerate]', message);
    return Response.json({ error: message }, { status: 500 });
  }
}
