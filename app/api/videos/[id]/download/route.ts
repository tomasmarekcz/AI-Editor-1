import { requireAccountApi } from '@/lib/accounts';
import { VIDEO_ASSETS_BUCKET } from '@/lib/storage/videoAssets';
import { createSupabaseAdminClient } from '@/lib/supabase/admin';

export const dynamic = 'force-dynamic';

function safeFilename(title: string | null | undefined) {
  const cleaned = (title || 'video')
    .normalize('NFKD')
    .replace(/[^\w\s.-]/g, '')
    .trim()
    .replace(/\s+/g, '-')
    .slice(0, 80);
  return `${cleaned || 'video'}.mp4`;
}

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  try {
    const auth = await requireAccountApi();
    if (!auth.ok) return auth.response;

    const { data: video, error: videoError } = await auth.supabase
      .from('videos')
      .select('id,title,final_video_path,final_video_mime_type')
      .eq('id', params.id)
      .eq('account_id', auth.account.id)
      .maybeSingle<{
        id: string;
        title: string | null;
        final_video_path: string | null;
        final_video_mime_type: string | null;
      }>();

    if (videoError) return Response.json({ error: videoError.message }, { status: 500 });
    if (!video?.final_video_path) return Response.json({ error: 'Final MP4 is not available.' }, { status: 404 });

    const storage = createSupabaseAdminClient() ?? auth.supabase;
    const { data, error } = await storage.storage
      .from(VIDEO_ASSETS_BUCKET)
      .download(video.final_video_path);

    if (error || !data) {
      return Response.json({ error: error?.message ?? 'Video file not found.' }, { status: 404 });
    }

    return new Response(data, {
      headers: {
        'Content-Type': video.final_video_mime_type || data.type || 'video/mp4',
        'Content-Disposition': `attachment; filename="${safeFilename(video.title)}"`,
        'Cache-Control': 'private, max-age=0, no-store',
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[videos/download]', message);
    return Response.json({ error: message }, { status: 500 });
  }
}
