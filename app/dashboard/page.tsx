import { redirect } from 'next/navigation';
import { AppSidebar } from '@/app/components/layout/AppSidebar';
import { requireAccountPage } from '@/lib/accounts';
import { createSupabaseAdminClient } from '@/lib/supabase/admin';
import { createSignedUrl } from '@/lib/storage/videoAssets';
import type { Project } from '@/lib/projects/types';
import VideoDashboard, { type DashboardResumeVideo } from './VideoDashboard';

export const dynamic = 'force-dynamic';

type Profile = {
  email: string | null;
  plan: string | null;
};

export default async function DashboardPage({
  searchParams,
}: {
  searchParams?: { project?: string; resumeVideo?: string };
}) {
  const { supabase, user, account } = await requireAccountPage();

  const projectId = searchParams?.project;
  if (!projectId) {
    redirect('/projects');
  }

  const { data: project } = await supabase
    .from('projects')
    .select('*')
    .eq('id', projectId)
    .eq('account_id', account.id)
    .maybeSingle<Project>();

  if (!project) {
    redirect('/projects');
  }

  const { data: profile } = await supabase
    .from('profiles')
    .select('email, plan')
    .eq('id', user.id)
    .maybeSingle<Profile>();

  const email = profile?.email || user.email || 'Unknown user';
  const plan = account.plan || profile?.plan || 'free';
  const assetClient = createSupabaseAdminClient() ?? supabase;

  let resumeVideo: DashboardResumeVideo | null = null;
  if (searchParams?.resumeVideo) {
    const { data: video } = await supabase
      .from('videos')
      .select('id,title,status,current_step,original_script,settings,segments,render_progress,error_message')
      .eq('id', searchParams.resumeVideo)
      .eq('project_id', project.id)
      .eq('account_id', account.id)
      .maybeSingle<{
        id: string;
        title: string;
        status: string;
        current_step: string | null;
        original_script: string | null;
        settings: unknown;
        segments: unknown;
        render_progress: number | null;
        error_message: string | null;
      }>();

    if (video) {
      const segments = Array.isArray(video.segments) ? video.segments : [];
      const { data: imageAssets } = segments.length > 0
        ? await assetClient
          .from('video_assets')
          .select('segment_index,storage_path,prompt,source,metadata,created_at')
          .eq('video_id', video.id)
          .eq('account_id', account.id)
          .in('kind', ['image', 'uploaded_image'])
          .order('created_at', { ascending: false })
        : { data: [] };

      const usedIndexes = new Set<number>();
      const imageUrlsByIndex: Record<number, string> = {};
      for (const asset of imageAssets ?? []) {
        const index = Number(asset.segment_index);
        if (!Number.isInteger(index) || usedIndexes.has(index)) continue;
        const signedUrl = await createSignedUrl(assetClient, String(asset.storage_path), 3600);
        if (!signedUrl) continue;
        usedIndexes.add(index);
        imageUrlsByIndex[index] = signedUrl;
      }

      resumeVideo = {
        id: video.id,
        title: video.title,
        status: video.status,
        currentStep: video.current_step,
        originalScript: video.original_script ?? '',
        settings: video.settings,
        segments,
        renderProgress: video.render_progress ?? 0,
        errorMessage: video.error_message,
        imageUrlsByIndex,
      };
    }
  }

  return (
    <div className="min-h-screen bg-gray-950 text-white lg:flex">
      <AppSidebar />
      <div className="min-w-0 flex-1">
      <header className="border-b border-gray-800 bg-gray-950/95 px-4 py-3">
        <div className="mx-auto flex max-w-7xl flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.22em] text-cyan-300">
              Dashboard
            </p>
            <p className="mt-1 text-sm text-gray-400">
              {email} · Workspace: <span className="font-bold text-white">{account.name}</span> · Role: <span className="font-bold text-white">{account.role}</span> · Plan: <span className="font-bold text-white">{plan}</span> · Project: <span className="font-bold text-white">{project.name}</span>
            </p>
          </div>
          <form action="/auth/logout" method="post">
            <button className="rounded-lg border border-gray-700 px-4 py-2 text-sm font-bold text-gray-200 transition hover:border-red-400 hover:text-red-200">
              Logout
            </button>
          </form>
        </div>
      </header>
      <VideoDashboard
        projectId={project.id}
        projectName={project.name}
        initialSettings={project.default_settings}
        resumeVideo={resumeVideo}
        shouldSaveFirstVideoDefaults={!project.default_settings || Object.keys(project.default_settings).length === 0}
      />
      </div>
    </div>
  );
}
