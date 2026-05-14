import { requireAccountApi } from '@/lib/accounts';
import type { SavedVideo } from '@/lib/projects/types';
import {
  createSignedUrl,
  createStorageAdminClient,
  uploadBufferAsset,
  VIDEO_ASSETS_BUCKET,
} from '@/lib/storage/videoAssets';

export const dynamic = 'force-dynamic';
export const maxDuration = 30;

const ALLOWED_IMAGE_TYPES = new Set([
  'image/jpeg',
  'image/png',
]);
const YOUTUBE_THUMBNAIL_MAX_BYTES = 2 * 1024 * 1024;

export async function POST(req: Request, { params }: { params: { id: string } }) {
  try {
    const auth = await requireAccountApi();
    if (!auth.ok) return auth.response;

    const formData = await req.formData();
    const file = formData.get('file') as File | null;
    if (!file) {
      return Response.json({ error: 'Image file is required' }, { status: 400 });
    }
    if (!ALLOWED_IMAGE_TYPES.has(file.type)) {
      return Response.json({ error: 'Only YouTube-compatible JPEG or PNG thumbnails are allowed.' }, { status: 400 });
    }
    if (file.size > YOUTUBE_THUMBNAIL_MAX_BYTES) {
      return Response.json({ error: 'YouTube thumbnails must be 2 MB or smaller.' }, { status: 400 });
    }

    const { data: video } = await auth.supabase
      .from('videos')
      .select('id,user_id,account_id,project_id')
      .eq('id', params.id)
      .eq('account_id', auth.account.id)
      .maybeSingle<Pick<SavedVideo, 'id' | 'user_id' | 'account_id' | 'project_id'>>();

    if (!video) {
      return Response.json({ error: 'Video not found' }, { status: 404 });
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    const assetClient = createStorageAdminClient() ?? auth.supabase;
    const uploaded = await uploadBufferAsset({
      supabase: assetClient,
      userId: auth.user.id,
      projectId: video.project_id,
      videoId: video.id,
      folder: 'thumbnail',
      filename: `thumbnail-${Date.now()}.${file.type === 'image/jpeg' ? 'jpg' : 'png'}`,
      buffer,
      contentType: file.type,
    });

    const dbClient = createStorageAdminClient() ?? auth.supabase;
    const { error: assetError } = await dbClient.from('video_assets').insert({
      user_id: auth.user.id,
      account_id: auth.account.id,
      project_id: video.project_id,
      video_id: video.id,
      kind: 'thumbnail',
      storage_bucket: VIDEO_ASSETS_BUCKET,
      storage_path: uploaded.storagePath,
      mime_type: uploaded.mimeType,
      size_bytes: uploaded.sizeBytes,
      prompt: null,
      source: 'uploaded',
      metadata: {
        originalName: file.name,
      },
    });

    if (assetError) {
      return Response.json({ error: assetError.message }, { status: 500 });
    }

    const { error: updateError } = await auth.supabase
      .from('videos')
      .update({
        thumbnail_path: uploaded.storagePath,
        thumbnail_prompt: null,
        thumbnail_source: 'uploaded',
        thumbnail_updated_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq('id', video.id)
      .eq('account_id', auth.account.id);

    if (updateError) {
      return Response.json({ error: updateError.message }, { status: 500 });
    }

    return Response.json({
      storagePath: uploaded.storagePath,
      thumbnailUrl: await createSignedUrl(assetClient, uploaded.storagePath),
      source: 'uploaded',
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[videos/thumbnail/upload]', message);
    return Response.json({ error: message }, { status: 500 });
  }
}
