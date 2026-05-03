import { processVideoJob } from '@/worker/processJob';

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

  void processVideoJob(videoId).then((result) => {
    if (!result.ok) console.error('[api/worker/process-job] failed:', result);
  });

  return Response.json({ ok: true, videoId, accepted: true }, { status: 202 });
}
