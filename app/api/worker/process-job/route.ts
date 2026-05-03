import { processVideoJob } from '@/worker/processJob';
import { logWorkerEvent } from '@/lib/worker/log';

export const dynamic = 'force-dynamic';

function isAuthorized(req: Request) {
  const workerSecret = process.env.WORKER_SECRET;
  if (!workerSecret) return false;
  return req.headers.get('authorization') === `Bearer ${workerSecret}`;
}

export async function POST(req: Request) {
  if (!isAuthorized(req)) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const body = (await req.json().catch(() => ({}))) as { videoId?: string };
  const videoId = typeof body.videoId === 'string' ? body.videoId : '';
  if (!videoId) {
    return Response.json({ error: 'videoId is required.' }, { status: 400 });
  }

  console.log(`[api/worker/process-job] accepted ${videoId}`);
  await logWorkerEvent({
    videoId,
    source: 'api-worker',
    event: 'accepted',
    message: 'Internal worker endpoint accepted job request.',
  });

  void processVideoJob(videoId).then((result) => {
    if (!result.ok) {
      console.error('[api/worker/process-job] failed:', result);
      void logWorkerEvent({
        videoId,
        source: 'api-worker',
        event: 'failed',
        level: 'error',
        message: result.error,
        metadata: result,
      });
    } else {
      console.log('[api/worker/process-job] result:', result);
      void logWorkerEvent({
        videoId,
        source: 'api-worker',
        event: 'completed',
        message: result.processed ? 'Job processing completed.' : result.reason,
        metadata: result,
      });
    }
  });

  return Response.json({ ok: true, videoId, accepted: true }, { status: 202 });
}
