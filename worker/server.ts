import http from 'http';
import { processVideoJob } from '@/worker/processJob';
import { startPollingQueuedJobs } from '@/worker/pollQueuedJobs';
import { WORKER_BUILD_VERSION } from '@/worker/version';

const port = Number(process.env.WORKER_PORT ?? process.env.PORT ?? 8787);
const workerSecret = process.env.WORKER_SECRET;

function readJson(req: http.IncomingMessage) {
  return new Promise<Record<string, unknown>>((resolve, reject) => {
    let body = '';
    req.on('data', (chunk) => {
      body += chunk;
      if (body.length > 1_000_000) {
        req.destroy();
        reject(new Error('Request body too large.'));
      }
    });
    req.on('end', () => {
      try {
        resolve(body ? JSON.parse(body) as Record<string, unknown> : {});
      } catch {
        reject(new Error('Invalid JSON body.'));
      }
    });
    req.on('error', reject);
  });
}

function sendJson(res: http.ServerResponse, status: number, payload: Record<string, unknown>) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(payload));
}

function isAuthorized(req: http.IncomingMessage) {
  if (!workerSecret) return false;
  return req.headers.authorization === `Bearer ${workerSecret}`;
}

const server = http.createServer(async (req, res) => {
  if (req.method === 'GET' && req.url === '/health') {
    sendJson(res, 200, { ok: true, workerVersion: WORKER_BUILD_VERSION });
    return;
  }

  if (req.method !== 'POST' || req.url !== '/process-job') {
    sendJson(res, 404, { error: 'Not found' });
    return;
  }

  if (!isAuthorized(req)) {
    sendJson(res, 401, { error: 'Unauthorized' });
    return;
  }

  try {
    const body = await readJson(req);
    const videoId = typeof body.videoId === 'string' ? body.videoId : '';
    if (!videoId) {
      sendJson(res, 400, { error: 'videoId is required.' });
      return;
    }

    void processVideoJob(videoId).then((result) => {
      if (!result.ok) console.error('[worker] process-job failed:', result);
    });
    sendJson(res, 202, { ok: true, videoId, accepted: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    sendJson(res, 500, { ok: false, error: message });
  }
});

server.listen(port, () => {
  console.log(`[worker] listening on http://localhost:${port}`, { workerVersion: WORKER_BUILD_VERSION });
  startPollingQueuedJobs();
});
