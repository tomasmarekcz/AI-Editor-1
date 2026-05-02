'use client';

import { useState } from 'react';
import { createClient, hasSupabaseEnv } from '@/lib/supabase/client';

export function LoginForm({ compact = false }: { compact?: boolean }) {
  const [email, setEmail] = useState('');
  const [status, setStatus] = useState<'idle' | 'loading' | 'sent' | 'error'>('idle');
  const [message, setMessage] = useState('');

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setStatus('loading');
    setMessage('');

    if (!hasSupabaseEnv()) {
      setStatus('error');
      setMessage('Doplň NEXT_PUBLIC_SUPABASE_URL a NEXT_PUBLIC_SUPABASE_ANON_KEY v .env.local.');
      return;
    }

    const supabase = createClient();
    const origin = window.location.origin;
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: {
        emailRedirectTo: `${origin}/auth/callback?next=/projects`,
      },
    });

    if (error) {
      setStatus('error');
      setMessage(error.message);
      return;
    }

    setStatus('sent');
    setMessage('Magic link je na cestě. Otevři e-mail a přihlášení se dokončí automaticky.');
  }

  return (
    <form onSubmit={handleSubmit} className={compact ? 'space-y-3' : 'space-y-4'}>
      <label className="block">
        <span className="mb-2 block text-xs font-bold uppercase tracking-[0.22em] text-gray-500">
          Email
        </span>
        <input
          type="email"
          required
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          placeholder="you@example.com"
          className="w-full rounded-lg border border-gray-700 bg-gray-950/80 px-4 py-3 text-white outline-none transition focus:border-cyan-400 focus:ring-2 focus:ring-cyan-400/20"
        />
      </label>

      <button
        type="submit"
        disabled={status === 'loading'}
        className="w-full rounded-lg bg-cyan-400 px-5 py-3 text-sm font-black uppercase tracking-[0.18em] text-gray-950 transition hover:bg-cyan-300 disabled:cursor-not-allowed disabled:opacity-60"
      >
        {status === 'loading' ? 'Odesílám...' : 'Send magic link'}
      </button>

      {message && (
        <p className={status === 'error' ? 'text-sm text-red-300' : 'text-sm text-emerald-300'}>
          {message}
        </p>
      )}
    </form>
  );
}
