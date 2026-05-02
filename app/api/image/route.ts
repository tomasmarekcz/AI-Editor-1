import fs from 'fs';
import path from 'path';

export const dynamic = 'force-dynamic';

/**
 * GET /api/image?path=/tmp/images/xxx.jpg
 *
 * Serves local image files from public/ with explicit headers.
 * Used by Remotion's renderer instead of Next.js static file serving,
 * which can sometimes return unexpected content-types or missing files.
 */
export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const localPath = searchParams.get('path');

  if (!localPath) {
    return new Response('Missing path', { status: 400 });
  }

  // Security: only allow files under public/tmp/
  if (!localPath.startsWith('/tmp/')) {
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

  // Detect content type from magic bytes
  let contentType = 'image/jpeg';
  if (buffer[0] === 0x89 && buffer[1] === 0x50) contentType = 'image/png';
  else if (buffer[0] === 0x47 && buffer[1] === 0x49) contentType = 'image/gif';
  else if (buffer[0] === 0x52 && buffer[1] === 0x49) contentType = 'image/webp';

  return new Response(buffer, {
    status: 200,
    headers: {
      'Content-Type': contentType,
      'Content-Length': String(buffer.length),
      'Cache-Control': 'public, max-age=3600',
    },
  });
}
