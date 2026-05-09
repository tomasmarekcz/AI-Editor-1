import Link from 'next/link';
import { createClient, hasSupabaseEnv } from '@/lib/supabase/server';
import { getCurrentAccount } from '@/lib/accounts';

export async function AppSidebar() {
  if (!hasSupabaseEnv()) return null;

  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return null;

  const account = await getCurrentAccount(supabase, user.email, user.id);
  if (!account) return null;

  const [{ data: projects }, { count: videoCount }] = await Promise.all([
    supabase
      .from('projects')
      .select('id,name')
      .eq('account_id', account.id)
      .order('name'),
    supabase
      .from('videos')
      .select('id', { count: 'exact', head: true })
      .eq('account_id', account.id),
  ]);

  return (
    <aside className="min-h-screen w-full border-b border-gray-800 bg-gray-950 px-4 py-5 text-white lg:sticky lg:top-0 lg:w-64 lg:border-b-0 lg:border-r">
      {/* Projects */}
      <Link href="/projects" className="block text-sm font-black uppercase tracking-[0.22em] text-cyan-300">
        {account.name}
      </Link>
      <p className="mt-1 text-xs font-semibold uppercase tracking-[0.18em] text-gray-600">{account.role}</p>
      <nav className="mt-3 space-y-0.5">
        {(projects ?? []).map((project) => (
          <Link
            key={project.id}
            href={`/projects/${project.id}/create`}
            className="block rounded-lg px-3 py-2 text-sm text-gray-300 transition hover:bg-gray-900 hover:text-white"
          >
            {project.name}
          </Link>
        ))}
      </nav>

      {/* Videos */}
      <div className="mt-6">
        <Link
          href="/videos"
          className="flex items-center justify-between text-sm font-black uppercase tracking-[0.22em] text-cyan-300 hover:text-cyan-200 transition"
        >
          <span>Videos</span>
          {(videoCount ?? 0) > 0 && (
            <span className="rounded-full bg-gray-800 px-2 py-0.5 text-[10px] font-bold text-gray-400 normal-case tracking-normal">
              {videoCount}
            </span>
          )}
        </Link>
        <nav className="mt-3 space-y-0.5">
          {(projects ?? []).map((project) => (
            <Link
              key={project.id}
              href={`/videos?project=${project.id}`}
              className="block rounded-lg px-3 py-2 text-sm text-gray-400 transition hover:bg-gray-900 hover:text-white"
            >
              {project.name}
            </Link>
          ))}
        </nav>
      </div>

      {/* Calendar */}
      <div className="mt-6">
        <Link
          href="/calendar"
          className="block text-sm font-black uppercase tracking-[0.22em] text-cyan-300 transition hover:text-cyan-200"
        >
          Calendar
        </Link>
        <nav className="mt-3 space-y-0.5">
          {(projects ?? []).map((project) => (
            <Link
              key={project.id}
              href={`/calendar?project=${project.id}`}
              className="block rounded-lg px-3 py-2 text-sm text-gray-400 transition hover:bg-gray-900 hover:text-white"
            >
              {project.name}
            </Link>
          ))}
        </nav>
      </div>

      {/* Utility links */}
      <div className="mt-6 space-y-1 border-t border-gray-800 pt-5">
        <Link href="/usage" className="block rounded-lg px-3 py-2 text-sm font-semibold text-gray-300 transition hover:bg-gray-900 hover:text-white">
          Usage
        </Link>
        <Link href="/settings" className="block rounded-lg px-3 py-2 text-sm font-semibold text-gray-300 transition hover:bg-gray-900 hover:text-white">
          Settings
        </Link>
      </div>

      <form action="/auth/logout" method="post" className="mt-8">
        <button className="w-full rounded-lg border border-gray-700 px-3 py-2 text-sm font-bold text-gray-300 transition hover:border-red-400 hover:text-red-200">
          Logout
        </button>
      </form>
    </aside>
  );
}
