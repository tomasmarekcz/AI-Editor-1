import { getSiteUrl } from '@/lib/siteUrl';

type WorkerTriggerResult = {
  ok: boolean;
  skipped: boolean;
  message: string | null;
  endpoint?: string;
};

function workerBaseUrl() {
  const railwayDomain = process.env.RAILWAY_PUBLIC_DOMAIN
    ? `https://${process.env.RAILWAY_PUBLIC_DOMAIN}`
    : '';
  const raw = (process.env.WORKER_URL || process.env.BASE_URL || process.env.NEXT_PUBLIC_SITE_URL || railwayDomain || getSiteUrl()).trim();
  const withProtocol = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
  return withProtocol.replace(/\/+$/, '');
}

function workerEndpoints(base: string) {
  const url = new URL(base);
  const hasExplicitPath = url.pathname !== '' && url.pathname !== '/';
  if (hasExplicitPath) return [url.toString()];

  return [
    new URL('/process-job', url).toString(),
    new URL('/api/worker/process-job', url).toString(),
  ];
}

export async function triggerWorkerJob(videoId: string): Promise<WorkerTriggerResult> {
  const workerSecret = process.env.WORKER_SECRET;

  if (!workerSecret) {
    return {
      ok: false,
      skipped: true,
      message: 'WORKER_SECRET is not configured.',
    };
  }

  const endpoints = workerEndpoints(workerBaseUrl());
  const errors: string[] = [];

  for (const endpoint of endpoints) {
    try {
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${workerSecret}`,
        },
        body: JSON.stringify({ videoId }),
      });

      if (res.ok) {
        return { ok: true, skipped: false, message: null, endpoint };
      }

      const body = await res.text().catch(() => '');
      errors.push(`${endpoint} -> HTTP ${res.status}${body ? `: ${body.slice(0, 200)}` : ''}`);
    } catch (err) {
      errors.push(`${endpoint} -> ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  return {
    ok: false,
    skipped: false,
    message: errors.join(' | '),
  };
}
