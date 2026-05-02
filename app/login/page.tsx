import { redirect } from 'next/navigation';
import { LoginForm } from './LoginForm';
import { createClient, hasSupabaseEnv } from '@/lib/supabase/server';
import { getCurrentAccount } from '@/lib/accounts';

export const dynamic = 'force-dynamic';

export default async function LoginPage() {
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
    <main className="min-h-screen bg-gray-950 px-6 py-10 text-white">
      <div className="mx-auto flex min-h-[calc(100vh-5rem)] w-full max-w-md items-center">
        <section className="w-full rounded-lg border border-gray-800 bg-gray-900/70 p-6 shadow-2xl shadow-black/30">
          <p className="mb-3 text-xs font-bold uppercase tracking-[0.24em] text-cyan-300">
            AI Video Generator
          </p>
          <h1 className="mb-3 text-3xl font-black tracking-normal text-white">
            Přihlášení
          </h1>
          <p className="mb-6 text-sm leading-6 text-gray-400">
            Zadej e-mail a pošleme ti magic link. Po ověření tě aplikace přesměruje do projektů.
          </p>
          <LoginForm />
        </section>
      </div>
    </main>
  );
}
