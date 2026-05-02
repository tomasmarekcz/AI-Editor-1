import { generateEffects } from '@/lib/generateEffects';
import { requireAccountApi } from '@/lib/accounts';
import { enforceCostGuardrails } from '@/lib/safetyGuardrails';
import { enforcePaidPlan } from '@/lib/planGuardrails';
import type { SegmentData } from '@/types';

export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  try {
    const auth = await requireAccountApi();
    if (!auth.ok) return auth.response;

    const plan = enforcePaidPlan(auth.account, 'effects');
    if (!plan.ok) return plan.response;

    const safety = await enforceCostGuardrails(auth.supabase, 'effects');
    if (!safety.ok) return safety.response!;

    const { segments } = (await req.json()) as { segments: SegmentData[] };
    if (!segments?.length) {
      return Response.json({ error: 'segments required' }, { status: 400 });
    }

    const effects = await generateEffects(segments);
    return Response.json({ effects });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[effects]', message);
    // Fallback: all none
    return Response.json({ effects: [] });
  }
}
