import type { SupabaseClient } from '@supabase/supabase-js';
import type { CostLine } from '@/lib/pricing';

export async function insertUsageEvents({
  supabase,
  userId,
  accountId,
  projectId,
  videoId,
  lines,
  estimated,
}: {
  supabase: SupabaseClient;
  userId: string;
  accountId?: string;
  projectId: string;
  videoId: string;
  lines: CostLine[];
  estimated: boolean;
}) {
  if (lines.length === 0) return;
  await supabase.from('usage_events').insert(lines.map((line) => ({
    user_id: userId,
    account_id: accountId,
    project_id: projectId,
    video_id: videoId,
    provider: line.provider,
    model: line.model ?? null,
    step: line.step,
    usage: line.usage,
    cost_usd: line.costUsd,
    estimated,
  })));
}

export function summarizeCostLines(lines: CostLine[]) {
  const byProvider: Record<string, number> = {};
  const byStep: Record<string, number> = {};
  for (const line of lines) {
    byProvider[line.provider] = (byProvider[line.provider] ?? 0) + line.costUsd;
    byStep[line.step] = (byStep[line.step] ?? 0) + line.costUsd;
  }
  return { byProvider, byStep, lines };
}
