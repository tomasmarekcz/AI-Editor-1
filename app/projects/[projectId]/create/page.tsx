import Link from 'next/link';
import { redirect } from 'next/navigation';
import { AppSidebar } from '@/app/components/layout/AppSidebar';
import { requireAccountPage } from '@/lib/accounts';
import { createSignedUrl } from '@/lib/storage/videoAssets';
import type { Project, ProjectCreateVideoItem, SavedVideo } from '@/lib/projects/types';
import { ProjectCreateClient } from './ProjectCreateClient';

export const dynamic = 'force-dynamic';

export default async function ProjectCreatePage({
  params,
}: {
  params: { projectId: string };
}) {
  const { supabase, account } = await requireAccountPage();

  const { data: project } = await supabase
    .from('projects')
    .select('*')
    .eq('id', params.projectId)
    .eq('account_id', account.id)
    .maybeSingle<Project>();

  if (!project) {
    redirect('/projects');
  }

  const { data: videosRaw } = await supabase
    .from('videos')
    .select('id,title,status,created_at,completed_at,render_progress,thumbnail_path,error_message,estimated_cost_usd,actual_cost_usd,duration_seconds')
    .eq('project_id', project.id)
    .eq('account_id', account.id)
    .order('created_at', { ascending: false })
    .limit(12);

  const videos: ProjectCreateVideoItem[] = await Promise.all(
    ((videosRaw ?? []) as Pick<
      SavedVideo,
      'id' | 'title' | 'status' | 'created_at' | 'completed_at' | 'render_progress' | 'thumbnail_path' | 'error_message'
      | 'estimated_cost_usd' | 'actual_cost_usd' | 'duration_seconds'
    >[]).map(async (video) => ({
      ...video,
      thumbnailUrl: await createSignedUrl(supabase, video.thumbnail_path),
    })),
  );

  return (
    <div className="min-h-screen bg-gray-950 text-white lg:flex">
      <AppSidebar />
      <div className="min-w-0 flex-1">
        <header className="border-b border-gray-800 bg-gray-950/95 px-4 py-3">
          <div className="mx-auto flex max-w-7xl flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="text-xs font-bold uppercase tracking-[0.22em] text-cyan-300">
                Create Video
              </p>
              <p className="mt-1 text-sm text-gray-400">
                Project: <span className="font-bold text-white">{project.name}</span>
              </p>
            </div>
            <div className="flex gap-2">
              <Link
                href={`/videos?project=${project.id}`}
                className="rounded-lg border border-gray-700 px-4 py-2 text-sm font-bold text-gray-200 transition hover:border-cyan-400 hover:text-cyan-200"
              >
                Video history
              </Link>
              <Link
                href="/projects"
                className="rounded-lg border border-gray-700 px-4 py-2 text-sm font-bold text-gray-400 transition hover:border-gray-500 hover:text-white"
              >
                Projects
              </Link>
            </div>
          </div>
        </header>
        <ProjectCreateClient project={project} videos={videos} />
      </div>
    </div>
  );
}
