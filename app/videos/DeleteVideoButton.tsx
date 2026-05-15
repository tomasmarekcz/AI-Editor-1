'use client';

import { useState } from 'react';
import type { MouseEvent } from 'react';
import { useRouter } from 'next/navigation';

type Props = {
  videoId: string;
  redirectTo?: string;
  className?: string;
  label?: string;
};

export function DeleteVideoButton({
  videoId,
  redirectTo,
  className,
  label = 'Smazat',
}: Props) {
  const router = useRouter();
  const [isDeleting, setIsDeleting] = useState(false);

  async function deleteVideo(event: MouseEvent<HTMLButtonElement>) {
    event.preventDefault();
    event.stopPropagation();

    if (!confirm('Opravdu smazat video včetně všech uložených assetů?')) return;

    setIsDeleting(true);
    try {
      const res = await fetch(`/api/videos/${videoId}`, { method: 'DELETE' });
      const data = await res.json().catch(() => ({})) as { error?: string };
      if (!res.ok || data.error) throw new Error(data.error ?? `HTTP ${res.status}`);

      if (redirectTo) {
        router.push(redirectTo);
      } else {
        router.refresh();
      }
    } catch (err) {
      alert(err instanceof Error ? err.message : String(err));
    } finally {
      setIsDeleting(false);
    }
  }

  return (
    <button
      type="button"
      onClick={deleteVideo}
      disabled={isDeleting}
      className={className ?? 'rounded-lg border border-red-700 bg-red-500/10 px-4 py-2 text-sm font-bold text-red-200 transition hover:border-red-400 hover:bg-red-500/20 disabled:cursor-not-allowed disabled:opacity-60'}
    >
      {isDeleting ? 'Mažu...' : label}
    </button>
  );
}
