import { notFound } from 'next/navigation';
import { requireAccountPage } from '@/lib/accounts';
import { createSignedUrl } from '@/lib/storage/videoAssets';
import { VideoEditor } from './VideoEditor';
import type { SavedVideo, VideoAsset } from '@/lib/projects/types';
import type { SegmentData } from '@/types';
import type { VideoEdit, EditorVideoData } from '@/types/editor';

export const dynamic = 'force-dynamic';

export default async function VideoEditPage({ params }: { params: { id: string } }) {
  const { supabase, account } = await requireAccountPage();

  const { data: video } = await supabase
    .from('videos')
    .select('*')
    .eq('id', params.id)
    .eq('account_id', account.id)
    .maybeSingle<SavedVideo & {
      edited_settings: unknown;
      edited_segments: unknown;
      edited_video_path: string | null;
      edited_video_size_bytes: number | null;
    }>();

  if (!video) notFound();

  // Fetch all assets + edit history in parallel
  const [{ data: assets }, { data: editHistoryRaw }] = await Promise.all([
    supabase
      .from('video_assets')
      .select('*')
      .eq('video_id', video.id)
      .eq('account_id', account.id)
      .order('segment_index', { ascending: true }),
    supabase
      .from('video_edits')
      .select('*')
      .eq('video_id', video.id)
      .order('created_at', { ascending: true }),
  ]);

  const typedAssets = (assets ?? []) as VideoAsset[];

  // Signed URLs: 4-hour expiry for editor session
  const EXPIRY = 14400;

  const imageAssets = typedAssets.filter(
    (a) => a.kind === 'image' || a.kind === 'uploaded_image',
  );
  const audioAsset = typedAssets.find((a) => a.kind === 'audio');
  const finalVideoAsset = typedAssets.find((a) => a.kind === 'final_video' && !a.storage_path.includes('/edited/'));
  const editedVideoAsset = typedAssets.find((a) => a.storage_path?.includes('/edited/'));

  // Resolve signed URLs for all images in parallel
  const imageUrlResults = await Promise.all(
    imageAssets.map(async (asset) => ({
      index: asset.segment_index ?? -1,
      url: await createSignedUrl(supabase, asset.storage_path, EXPIRY),
    })),
  );

  const imageUrlsByIndex: Record<number, string> = {};
  for (const { index, url } of imageUrlResults) {
    if (index >= 0 && url) imageUrlsByIndex[index] = url;
  }

  const [audioUrl, finalVideoUrl, editedVideoUrl] = await Promise.all([
    createSignedUrl(supabase, audioAsset?.storage_path ?? null, EXPIRY),
    createSignedUrl(supabase, finalVideoAsset?.storage_path ?? video.final_video_path ?? null, EXPIRY),
    editedVideoAsset
      ? createSignedUrl(supabase, editedVideoAsset.storage_path, EXPIRY)
      : video.edited_video_path
        ? createSignedUrl(supabase, video.edited_video_path, EXPIRY)
        : Promise.resolve(null),
  ]);

  const editorData: EditorVideoData = {
    id: video.id,
    project_id: video.project_id,
    title: video.title,
    original_script: video.original_script,
    enhanced_script: video.enhanced_script ?? null,
    settings: video.settings ?? {},
    segments: (video.segments ?? []) as SegmentData[],
    edited_settings: (video.edited_settings as EditorVideoData['edited_settings']) ?? null,
    edited_segments: (video.edited_segments as EditorVideoData['edited_segments']) ?? null,
    edited_video_path: video.edited_video_path ?? null,
    final_video_path: video.final_video_path ?? null,
    duration_seconds: video.duration_seconds ?? null,
    imageUrlsByIndex,
    audioUrl: audioUrl ?? null,
    editedVideoUrl: editedVideoUrl ?? null,
    finalVideoUrl: finalVideoUrl ?? null,
    editHistory: (editHistoryRaw ?? []) as VideoEdit[],
  };

  return <VideoEditor video={editorData} />;
}
