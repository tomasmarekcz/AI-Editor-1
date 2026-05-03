import { getSiteUrl } from '@/lib/siteUrl';
import { logWorkerEvent } from '@/lib/worker/log';

type WorkerTriggerResult = {
  ok: boolean;
  skipped: boolean;
  message: string | null;
  endpoint?: string;
};

function normalizeBaseUrl(raw: string) {
  const clean = raw.trim();
  const withProtocol = /^https?:\/\//i.test(clean) ? clean : `https://${clean}`;
  return withProtocol.replace(/\/+$/, '');
}

function addEndpoint(endpoints: string[], endpoint: string) {
  if (!endpoints.includes(endpoint)) endpoints.push(endpoint);
}

function equivalentOrigin(a: string, b: string) {
  try {
    return new URL(normalizeBaseUrl(a)).origin === new URL(normalizeBaseUrl(b)).origin;
  } catch {
    return false;
  }
}

function appendWorkerEndpoints(endpoints: string[], base: string) {
  const url = new URL(normalizeBaseUrl(base));
  const hasExplicitPath = url.pathname !== '' && url.pathname !== '/';
  if (hasExplicitPath) {
    addEndpoint(endpoints, url.toString());
    return;
  }

  addEndpoint(endpoints, new URL('/process-job', url).toString());
}

function appendInternalEndpoint(endpoints: string[]) {
  const railwayDomain = process.env.RAILWAY_PUBLIC_DOMAIN
    ? `https://${process.env.RAILWAY_PUBLIC_DOMAIN}`
    : '';
  const base = process.env.BASE_URL || process.env.NEXT_PUBLIC_SITE_URL || railwayDomain || getSiteUrl();
  const url = new URL(normalizeBaseUrl(base));
  addEndpoint(endpoints, new URL('/api/worker/process-job', url).toString());
}

function workerEndpoints() {
  const endpoints: string[] = [];
  const internalBase = process.env.BASE_URL || process.env.NEXT_PUBLIC_SITE_URL || process.env.RAILWAY_PUBLIC_DOMAIN || getSiteUrl();
  if (process.env.WORKER_URL?.trim()) {
    if (equivalentOrigin(process.env.WORKER_URL, internalBase)) {
      appendInternalEndpoint(endpoints);
    } else {
      appendWorkerEndpoints(endpoints, process.env.WORKER_URL);
    }
  } else {
    appendInternalEndpoint(endpoints);
  }
  appendInternalEndpoint(endpoints);
  return endpoints;
}

function summarizeHttpBody(body: string) {
  if (!body) return '';
  if (body.includes('<!DOCTYPE html') || body.includes('<html')) {
    return '[html response omitted]';
  }
  return body.slice(0, 500);
}

export async function triggerWorkerJob(videoId: string): Promise<WorkerTriggerResult> {
  const workerSecret = process.env.WORKER_SECRET;

  if (!workerSecret) {
    await logWorkerEvent({
      videoId,
      source: 'worker-trigger',
      event: 'missing_secret',
      level: 'error',
      message: 'WORKER_SECRET is not configured.',
    });
    return {
      ok: false,
      skipped: true,
      message: 'WORKER_SECRET is not configured.',
    };
  }

  const endpoints = workerEndpoints();
  const errors: string[] = [];

  await logWorkerEvent({
    videoId,
    source: 'worker-trigger',
    event: 'start',
    message: 'Starting worker trigger attempts.',
    metadata: { endpoints },
  });

  for (const endpoint of endpoints) {
    try {
      console.log(`[worker-trigger] ${videoId} -> ${endpoint}`);
      await logWorkerEvent({
        videoId,
        source: 'worker-trigger',
        event: 'attempt',
        message: endpoint,
      });
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${workerSecret}`,
        },
        body: JSON.stringify({ videoId }),
      });

      if (res.ok) {
        console.log(`[worker-trigger] ${videoId} accepted by ${endpoint}`);
        await logWorkerEvent({
          videoId,
          source: 'worker-trigger',
          event: 'accepted',
          message: endpoint,
          metadata: { status: res.status },
        });
        return { ok: true, skipped: false, message: null, endpoint };
      }

      const body = await res.text().catch(() => '');
      const bodySummary = summarizeHttpBody(body);
      const error = `${endpoint} -> HTTP ${res.status}${bodySummary ? `: ${bodySummary.slice(0, 200)}` : ''}`;
      errors.push(error);
      await logWorkerEvent({
        videoId,
        source: 'worker-trigger',
        event: 'rejected',
        level: 'warn',
        message: error,
        metadata: { status: res.status, body: bodySummary },
      });
    } catch (err) {
      const error = `${endpoint} -> ${err instanceof Error ? err.message : String(err)}`;
      errors.push(error);
      await logWorkerEvent({
        videoId,
        source: 'worker-trigger',
        event: 'exception',
        level: 'warn',
        message: error,
        metadata: { endpoint, err },
      });
    }
  }

  await logWorkerEvent({
    videoId,
    source: 'worker-trigger',
    event: 'failed',
    level: 'error',
    message: errors.join(' | '),
    metadata: { errors },
  });

  return {
    ok: false,
    skipped: false,
    message: errors.join(' | '),
  };
}
