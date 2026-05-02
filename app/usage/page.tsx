import { AppSidebar } from '@/app/components/layout/AppSidebar';
import { formatUsd } from '@/lib/pricing';
import { requireAccountPage } from '@/lib/accounts';

export const dynamic = 'force-dynamic';

export default async function UsagePage() {
  const { supabase, account } = await requireAccountPage();

  const [{ data: videos }, { data: events }, { data: projects }] = await Promise.all([
    supabase.from('videos').select('id,project_id,actual_cost_usd,estimated_cost_usd,generated_images_count,tts_duration_seconds,transcription_duration_seconds,status').eq('account_id', account.id),
    supabase.from('usage_events').select('provider,step,cost_usd,usage,estimated,project_id').eq('account_id', account.id),
    supabase.from('projects').select('id,name').eq('account_id', account.id),
  ]);

  const actualEvents = (events ?? []).filter((event) => !event.estimated);
  const totalVideos = videos?.length ?? 0;
  const totalCost = (videos ?? []).reduce((sum, video) => sum + Number(video.actual_cost_usd ?? video.estimated_cost_usd ?? 0), 0);
  const totalImages = (videos ?? []).reduce((sum, video) => sum + Number(video.generated_images_count ?? 0), 0);
  const totalTtsSeconds = (videos ?? []).reduce((sum, video) => sum + Number(video.tts_duration_seconds ?? 0), 0);
  const providerTotals: Record<string, number> = {};
  const projectTotals: Record<string, number> = {};
  for (const event of actualEvents) {
    providerTotals[event.provider] = (providerTotals[event.provider] ?? 0) + Number(event.cost_usd ?? 0);
    projectTotals[event.project_id] = (projectTotals[event.project_id] ?? 0) + Number(event.cost_usd ?? 0);
  }
  const projectNames = Object.fromEntries((projects ?? []).map((project) => [project.id, project.name]));

  return (
    <div className="min-h-screen bg-gray-950 text-white lg:flex">
      <AppSidebar />
      <main className="flex-1 px-4 py-8">
        <div className="mx-auto max-w-6xl">
          <p className="text-xs font-black uppercase tracking-[0.28em] text-cyan-300">Usage</p>
          <h1 className="mt-2 text-4xl font-black tracking-normal">Usage and cost</h1>

          <section className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {[
              ['Videos', String(totalVideos)],
              ['Generated images', String(totalImages)],
              ['Total cost', formatUsd(totalCost)],
              ['Avg / video', formatUsd(totalVideos ? totalCost / totalVideos : 0)],
            ].map(([label, value]) => (
              <div key={label} className="rounded-lg border border-gray-800 bg-gray-900/70 p-4">
                <p className="text-xs uppercase tracking-[0.18em] text-gray-500">{label}</p>
                <p className="mt-2 text-3xl font-black">{value}</p>
              </div>
            ))}
          </section>

          <section className="mt-6 grid gap-6 lg:grid-cols-2">
            <div className="rounded-lg border border-gray-800 bg-gray-900/70 p-4">
              <h2 className="mb-3 text-sm font-bold uppercase tracking-[0.18em] text-gray-500">By provider</h2>
              {Object.entries(providerTotals).map(([provider, value]) => (
                <div key={provider} className="flex justify-between border-b border-gray-800 py-2 text-sm">
                  <span>{provider}</span>
                  <span className="font-bold text-cyan-200">{formatUsd(value)}</span>
                </div>
              ))}
            </div>
            <div className="rounded-lg border border-gray-800 bg-gray-900/70 p-4">
              <h2 className="mb-3 text-sm font-bold uppercase tracking-[0.18em] text-gray-500">By project</h2>
              {Object.entries(projectTotals).map(([projectId, value]) => (
                <div key={projectId} className="flex justify-between border-b border-gray-800 py-2 text-sm">
                  <span>{projectNames[projectId] ?? projectId}</span>
                  <span className="font-bold text-cyan-200">{formatUsd(value)}</span>
                </div>
              ))}
            </div>
          </section>

          <section className="mt-6 rounded-lg border border-gray-800 bg-gray-900/70 p-4">
            <h2 className="mb-3 text-sm font-bold uppercase tracking-[0.18em] text-gray-500">Audio usage</h2>
            <p className="text-sm text-gray-300">Total TTS: {Math.round(totalTtsSeconds)} seconds</p>
          </section>
        </div>
      </main>
    </div>
  );
}
