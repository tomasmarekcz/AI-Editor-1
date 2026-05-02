import { redirect } from 'next/navigation';
import { AppSidebar } from '@/app/components/layout/AppSidebar';
import { requireAccountPage } from '@/lib/accounts';
import type { Project } from '@/lib/projects/types';
import VideoDashboard from './VideoDashboard';

export const dynamic = 'force-dynamic';

type Profile = {
  email: string | null;
  plan: string | null;
};

export default async function DashboardPage({
  searchParams,
}: {
  searchParams?: { project?: string };
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
        shouldSaveFirstVideoDefaults={!project.default_settings || Object.keys(project.default_settings).length === 0}
      />
      </div>
    </div>
  );
}
