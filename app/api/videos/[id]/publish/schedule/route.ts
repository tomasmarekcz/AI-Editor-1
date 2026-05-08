import { requireAccountApi } from '@/lib/accounts';
import type { SavedVideo } from '@/lib/projects/types';

export const dynamic = 'force-dynamic';

type ScheduleRequest = {
  caption?: string;
  title?: string;
  scheduledFor?: string;
  timezone?: string;
  thumbnailStoragePath?: string | null;
  privacyStatus?: 'private' | 'unlisted' | 'public';
};

export async function POST(req: Request, { params }: { params: { id: string } }) {
  try {
    const auth = await requireAccountApi();
    if (!auth.ok) return auth.response;

    const body = await req.json().catch(() => ({})) as ScheduleRequest;
    const scheduledFor = body.scheduledFor ? new Date(body.scheduledFor) : null;
    if (!scheduledFor || Number.isNaN(scheduledFor.getTime())) {
      return Response.json({ error: 'A valid scheduledFor date is required.' }, { status: 400 });
    }

    const { data: video, error: videoError } = await auth.supabase
      .from('videos')
      .select('id,account_id,project_id,title,final_video_path,thumbnail_path,status')
      .eq('id', params.id)
      .eq('account_id', auth.account.id)
      .maybeSingle<Pick<SavedVideo, 'id' | 'account_id' | 'project_id' | 'title' | 'final_video_path' | 'thumbnail_path' | 'status'>>();

    if (videoError) return Response.json({ error: videoError.message }, { status: 500 });
    if (!video) return Response.json({ error: 'Video not found.' }, { status: 404 });

    const videoPath = video.final_video_path;
    if (!videoPath) return Response.json({ error: 'Final MP4 is not available yet.' }, { status: 400 });

    const { data: connection, error: connectionError } = await auth.supabase
      .from('social_connections')
      .select('id,status')
      .eq('account_id', auth.account.id)
      .eq('project_id', video.project_id)
      .eq('platform', 'youtube')
      .eq('status', 'connected')
      .maybeSingle<{ id: string; status: string }>();

    if (connectionError) return Response.json({ error: connectionError.message }, { status: 500 });
    if (!connection) return Response.json({ error: 'YouTube is not connected for this workspace.' }, { status: 400 });

    const title = body.title?.trim() || video.title || 'Untitled video';
    const caption = body.caption?.trim() ?? '';

    const { data: scheduledPost, error } = await auth.supabase
      .from('scheduled_posts')
      .insert({
        account_id: auth.account.id,
        project_id: video.project_id,
        video_id: video.id,
        connection_id: connection.id,
        created_by: auth.user.id,
        platform: 'youtube',
        status: 'scheduled',
        caption,
        title,
        description: caption,
        privacy_status: body.privacyStatus ?? 'public',
        scheduled_for: scheduledFor.toISOString(),
        timezone: body.timezone ?? null,
        video_storage_path: videoPath,
        thumbnail_storage_path: body.thumbnailStoragePath || video.thumbnail_path || null,
      })
      .select('id,status,scheduled_for,platform')
      .single<{ id: string; status: string; scheduled_for: string; platform: string }>();

    if (error) return Response.json({ error: error.message }, { status: 500 });
    return Response.json({ scheduledPost });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[videos/publish/schedule]', message);
    return Response.json({ error: message }, { status: 500 });
  }
}
