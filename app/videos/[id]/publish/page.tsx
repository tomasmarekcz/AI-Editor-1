import { notFound } from 'next/navigation';
import { AppSidebar } from '@/app/components/layout/AppSidebar';
import { requireAccountPage } from '@/lib/accounts';
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

  const { data: project } = await supabase
    .from('projects')
    .select('*')
    .eq('id', video.project_id)
    .eq('account_id', account.id)
    .maybeSingle<Project>();

  const videoPath = video.edited_video_path || video.final_video_path;
  const videoUrl = await createSignedUrl(supabase, videoPath);

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
        />
      </main>
    </div>
  );
}
