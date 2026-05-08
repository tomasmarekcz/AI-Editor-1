import { AppSidebar } from '@/app/components/layout/AppSidebar';
import { requireAccountPage } from '@/lib/accounts';
import { CalendarClient, type CalendarPost, type CalendarProject } from './CalendarClient';

export const dynamic = 'force-dynamic';

function currentMonth() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}

function cleanMonth(value?: string) {
  return value && /^\d{4}-\d{2}$/.test(value) ? value : currentMonth();
}

function monthRange(month: string) {
  const [year, monthIndex] = month.split('-').map(Number);
  const start = new Date(Date.UTC(year, monthIndex - 1, 1, 0, 0, 0));
  const end = new Date(Date.UTC(year, monthIndex, 1, 0, 0, 0));
  return { start: start.toISOString(), end: end.toISOString() };
}

type ScheduledPostRow = {
  id: string;
  video_id: string;
  project_id: string | null;
  platform: string;
  status: string;
  scheduled_for: string;
  title: string | null;
};

type VideoTitleRow = {
  id: string;
  title: string;
};

export default async function CalendarPage({
  searchParams,
}: {
  searchParams: { month?: string; project?: string };
}) {
  const { supabase, account } = await requireAccountPage();
  const month = cleanMonth(searchParams.month);
  const selectedProject = searchParams.project ?? '';
  const { start, end } = monthRange(month);

  const { data: projects } = await supabase
    .from('projects')
    .select('id,name')
    .eq('account_id', account.id)
    .order('name');

  let postsQuery = supabase
    .from('scheduled_posts')
    .select('id,video_id,project_id,platform,status,scheduled_for,title')
    .eq('account_id', account.id)
    .gte('scheduled_for', start)
    .lt('scheduled_for', end)
    .order('scheduled_for', { ascending: true });

  if (selectedProject) postsQuery = postsQuery.eq('project_id', selectedProject);

  const { data: postsRaw } = await postsQuery.returns<ScheduledPostRow[]>();
  const videoIds = Array.from(new Set((postsRaw ?? []).map((post) => post.video_id)));
  const { data: videos } = videoIds.length
    ? await supabase
      .from('videos')
      .select('id,title')
      .eq('account_id', account.id)
      .in('id', videoIds)
      .returns<VideoTitleRow[]>()
    : { data: [] };

  const projectNameById = Object.fromEntries(((projects ?? []) as CalendarProject[]).map((project) => [project.id, project.name]));
  const videoTitleById = Object.fromEntries((videos ?? []).map((video) => [video.id, video.title]));
  const posts: CalendarPost[] = (postsRaw ?? []).map((post) => ({
    id: post.id,
    video_id: post.video_id,
    project_id: post.project_id,
    platform: post.platform,
    status: post.status,
    scheduled_for: post.scheduled_for,
    title: post.title || videoTitleById[post.video_id] || 'Untitled video',
    projectName: post.project_id ? projectNameById[post.project_id] ?? 'Project' : 'Project',
  }));

  return (
    <div className="min-h-screen bg-gray-950 text-white lg:flex">
      <AppSidebar />
      <main className="min-w-0 flex-1 px-4 py-8">
        <CalendarClient
          month={month}
          selectedProject={selectedProject}
          projects={(projects ?? []) as CalendarProject[]}
          posts={posts}
        />
      </main>
    </div>
  );
}
