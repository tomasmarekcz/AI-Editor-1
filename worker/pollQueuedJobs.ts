import { processNextQueuedJob } from '@/worker/processJob';

let polling = false;
let running = false;

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function startPollingQueuedJobs() {
  if (polling) return;
  polling = true;

  const intervalMs = Number(process.env.WORKER_POLL_INTERVAL_MS ?? 15000);
  const enabled = process.env.WORKER_POLLING_DISABLED !== 'true';

  if (!enabled) {
    console.log('[worker] polling fallback disabled');
    return;
  }

  console.log(`[worker] polling fallback every ${intervalMs}ms`);

  const tick = async () => {
    if (running) return;
    running = true;
    try {
      while (true) {
        const result = await processNextQueuedJob();
        if (result.ok && !result.processed) break;
        await sleep(500);
      }
    } catch (err) {
      console.error('[worker] polling error:', err instanceof Error ? err.message : String(err));
    } finally {
      running = false;
    }
  };

  void tick();
  setInterval(() => void tick(), intervalMs);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  startPollingQueuedJobs();
}
