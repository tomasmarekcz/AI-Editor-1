import { notFound } from 'next/navigation';
import { AppSidebar } from '@/app/components/layout/AppSidebar';
import { requireAccountPage } from '@/lib/accounts';
import { createSupabaseAdminClient } from '@/lib/supabase/admin';
import { createSignedUrl } from '@/lib/storage/videoAssets';
import type { Project, SavedVideo } from '@/lib/projects/types';
import { PublishVideoClient } from './PublishVideoClient';

export const dynamic = 'force-dynamic';

export default async function PublishVideoPage({ params }: { params: { id: string } }) {
  const { supabase, account } = await requireAccountPage();

  const { data: video } = await supabase
    .from('videos')
    .select('*')
    .eq('id', params.id)
    .eq('account_id', account.id)
    .maybeSingle<SavedVideo>();

  if (!video) {
    notFound();
  }

  const assetClient = createSupabaseAdminClient() ?? supabase;

  const [{ data: project }, { data: thumbnailAssets }] = await Promise.all([
    supabase
      .from('projects')
      .select('*')
      .eq('id', video.project_id)
      .eq('account_id', account.id)
      .maybeSingle<Project>(),
    assetClient
      .from('video_assets')
      .select('kind,storage_path,segment_index,created_at')
      .eq('video_id', video.id)
      .eq('account_id', account.id)
      .in('kind', ['thumbnail', 'image', 'uploaded_image'])
      .order('segment_index', { ascending: true })
      .order('created_at', { ascending: false }),
  ]);

  const fallbackThumbnailPath = (thumbnailAssets ?? []).find((asset) => asset.kind === 'thumbnail')?.storage_path
    ?? (thumbnailAssets ?? []).find((asset) => asset.kind === 'image' || asset.kind === 'uploaded_image')?.storage_path
    ?? null;
  const thumbnailPath = video.thumbnail_path ?? fallbackThumbnailPath ?? null;

  const videoPath = video.edited_video_path || video.final_video_path;
  const [videoUrl, thumbnailUrl] = await Promise.all([
    createSignedUrl(assetClient, videoPath),
    createSignedUrl(assetClient, thumbnailPath),
  ]);

  return (
    <div className="min-h-screen bg-gray-950 text-white lg:flex">
      <AppSidebar />
      <main className="min-w-0 flex-1 px-4 py-8">
        <PublishVideoClient
          videoId={video.id}
          videoTitle={video.title}
          videoUrl={videoUrl}
          projectName={project?.name ?? 'Project'}
          projectNiche={project?.niche ?? ''}
          initialThumbnailUrl={thumbnailUrl}
          initialThumbnailPath={thumbnailPath}
          initialThumbnailPrompt={video.thumbnail_prompt ?? ''}
          initialThumbnailSource={video.thumbnail_source ?? 'default'}
        />
      </main>
    </div>
  );
}
