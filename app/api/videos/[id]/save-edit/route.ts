import { requireAccountApi } from '@/lib/accounts';
import type { SegmentData, VideoSettings } from '@/types';

export const dynamic = 'force-dynamic';

export async function POST(req: Request, { params }: { params: { id: string } }) {
  const auth = await requireAccountApi();
  if (!auth.ok) return auth.response;
  const { supabase, account } = auth;

  const { editedSettings, editedSegments } = (await req.json()) as {
    editedSettings: Partial<VideoSettings>;
    editedSegments: SegmentData[];
  };

  const { error } = await supabase
    .from('videos')
    .update({ edited_settings: editedSettings, edited_segments: editedSegments })
    .eq('id', params.id)
    .eq('account_id', account.id);

  if (error) return Response.json({ error: error.message }, { status: 500 });
  return Response.json({ ok: true });
}
