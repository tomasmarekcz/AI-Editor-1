import { redirect } from 'next/navigation';
import { AppSidebar } from '@/app/components/layout/AppSidebar';
import { requireAccountPage } from '@/lib/accounts';
import { createSignedUrl } from '@/lib/storage/videoAssets';
import { VideosClient } from './VideosClient';
import type { Project } from '@/lib/projects/types';

export const dynamic = 'force-dynamic';

export type VideoListItem = {
  id: string;
  title: string;
  status: string;
  created_at: string;
  completed_at: string | null;
  render_progress: number;
  duration_seconds: number | null;
  final_video_path: string | null;
  thumbnail_path: string | null;
  error_message: string | null;
  estimated_cost_usd: number | null;
  actual_cost_usd: number | null;
  project_id: string;
  project_name: string | null;
  thumbnailUrl: string | null;
};

export default async function VideosPage({
  searchParams,
}: {
  searchParams: { project?: string };
}) {
  const { supabase, account } = await requireAccountPage();

  const [{ data: videosRaw }, { data: projects }] = await Promise.all([
    supabase
      .from('videos')
      .select(`
        id, title, status, created_at, completed_at,
        render_progress, duration_seconds, final_video_path,
        thumbnail_path, error_message,
        estimated_cost_usd, actual_cost_usd, project_id
      `)
      .eq('account_id', account.id)
      .order('created_at', { ascending: false })
      .limit(200),
    supabase
      .from('projects')
      .select('id,name')
      .eq('account_id', account.id)
      .order('name'),
  ]);

  const projectNameById: Record<string, string> = {};
  for (const p of (projects ?? [])) {
    projectNameById[p.id] = p.name;
  }

  const videos: VideoListItem[] = await Promise.all(
    (videosRaw ?? []).map(async (v) => ({
      ...v,
      project_name: projectNameById[v.project_id] ?? null,
      thumbnailUrl: v.thumbnail_path
        ? await createSignedUrl(supabase, v.thumbnail_path, 3600)
        : null,
    })),
  );

  return (
    <div className="min-h-screen bg-gray-950 text-white lg:flex">
      <AppSidebar />
      <main className="min-w-0 flex-1 px-4 py-8">
        <VideosClient
          videos={videos}
          projects={(projects ?? []) as Pick<Project, 'id' | 'name'>[]}
          initialProjectFilter={searchParams.project ?? null}
        />
      </main>
    </div>
  );
}
