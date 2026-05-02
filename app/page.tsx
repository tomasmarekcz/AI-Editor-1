import Link from 'next/link';
import { redirect } from 'next/navigation';
import { LoginForm } from './login/LoginForm';
import { createClient, hasSupabaseEnv } from '@/lib/supabase/server';
import { getCurrentAccount } from '@/lib/accounts';

export const dynamic = 'force-dynamic';

export default async function HomePage() {
  if (hasSupabaseEnv()) {
    const supabase = createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (user) {
      const account = await getCurrentAccount(supabase, user.email, user.id);
      if (!account) redirect('/access-denied');
      redirect('/projects');
    }
  }

  return (
    <main className="min-h-screen overflow-hidden bg-gray-950 text-white">
      <section className="relative flex min-h-screen items-center px-6 py-10">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_20%_20%,rgba(34,211,238,0.12),transparent_32%),linear-gradient(135deg,rgba(15,23,42,0.9),rgba(3,7,18,1)_55%,rgba(5,46,22,0.45))]" />
        <div className="relative mx-auto grid w-full max-w-6xl gap-8 lg:grid-cols-[1.1fr_0.9fr] lg:items-center">
          <div className="max-w-2xl">
            <p className="mb-5 text-xs font-black uppercase tracking-[0.28em] text-cyan-300">
              AI Video Generator
            </p>
            <h1 className="text-5xl font-black leading-[0.95] tracking-normal text-white sm:text-7xl">
              Prompt-to-Reel in 30 seconds.
            </h1>
            <p className="mt-6 max-w-xl text-lg leading-8 text-gray-300">
              Napiš scénář, vyber hlas a nech aplikaci připravit krátké video se scénami, voiceoverem a titulky.
            </p>
            <div className="mt-8 flex flex-wrap gap-3 text-sm font-bold text-gray-300">
              <span className="rounded-lg border border-gray-700 bg-gray-900/60 px-3 py-2">Script</span>
              <span className="rounded-lg border border-gray-700 bg-gray-900/60 px-3 py-2">Voiceover</span>
              <span className="rounded-lg border border-gray-700 bg-gray-900/60 px-3 py-2">Images</span>
              <span className="rounded-lg border border-gray-700 bg-gray-900/60 px-3 py-2">Subtitles</span>
            </div>
          </div>

          <div className="rounded-lg border border-gray-800 bg-gray-900/80 p-5 shadow-2xl shadow-black/30 backdrop-blur">
            <div className="mb-5 flex items-center justify-between gap-4">
              <div>
                <p className="text-xs font-bold uppercase tracking-[0.22em] text-gray-500">
                  Sign in
                </p>
                <h2 className="mt-1 text-2xl font-black tracking-normal">Start creating</h2>
              </div>
              <Link
                href="/login"
                className="rounded-lg border border-gray-700 px-3 py-2 text-xs font-bold uppercase tracking-[0.16em] text-gray-300 transition hover:border-cyan-400 hover:text-cyan-200"
              >
                Login page
              </Link>
            </div>
            <LoginForm compact />
            <div className="mt-6 grid grid-cols-3 gap-2">
              <div className="h-24 rounded-lg border border-gray-800 bg-gray-950 p-2">
                <div className="h-3 w-14 rounded bg-cyan-300" />
                <div className="mt-3 h-2 w-full rounded bg-gray-700" />
                <div className="mt-2 h-2 w-2/3 rounded bg-gray-800" />
              </div>
              <div className="h-24 rounded-lg border border-gray-800 bg-gray-950 p-2">
                <div className="h-12 rounded bg-emerald-400/70" />
                <div className="mt-3 h-2 w-4/5 rounded bg-gray-700" />
              </div>
              <div className="h-24 rounded-lg border border-gray-800 bg-gray-950 p-2">
                <div className="h-2 w-full rounded bg-gray-700" />
                <div className="mt-2 h-2 w-full rounded bg-gray-700" />
                <div className="mt-3 h-8 rounded border border-yellow-300/60" />
              </div>
            </div>
          </div>
        </div>
      </section>
    </main>
  );
}
