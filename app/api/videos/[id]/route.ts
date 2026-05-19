import { requireAccountApi } from '@/lib/accounts';
import { createSupabaseAdminClient } from '@/lib/supabase/admin';
import { deleteVideoStorageAssets } from '@/lib/storage/videoAssets';
import { logWorkerEvent } from '@/lib/worker/log';

export const dynamic = 'force-dynamic';

type VideoRow = {
  id: string;
  user_id: string;
  account_id: string;
  project_id: string;
  status: string;
  current_step: string | null;
};

export async function DELETE(_req: Request, { params }: { params: { id: string } }) {
  const auth = await requireAccountApi();
  if (!auth.ok) return auth.response;

  const { supabase, account } = auth;
  const db = createSupabaseAdminClient() ?? supabase;

  const { data: video, error: videoError } = await db
    .from('videos')
    .select('id,user_id,account_id,project_id,status,current_step')
    .eq('id', params.id)
    .eq('account_id', account.id)
    .maybeSingle<VideoRow>();

  if (videoError) {
    return Response.json({ error: videoError.message }, { status: 500 });
  }
  if (!video) {
    return Response.json({ error: 'Video not found' }, { status: 404 });
  }

  await db
    .from('videos')
    .update({
      current_step: 'deleting',
      locked_at: null,
      updated_at: new Date().toISOString(),
    })
    .eq('id', video.id)
    .eq('account_id', account.id);

  const { data: assets, error: assetsError } = await db
    .from('video_assets')
    .select('storage_path')
    .eq('video_id', video.id)
    .eq('account_id', account.id);

  if (assetsError) {
    return Response.json({ error: assetsError.message }, { status: 500 });
  }

  const storageResult = await deleteVideoStorageAssets({
    supabase: db,
    userId: video.user_id,
    projectId: video.project_id,
    videoId: video.id,
    storagePaths: (assets ?? []).map((asset) => String(asset.storage_path ?? '')).filter(Boolean),
  });

  await logWorkerEvent({
    supabase: db,
    videoId: video.id,
    accountId: account.id,
    projectId: video.project_id,
    source: 'api-video-delete',
    event: 'storage_deleted',
    message: 'Video storage assets deleted.',
    metadata: storageResult,
  });

  const tables = [
    'social_post_analytics',
    'scheduled_posts',
    'usage_events',
    'video_assets',
  ];
  for (const table of tables) {
    const { error } = await db.from(table).delete().eq('video_id', video.id).eq('account_id', account.id);
    if (error) {
      return Response.json({ error: `Could not delete ${table}: ${error.message}` }, { status: 500 });
    }
  }

  const { error: deleteError } = await db
    .from('videos')
    .delete()
    .eq('id', video.id)
    .eq('account_id', account.id);

  if (deleteError) {
    return Response.json({ error: deleteError.message }, { status: 500 });
  }

  return Response.json({
    ok: true,
    videoId: video.id,
    deletedStoragePaths: storageResult.deletedPaths,
  });
}
