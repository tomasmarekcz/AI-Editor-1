import fs from 'fs';
import path from 'path';
import { requireAccountApi } from '@/lib/accounts';
import {
  uploadBufferAsset,
  createStorageAdminClient,
  VIDEO_ASSETS_BUCKET,
} from '@/lib/storage/videoAssets';

export const dynamic = 'force-dynamic';

function contentTypeForUpload(file: File, ext: string) {
  if (file.type) return file.type;
  if (ext === 'png') return 'image/png';
  if (ext === 'webp') return 'image/webp';
  if (ext === 'gif') return 'image/gif';
  if (ext === 'mp4') return 'video/mp4';
  if (ext === 'mov') return 'video/quicktime';
  if (ext === 'webm') return 'video/webm';
  return 'image/jpeg';
}

export async function POST(req: Request) {
  try {
    const auth = await requireAccountApi();
    if (!auth.ok) return auth.response;

    const formData = await req.formData();
    const file = formData.get('file') as File | null;
    const segmentId = formData.get('segmentId') as string | null;
    const projectId = formData.get('projectId') as string | null;
    const videoId = formData.get('videoId') as string | null;
    const rawSegmentIndex = formData.get('segmentIndex') as string | null;
    const segmentIndex = rawSegmentIndex != null ? Number(rawSegmentIndex) : null;

    if (!file || !segmentId) {
      return Response.json({ error: 'file and segmentId required' }, { status: 400 });
    }

    const dir = path.join(process.cwd(), 'public', 'tmp', 'images');
    fs.mkdirSync(dir, { recursive: true });

    // Keep original extension so Remotion knows if it's a video
    const ext = file.name.split('.').pop()?.toLowerCase().replace(/[^a-z0-9]/g, '') || 'jpg';
    const filename = `${segmentId}-upload-${Date.now()}.${ext}`;
    const filepath = path.join(dir, filename);

    const buffer = Buffer.from(await file.arrayBuffer());
    fs.writeFileSync(filepath, buffer);

    let storagePath: string | null = null;
    if (projectId && videoId && Number.isInteger(segmentIndex)) {
      const { data: video } = await auth.supabase
        .from('videos')
        .select('id,project_id')
        .eq('id', videoId)
        .eq('project_id', projectId)
        .eq('account_id', auth.account.id)
        .maybeSingle();

      if (!video) {
        return Response.json({ error: 'Video not found' }, { status: 404 });
      }

      const assetClient = createStorageAdminClient() ?? auth.supabase;
      const uploaded = await uploadBufferAsset({
        supabase: assetClient,
        userId: auth.user.id,
        projectId,
        videoId,
        folder: 'images',
        filename: `${String(segmentIndex! + 1).padStart(2, '0')}-${filename}`,
        buffer,
        contentType: contentTypeForUpload(file, ext),
      });
      storagePath = uploaded.storagePath;

      const dbClient = createStorageAdminClient() ?? auth.supabase;
      const { error: assetError } = await dbClient.from('video_assets').insert({
        user_id: auth.user.id,
        account_id: auth.account.id,
        project_id: projectId,
        video_id: videoId,
        kind: 'uploaded_image',
        segment_id: segmentId,
        segment_index: segmentIndex,
        storage_bucket: VIDEO_ASSETS_BUCKET,
        storage_provider: uploaded.storageProvider,
        storage_path: uploaded.storagePath,
        mime_type: uploaded.mimeType,
        size_bytes: uploaded.sizeBytes,
        source: 'upload',
        metadata: {
          originalName: file.name,
          localImagePath: `/tmp/images/${filename}`,
        },
      });

      if (assetError) {
        return Response.json({ error: assetError.message }, { status: 500 });
      }
    }

    return Response.json({ localPath: `/tmp/images/${filename}`, storagePath });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return Response.json({ error: message }, { status: 500 });
  }
}
