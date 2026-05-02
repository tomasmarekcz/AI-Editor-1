import { redirect } from 'next/navigation';
import { AppSidebar } from '@/app/components/layout/AppSidebar';
import { requireAccountPage } from '@/lib/accounts';
import type { Project } from '@/lib/projects/types';
import { ProjectsClient } from './ProjectsClient';

export const dynamic = 'force-dynamic';

export default async function ProjectsPage() {
  const { supabase, user, account } = await requireAccountPage();

  const { data: projects, error } = await supabase
    .from('projects')
    .select('*')
    .eq('account_id', account.id)
    .order('created_at', { ascending: false });

  if (error) {
    return (
      <main className="min-h-screen bg-gray-950 px-6 py-10 text-white">
        <div className="mx-auto max-w-2xl rounded-lg border border-red-900 bg-red-950/40 p-6">
          <p className="text-sm font-bold text-red-200">Projects table is not ready yet.</p>
          <p className="mt-2 text-sm leading-6 text-red-100/80">
            Supabase returned: {error.message}
          </p>
        </div>
      </main>
    );
  }

  return (
    <div className="min-h-screen bg-gray-950 text-white lg:flex">
      <AppSidebar />
      <div className="min-w-0 flex-1">
        <ProjectsClient
          initialProjects={(projects ?? []) as Project[]}
          userId={user.id}
          accountId={account.id}
          userEmail={user.email ?? 'Unknown user'}
        />
      </div>
    </div>
  );
}
