import fs from 'fs';
import path from 'path';
import { requireAccountApi } from '@/lib/accounts';

export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  try {
    const auth = await requireAccountApi();
    if (!auth.ok) return auth.response;

    const formData = await req.formData();
    const file = formData.get('file') as File | null;
    const segmentId = formData.get('segmentId') as string | null;

    if (!file || !segmentId) {
      return Response.json({ error: 'file and segmentId required' }, { status: 400 });
    }

    const dir = path.join(process.cwd(), 'public', 'tmp', 'images');
    fs.mkdirSync(dir, { recursive: true });

    // Keep original extension so Remotion knows if it's a video
    const ext = file.name.split('.').pop()?.toLowerCase() ?? 'jpg';
    const filename = `${segmentId}-upload.${ext}`;
    const filepath = path.join(dir, filename);

    const buffer = Buffer.from(await file.arrayBuffer());
    fs.writeFileSync(filepath, buffer);

    return Response.json({ localPath: `/tmp/images/${filename}` });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return Response.json({ error: message }, { status: 500 });
  }
}
