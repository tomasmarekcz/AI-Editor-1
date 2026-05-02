import type { SupabaseClient } from '@supabase/supabase-js';
import { sendAdminAlert } from '@/lib/adminAlerts';
import { createAdminClient } from '@/lib/supabase/server';

export const COST_SAFETY_MESSAGE = 'Cost safety limit reached. Please try again later.';
export const RENDER_SAFETY_MESSAGE = 'Render safety limit reached. Please try again later.';

const COST_LIMITS = [
  { window: 'hourly', ms: 60 * 60 * 1000, maxUsd: 4 },
  { window: 'daily', ms: 24 * 60 * 60 * 1000, maxUsd: 10 },
  { window: 'weekly', ms: 7 * 24 * 60 * 60 * 1000, maxUsd: 20 },
] as const;

const RENDER_LIMITS = [
  { window: 'hourly', ms: 60 * 60 * 1000, maxRenders: 10 },
  { window: 'daily', ms: 24 * 60 * 60 * 1000, maxRenders: 50 },
  { window: 'weekly', ms: 7 * 24 * 60 * 60 * 1000, maxRenders: 100 },
] as const;

const COUNTED_STATUSES = [
  'queued',
  'processing',
  'generating',
  'processing_images',
  'generating_images',
  'generating_voice',
  'transcribing',
  'rendering',
  'uploading',
  'done',
];

type GuardrailResult = {
  ok: boolean;
  response?: Response;
};

export async function enforceCostGuardrails(supabase: SupabaseClient, action: string): Promise<GuardrailResult> {
  const safetyClient = getSafetyClient(supabase);
  const rows = await fetchRecentVideoCosts(safetyClient, COST_LIMITS[COST_LIMITS.length - 1].ms);

  for (const limit of COST_LIMITS) {
    const sinceMs = Date.now() - limit.ms;
    const spend = rows
      .filter((row) => new Date(row.created_at).getTime() >= sinceMs)
      .reduce((sum, row) => sum + Number(row.actual_cost_usd ?? row.estimated_cost_usd ?? 0), 0);

    if (spend >= limit.maxUsd) {
      const technicalMessage = `Cost safety limit reached: ${limit.window} spend is above $${limit.maxUsd}.`;
      console.warn(`[safety] ${technicalMessage}`, { action, spend });
      await sendAdminAlert({
        key: `cost:${limit.window}`,
        subject: `Cost safety limit reached (${limit.window})`,
        message: technicalMessage,
        details: { action, spendUsd: spend, limitUsd: limit.maxUsd },
      });
      return { ok: false, response: Response.json({ error: COST_SAFETY_MESSAGE }, { status: 403 }) };
    }
  }

  return { ok: true };
}

export async function enforceRenderGuardrails(
  supabase: SupabaseClient,
  action: string,
  excludeVideoId?: string,
): Promise<GuardrailResult> {
  const safetyClient = getSafetyClient(supabase);
  for (const limit of RENDER_LIMITS) {
    const since = new Date(Date.now() - limit.ms).toISOString();
    let query = safetyClient
      .from('videos')
      .select('id', { count: 'exact', head: true })
      .gte('created_at', since)
      .in('status', COUNTED_STATUSES);
    if (excludeVideoId) query = query.neq('id', excludeVideoId);

    const { count, error } = await query;

    if (error) {
      console.error('[safety] render count lookup failed:', error.message);
      continue;
    }

    const renders = count ?? 0;
    if (renders >= limit.maxRenders) {
      const technicalMessage = `Render safety limit reached: ${limit.window} renders are above ${limit.maxRenders}.`;
      console.warn(`[safety] ${technicalMessage}`, { action, renders });
      await sendAdminAlert({
        key: `render:${limit.window}`,
        subject: `Render safety limit reached (${limit.window})`,
        message: technicalMessage,
        details: { action, renders, limit: limit.maxRenders },
      });
      return { ok: false, response: Response.json({ error: RENDER_SAFETY_MESSAGE }, { status: 403 }) };
    }
  }

  return { ok: true };
}

export async function enforceGenerationGuardrails(supabase: SupabaseClient, action: string, excludeVideoId?: string) {
  const cost = await enforceCostGuardrails(supabase, action);
  if (!cost.ok) return cost;
  return enforceRenderGuardrails(supabase, action, excludeVideoId);
}

async function fetchRecentVideoCosts(supabase: SupabaseClient, windowMs: number) {
  const since = new Date(Date.now() - windowMs).toISOString();
  const { data, error } = await supabase
    .from('videos')
    .select('created_at,estimated_cost_usd,actual_cost_usd,status')
    .gte('created_at', since)
    .in('status', COUNTED_STATUSES);

  if (error) {
    console.error('[safety] cost lookup failed:', error.message);
    return [];
  }

  return data ?? [];
}

function getSafetyClient(fallback: SupabaseClient) {
  const admin = createAdminClient();
  if (!admin) {
    console.warn('[safety] SUPABASE_SERVICE_ROLE_KEY is missing; safety totals may be limited by RLS.');
    return fallback;
  }
  return admin;
}
