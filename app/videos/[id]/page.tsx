import Link from 'next/link';
import { notFound } from 'next/navigation';
import { AppSidebar } from '@/app/components/layout/AppSidebar';
import { requireAccountPage } from '@/lib/accounts';
import { createSupabaseAdminClient } from '@/lib/supabase/admin';
import { createSignedUrl } from '@/lib/storage/videoAssets';
import { formatUsd } from '@/lib/pricing';
import { VideoRetryButton } from './VideoRetryButton';
import { YouTubeAnalyticsCard, type PublishedYouTubePostView, type YouTubeAnalyticsView } from './YouTubeAnalyticsCard';
import type { Project, SavedVideo, VideoAsset } from '@/lib/projects/types';

export const dynamic = 'force-dynamic';

function JsonBlock({ value }: { value: unknown }) {
  return (
    <pre className="max-h-96 overflow-auto rounded-lg border border-gray-800 bg-gray-950 p-4 text-xs leading-5 text-gray-300">
      {JSON.stringify(value, null, 2)}
    </pre>
  );
}

export default async function VideoDetailPage({ params }: { params: { id: string } }) {
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

  const [{ data: project }, { data: assets }, { data: usageEvents }, { data: publishedYouTubePost }] = await Promise.all([
    supabase
      .from('projects')
      .select('*')
      .eq('id', video.project_id)
      .eq('account_id', account.id)
      .maybeSingle<Project>(),
    assetClient
      .from('video_assets')
      .select('*')
      .eq('video_id', video.id)
      .eq('account_id', account.id)
      .order('segment_index', { ascending: true }),
    assetClient
      .from('usage_events')
      .select('*')
      .eq('video_id', video.id)
      .eq('account_id', account.id)
      .order('created_at', { ascending: true }),
    supabase
      .from('scheduled_posts')
      .select('id,platform_post_id,platform_post_url')
      .eq('video_id', video.id)
      .eq('account_id', account.id)
      .eq('platform', 'youtube')
      .eq('status', 'published')
      .not('platform_post_id', 'is', null)
      .order('published_at', { ascending: false, nullsFirst: false })
      .limit(1)
      .maybeSingle<PublishedYouTubePostView>(),
  ]);

  const { data: youtubeAnalytics } = publishedYouTubePost
    ? await supabase
        .from('social_post_analytics')
        .select('id,views,likes,comments,shares,watch_time_minutes,average_view_duration_seconds,average_view_percentage,subscribers_gained,subscribers_lost,youtube_published_at,youtube_title,youtube_thumbnail_url,privacy_status,synced_at,raw_analytics_api_response')
        .eq('scheduled_post_id', publishedYouTubePost.id)
        .maybeSingle<YouTubeAnalyticsView>()
    : { data: null };

  const signedAssets = await Promise.all(
    ((assets ?? []) as VideoAsset[]).map(async (asset) => ({
      ...asset,
      signedUrl: await createSignedUrl(assetClient, asset.storage_path),
    })),
  );

  const finalVideoAsset = signedAssets.find((asset) => asset.kind === 'final_video');
  const finalUrl = (await createSignedUrl(assetClient, video.final_video_path)) ?? finalVideoAsset?.signedUrl ?? null;
  const imageAssets = signedAssets.filter((asset) => asset.kind === 'image' || asset.kind === 'uploaded_image');

  return (
    <div className="min-h-screen bg-gray-950 text-white lg:flex">
      <AppSidebar />
      <main className="min-w-0 flex-1 px-4 py-8">
      <div className="mx-auto max-w-6xl">
        <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-xs font-black uppercase tracking-[0.28em] text-cyan-300">
              Video detail
            </p>
            <h1 className="mt-2 text-3xl font-black tracking-normal">{video.title}</h1>
            <p className="mt-2 text-sm text-gray-400">
              {project?.name ?? 'Project'} · {video.status} · {new Date(video.created_at).toLocaleString()}
            </p>
            <p className="mt-2 text-sm font-semibold text-cyan-200">
              Cost: {formatUsd(video.actual_cost_usd ?? video.estimated_cost_usd ?? 0)}
              {video.estimated_cost_usd != null && ` · Estimate ${formatUsd(video.estimated_cost_usd)}`}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <VideoRetryButton videoId={video.id} status={video.status} />
            {video.status === 'done' && (
              <>
                {finalUrl && (
                  <a
                    href={`/api/videos/${video.id}/download`}
                    className="rounded-lg border border-emerald-700 bg-emerald-500/10 px-4 py-2 text-sm font-bold text-emerald-200 transition hover:border-emerald-400 hover:bg-emerald-500/20 hover:text-white"
                  >
                    Stáhnout MP4
                  </a>
                )}
                <Link
                  href={`/videos/${video.id}/publish`}
                  className="rounded-lg border border-purple-700 bg-purple-500/10 px-4 py-2 text-sm font-bold text-purple-200 transition hover:border-purple-400 hover:bg-purple-500/20 hover:text-white"
                >
                  Schedule Publishing
                </Link>
                <Link
                  href={`/videos/${video.id}/edit`}
                  className="rounded-lg border border-cyan-600 bg-cyan-600/10 px-4 py-2 text-sm font-bold text-cyan-300 transition hover:border-cyan-400 hover:bg-cyan-500/20 hover:text-cyan-200"
                >
                  ✏️ Editovat
                </Link>
              </>
            )}
            <Link
              href={`/videos?project=${video.project_id}`}
              className="rounded-lg border border-gray-700 px-4 py-2 text-sm font-bold text-gray-300 transition hover:border-gray-500 hover:text-white"
            >
              Všechna videa
            </Link>
            <Link
              href={`/dashboard?project=${video.project_id}`}
              className="rounded-lg border border-gray-700 px-4 py-2 text-sm font-bold text-gray-300 transition hover:border-cyan-400 hover:text-cyan-200"
            >
              Back to project
            </Link>
          </div>
        </div>

        <section className="grid gap-6 lg:grid-cols-[1.2fr_0.8fr]">
          <div className="space-y-6">
            <div className="rounded-lg border border-gray-800 bg-gray-900/70 p-4">
              <h2 className="mb-3 text-sm font-bold uppercase tracking-[0.18em] text-gray-500">
                Final video
              </h2>
              {finalUrl ? (
                <div>
                  <video src={finalUrl} controls className="w-full rounded-lg bg-black" />
                  <a
                    href={`/api/videos/${video.id}/download`}
                    className="mt-3 inline-flex rounded-lg bg-emerald-500 px-4 py-2 text-sm font-black text-gray-950 transition hover:bg-emerald-400"
                  >
                    Stáhnout MP4
                  </a>
                </div>
              ) : (
                <div className="rounded-lg border border-gray-800 bg-gray-950 p-8 text-center text-sm text-gray-500">
                  Final MP4 is not available yet.
                </div>
              )}
            </div>

            <div className="rounded-lg border border-gray-800 bg-gray-900/70 p-4">
              <h2 className="mb-3 text-sm font-bold uppercase tracking-[0.18em] text-gray-500">
                Generated images
              </h2>
              {imageAssets.length > 0 ? (
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                  {imageAssets.map((asset) => (
                    <article key={asset.id} className="rounded-lg border border-gray-800 bg-gray-950 p-2">
                      {asset.signedUrl && (
                        <img src={asset.signedUrl} alt="" className="aspect-video w-full rounded object-cover" />
                      )}
                      <p className="mt-2 line-clamp-2 text-xs text-gray-400">
                        {asset.prompt || asset.source || `Segment ${asset.segment_index}`}
                      </p>
                    </article>
                  ))}
                </div>
              ) : (
                <p className="text-sm text-gray-500">No image assets saved.</p>
              )}
            </div>
          </div>

          <div className="space-y-6">
            <div className="rounded-lg border border-gray-800 bg-gray-900/70 p-4">
              <h2 className="mb-3 text-sm font-bold uppercase tracking-[0.18em] text-gray-500">
                Original script
              </h2>
              <p className="whitespace-pre-wrap text-sm leading-6 text-gray-300">{video.original_script}</p>
            </div>

            <div className="rounded-lg border border-gray-800 bg-gray-900/70 p-4">
              <h2 className="mb-3 text-sm font-bold uppercase tracking-[0.18em] text-gray-500">
                Enhanced script
              </h2>
              <p className="whitespace-pre-wrap text-sm leading-6 text-gray-300">
                {video.enhanced_script || 'Not saved yet.'}
              </p>
            </div>
          </div>
        </section>

        {publishedYouTubePost && (
          <YouTubeAnalyticsCard
            videoId={video.id}
            publishedPost={publishedYouTubePost as PublishedYouTubePostView}
            initialAnalytics={(youtubeAnalytics ?? null) as YouTubeAnalyticsView | null}
          />
        )}

        <section className="mt-6 grid gap-6 lg:grid-cols-2">
          <div className="rounded-lg border border-gray-800 bg-gray-900/70 p-4">
            <h2 className="mb-3 text-sm font-bold uppercase tracking-[0.18em] text-gray-500">
              Settings used
            </h2>
            <JsonBlock value={video.settings} />
          </div>

          <div className="rounded-lg border border-gray-800 bg-gray-900/70 p-4">
            <h2 className="mb-3 text-sm font-bold uppercase tracking-[0.18em] text-gray-500">
              Cost breakdown
            </h2>
            <JsonBlock value={{ usage: video.usage, estimatedUsage: video.estimated_usage, costBreakdown: video.cost_breakdown }} />
          </div>
        </section>

        <section className="mt-6 rounded-lg border border-gray-800 bg-gray-900/70 p-4">
          <h2 className="mb-3 text-sm font-bold uppercase tracking-[0.18em] text-gray-500">
            Usage events
          </h2>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[780px] text-left text-sm">
              <thead className="text-xs uppercase tracking-[0.16em] text-gray-500">
                <tr>
                  <th className="py-2">Type</th>
                  <th className="py-2">Provider</th>
                  <th className="py-2">Model</th>
                  <th className="py-2">Step</th>
                  <th className="py-2">Cost</th>
                  <th className="py-2">Usage</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-800">
                {(usageEvents ?? []).map((event) => (
                  <tr key={event.id}>
                    <td className="py-2 text-gray-300">{event.estimated ? 'Estimate' : 'Actual'}</td>
                    <td className="py-2 text-gray-300">{event.provider}</td>
                    <td className="py-2 text-gray-400">{event.model ?? '-'}</td>
                    <td className="py-2 text-gray-400">{event.step}</td>
                    <td className="py-2 text-cyan-200">{formatUsd(Number(event.cost_usd ?? 0))}</td>
                    <td className="py-2 text-xs text-gray-500">{JSON.stringify(event.usage)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <section className="mt-6 rounded-lg border border-gray-800 bg-gray-900/70 p-4">
          <h2 className="mb-3 text-sm font-bold uppercase tracking-[0.18em] text-gray-500">
            Segments and captions
          </h2>
          <JsonBlock value={video.segments} />
        </section>

        <section className="mt-6 rounded-lg border border-gray-800 bg-gray-900/70 p-4">
          <h2 className="mb-3 text-sm font-bold uppercase tracking-[0.18em] text-gray-500">
            Assets
          </h2>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] text-left text-sm">
              <thead className="text-xs uppercase tracking-[0.16em] text-gray-500">
                <tr>
                  <th className="py-2">Kind</th>
                  <th className="py-2">Segment</th>
                  <th className="py-2">Source</th>
                  <th className="py-2">Size</th>
                  <th className="py-2">File</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-800">
                {signedAssets.map((asset) => (
                  <tr key={asset.id}>
                    <td className="py-2 text-gray-200">{asset.kind}</td>
                    <td className="py-2 text-gray-400">{asset.segment_index ?? '-'}</td>
                    <td className="py-2 text-gray-400">{asset.source ?? '-'}</td>
                    <td className="py-2 text-gray-400">{asset.size_bytes ? `${Math.round(asset.size_bytes / 1024)} KB` : '-'}</td>
                    <td className="py-2">
                      {asset.signedUrl ? (
                        <a href={asset.signedUrl} target="_blank" rel="noreferrer" className="text-cyan-300 hover:text-cyan-100">
                          Open
                        </a>
                      ) : (
                        <span className="text-gray-600">Unavailable</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      </div>
      </main>
    </div>
  );
}
