import { processNextQueuedJob } from '@/worker/processJob';
import { processNextScheduledPost } from '@/worker/processScheduledPosts';

let polling = false;
let running = false;

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function startPollingQueuedJobs() {
  if (polling) return;
  polling = true;

  const intervalMs = Number(process.env.WORKER_POLL_INTERVAL_MS ?? 15000);
  const videoPollingEnabled = process.env.WORKER_POLLING_DISABLED !== 'true';
  const scheduledPollingEnabled = process.env.WORKER_SCHEDULED_POLLING_DISABLED !== 'true';

  if (!videoPollingEnabled && !scheduledPollingEnabled) {
    console.log('[worker] all polling disabled');
    return;
  }

  console.log(`[worker] polling every ${intervalMs}ms`, {
    videoPollingEnabled,
    scheduledPollingEnabled,
  });

  const tick = async () => {
    if (running) return;
    running = true;
    try {
      while (true) {
        let didWork = false;

        if (videoPollingEnabled) {
          const videoResult = await processNextQueuedJob();
          didWork = !videoResult.ok || videoResult.processed;
        }

        if (scheduledPollingEnabled) {
          const postResult = await processNextScheduledPost();
          didWork = didWork || !postResult.ok || postResult.processed;
        }

        if (!didWork) break;
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
