import type { SupabaseClient } from '@supabase/supabase-js';
import { createSupabaseAdminClient } from '@/lib/supabase/admin';

type WorkerLogLevel = 'debug' | 'info' | 'warn' | 'error';

type WorkerLogInput = {
  supabase?: SupabaseClient | null;
  videoId?: string | null;
  accountId?: string | null;
  projectId?: string | null;
  source: string;
  event: string;
  level?: WorkerLogLevel;
  message?: string | null;
  metadata?: Record<string, unknown>;
};

const WORKER_LOGS_ENABLED = process.env.WORKER_DB_LOGS_DISABLED !== 'true';

function safeMetadata(metadata?: Record<string, unknown>) {
  if (!metadata) return {};
  try {
    return JSON.parse(JSON.stringify(metadata, (_key, value) => {
      if (value instanceof Error) {
        return {
          name: value.name,
          message: value.message,
          stack: value.stack?.slice(0, 2000),
        };
      }
      if (typeof value === 'bigint') return value.toString();
      return value;
    })) as Record<string, unknown>;
  } catch {
    return { unserializable: true };
  }
}

function consoleLine(input: WorkerLogInput) {
  const level = input.level ?? 'info';
  const video = input.videoId ? ` video=${input.videoId}` : '';
  const message = input.message ? ` ${input.message}` : '';
  return `[worker-log] ${level} ${input.source}.${input.event}${video}${message}`;
}

export async function logWorkerEvent(input: WorkerLogInput) {
  const level = input.level ?? 'info';
  const line = consoleLine(input);
  if (level === 'error') console.error(line, input.metadata ?? '');
  else if (level === 'warn') console.warn(line, input.metadata ?? '');
  else console.log(line, input.metadata ?? '');

  if (!WORKER_LOGS_ENABLED) return;

  const supabase = input.supabase ?? createSupabaseAdminClient();
  if (!supabase) return;

  try {
    const { error } = await supabase.from('worker_logs').insert({
      video_id: input.videoId ?? null,
      account_id: input.accountId ?? null,
      project_id: input.projectId ?? null,
      source: input.source,
      event: input.event,
      level,
      message: input.message ?? null,
      metadata: safeMetadata(input.metadata),
    });
    if (error && !/worker_logs/i.test(error.message)) {
      console.warn('[worker-log] insert failed', error.message);
    }
  } catch (err) {
    console.warn('[worker-log] insert exception', err instanceof Error ? err.message : String(err));
  }
}
