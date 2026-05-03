'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

export function VideoRetryButton({ videoId, status }: { videoId: string; status: string }) {
  const router = useRouter();
  const [isRetrying, setIsRetrying] = useState(false);

  if (status !== 'failed' && status !== 'queued') return null;

  async function retryRender() {
    setIsRetrying(true);
    try {
      const res = await fetch(`/api/videos/${videoId}/retry-render`, { method: 'POST' });
      const data = await res.json().catch(() => ({})) as { error?: string };
      if (!res.ok || data.error) throw new Error(data.error ?? `HTTP ${res.status}`);
      router.refresh();
    } catch (err) {
      alert(err instanceof Error ? err.message : String(err));
    } finally {
      setIsRetrying(false);
    }
  }

  return (
    <button
      type="button"
      onClick={retryRender}
      disabled={isRetrying}
      className="rounded-lg border border-amber-700 bg-amber-500/10 px-4 py-2 text-sm font-bold text-amber-200 transition hover:border-amber-400 hover:bg-amber-500/20 disabled:cursor-not-allowed disabled:opacity-60"
    >
      {isRetrying ? 'Spouštím...' : status === 'queued' ? 'Trigger worker' : 'Try rendering again'}
    </button>
  );
}
