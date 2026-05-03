import fs from 'fs';
import path from 'path';

export const dynamic = 'force-dynamic';

/**
 * GET /api/audio?path=/tmp/audio/xxx.mp3
 *
 * Serves runtime-generated audio files from public/tmp/audio for Remotion.
 * Next.js production does not reliably serve files written to public/ after
 * deploy, so Remotion should use this route instead of /tmp/audio directly.
 */
export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const localPath = searchParams.get('path');

  if (!localPath) {
    return new Response('Missing path', { status: 400 });
  }

  if (!localPath.startsWith('/tmp/audio/')) {
    return new Response('Forbidden', { status: 403 });
  }

  const absPath = path.join(process.cwd(), 'public', localPath);

  if (!fs.existsSync(absPath)) {
    return new Response('Not found', { status: 404 });
  }

  const stat = fs.statSync(absPath);
  if (stat.size < 512) {
    return new Response('File too small', { status: 422 });
  }

  const buffer = fs.readFileSync(absPath);
  const ext = path.extname(absPath).toLowerCase();
  const contentType = ext === '.wav'
    ? 'audio/wav'
    : ext === '.m4a'
      ? 'audio/mp4'
      : 'audio/mpeg';

  return new Response(buffer, {
    status: 200,
    headers: {
      'Content-Type': contentType,
      'Content-Length': String(buffer.length),
      'Cache-Control': 'no-store',
    },
  });
}
