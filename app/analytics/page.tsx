import { AppSidebar } from '@/app/components/layout/AppSidebar';
import { requireAccountPage } from '@/lib/accounts';
import { AnalyticsDashboardClient, type AnalyticsDashboardData, type AnalyticsProject } from './AnalyticsDashboardClient';

export const dynamic = 'force-dynamic';

type ProjectRow = {
  id: string;
  name: string;
};

type ConnectionRow = {
  id: string;
  project_id: string | null;
  status: string;
  platform_channel_title: string | null;
  platform_channel_url: string | null;
  scopes: string[] | null;
};

type PublishedPostRow = {
  id: string;
  video_id: string;
  project_id: string;
  platform_post_id: string | null;
  platform_post_url: string | null;
  published_at: string | null;
  title: string | null;
};

type VideoRow = {
  id: string;
  title: string;
};

type AnalyticsRow = {
  id?: string;
  video_id: string;
  scheduled_post_id: string;
  platform_post_id: string;
  views: number | null;
  likes: number | null;
  comments: number | null;
  youtube_published_at: string | null;
  youtube_title: string | null;
  youtube_thumbnail_url: string | null;
  synced_at: string | null;
};

function pickSelectedProject({
  queryProjectId,
  projects,
  connections,
}: {
  queryProjectId?: string;
  projects: ProjectRow[];
  connections: ConnectionRow[];
}) {
  if (queryProjectId && projects.some((project) => project.id === queryProjectId)) return queryProjectId;

  const connectedProjectId = connections.find((connection) => (
    connection.status === 'connected'
    && connection.project_id
    && projects.some((project) => project.id === connection.project_id)
  ))?.project_id;

  return connectedProjectId ?? projects[0]?.id ?? '';
}

function numberValue(value: number | null | undefined) {
  return Number(value ?? 0);
}

export default async function AnalyticsPage({
  searchParams,
}: {
  searchParams: { project?: string };
}) {
  const { supabase, account } = await requireAccountPage();

  const [{ data: projectsRaw }, { data: connectionsRaw }] = await Promise.all([
    supabase
      .from('projects')
      .select('id,name')
      .eq('account_id', account.id)
      .order('name')
      .returns<ProjectRow[]>(),
    supabase
      .from('social_connections')
      .select('id,project_id,status,platform_channel_title,platform_channel_url,scopes')
      .eq('account_id', account.id)
      .eq('platform', 'youtube')
      .returns<ConnectionRow[]>(),
  ]);

  const projects = projectsRaw ?? [];
  const connections = connectionsRaw ?? [];
  const selectedProjectId = pickSelectedProject({
    queryProjectId: searchParams.project,
    projects,
    connections,
  });
  const selectedProject = projects.find((project) => project.id === selectedProjectId) ?? null;
  const selectedConnection = connections.find((connection) => connection.project_id === selectedProjectId) ?? null;

  const { data: postsRaw } = selectedProjectId
    ? await supabase
      .from('scheduled_posts')
      .select('id,video_id,project_id,platform_post_id,platform_post_url,published_at,title')
      .eq('account_id', account.id)
      .eq('project_id', selectedProjectId)
      .eq('platform', 'youtube')
      .eq('status', 'published')
      .not('platform_post_id', 'is', null)
      .order('published_at', { ascending: false, nullsFirst: false })
      .returns<PublishedPostRow[]>()
    : { data: [] };

  const posts = postsRaw ?? [];
  const postIds = posts.map((post) => post.id);
  const videoIds = Array.from(new Set(posts.map((post) => post.video_id)));

  const [{ data: videosRaw }, { data: analyticsRaw }] = await Promise.all([
    videoIds.length
      ? supabase
        .from('videos')
        .select('id,title')
        .eq('account_id', account.id)
        .in('id', videoIds)
        .returns<VideoRow[]>()
      : Promise.resolve({ data: [] }),
    postIds.length
      ? supabase
        .from('social_post_analytics')
        .select('id,video_id,scheduled_post_id,platform_post_id,views,likes,comments,youtube_published_at,youtube_title,youtube_thumbnail_url,synced_at')
        .eq('account_id', account.id)
        .in('scheduled_post_id', postIds)
        .returns<AnalyticsRow[]>()
      : Promise.resolve({ data: [] }),
  ]);

  const videoTitleById = new Map((videosRaw ?? []).map((video) => [video.id, video.title]));
  const analyticsByPostId = new Map((analyticsRaw ?? []).map((analytics) => [analytics.scheduled_post_id, analytics]));

  const videos = posts
    .map((post) => {
      const analytics = analyticsByPostId.get(post.id);
      return {
        scheduledPostId: post.id,
        videoId: post.video_id,
        platformPostId: post.platform_post_id,
        youtubeUrl: post.platform_post_url,
        title: analytics?.youtube_title || post.title || videoTitleById.get(post.video_id) || 'Untitled video',
        thumbnailUrl: analytics?.youtube_thumbnail_url ?? null,
        publishedAt: analytics?.youtube_published_at ?? post.published_at,
        views: numberValue(analytics?.views),
        likes: numberValue(analytics?.likes),
        comments: numberValue(analytics?.comments),
        syncedAt: analytics?.synced_at ?? null,
      };
    })
    .sort((a, b) => b.views - a.views);

  const syncedValues = videos.map((video) => video.syncedAt).filter(Boolean) as string[];
  const lastSynced = syncedValues.length
    ? syncedValues.sort((a, b) => new Date(b).getTime() - new Date(a).getTime())[0]
    : null;

  const dashboard: AnalyticsDashboardData = {
    selectedProjectId,
    selectedProjectName: selectedProject?.name ?? null,
    youtubeConnected: selectedConnection?.status === 'connected',
    channelTitle: selectedConnection?.platform_channel_title ?? null,
    channelUrl: selectedConnection?.platform_channel_url ?? null,
    hasAnalyticsScope: Boolean(selectedConnection?.scopes?.includes('https://www.googleapis.com/auth/yt-analytics.readonly')),
    subscriberCount: null,
    hiddenSubscriberCount: false,
    lastSynced,
    videos,
  };

  const projectOptions: AnalyticsProject[] = projects.map((project) => {
    const connection = connections.find((item) => item.project_id === project.id);
    return {
      id: project.id,
      name: project.name,
      youtubeConnected: connection?.status === 'connected',
      channelTitle: connection?.platform_channel_title ?? null,
    };
  });

  return (
    <div className="min-h-screen bg-gray-950 text-white lg:flex">
      <AppSidebar />
      <main className="min-w-0 flex-1 px-4 py-8">
        <AnalyticsDashboardClient
          projects={projectOptions}
          initialDashboard={dashboard}
        />
      </main>
    </div>
  );
}
