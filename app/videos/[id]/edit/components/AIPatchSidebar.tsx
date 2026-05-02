'use client';

import { useState } from 'react';
import type { VideoEdit } from '@/types/editor';

const EXAMPLES = [
  'Udělej titulky větší a přesuň je výš',
  'Dej silnější zoom efekt na všechny scény',
  'Změň font na Impact',
  'Regeneruj obrázek pro scénu 2 s strašidelnějším motivem',
  'Přidej word-highlight animaci titulků',
  'Odstraň efekty ze všech scén',
  'Zvětši titulky o 50% a dej je na střed',
  'Make subtitles bigger and move them higher',
  'Add stronger zooms to all scenes',
];

interface Props {
  videoId: string;
  editHistory: VideoEdit[];
  onPatchApplied: (data: { editedSettings: unknown; editedSegments: unknown }) => void;
}

export function AIPatchSidebar({ videoId, editHistory: initialHistory, onPatchApplied }: Props) {
  const [prompt, setPrompt] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastResult, setLastResult] = useState<string[] | null>(null);
  const [history, setHistory] = useState<VideoEdit[]>(initialHistory);

  const apply = async () => {
    if (!prompt.trim() || isLoading) return;
    setIsLoading(true);
    setError(null);
    setLastResult(null);

    try {
      const res = await fetch(`/api/videos/${videoId}/patch`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt }),
      });
      const data = await res.json() as {
        error?: string;
        appliedFields?: string[];
        editedSettings?: unknown;
        editedSegments?: unknown;
      };

      if (!res.ok || data.error) {
        setError(data.error ?? 'Neznámá chyba');
        return;
      }

      setLastResult(data.appliedFields ?? []);
      setPrompt('');
      onPatchApplied({ editedSettings: data.editedSettings, editedSegments: data.editedSegments });

      // Refresh history (append optimistically)
      setHistory((prev) => [
        ...prev,
        {
          id: crypto.randomUUID(),
          video_id: videoId,
          user_id: '',
          version_number: prev.length + 1,
          patch: {},
          prompt,
          applied_fields: data.appliedFields ?? [],
          created_at: new Date().toISOString(),
        },
      ]);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Chyba sítě');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="flex flex-col gap-4">

      {/* ── Prompt input ─────────────────────────────────────────────── */}
      <div>
        <p className="text-[10px] font-black uppercase tracking-[0.25em] text-cyan-300 mb-2">
          AI Editor
        </p>
        <textarea
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) apply(); }}
          placeholder="Popiš co chceš změnit... (Ctrl+Enter pro odeslání)"
          className="w-full rounded-lg border border-gray-700 bg-gray-900/60 px-3 py-3 text-sm text-white placeholder-gray-600 focus:border-cyan-500 focus:outline-none resize-none transition"
          rows={4}
          disabled={isLoading}
        />
      </div>

      <button
        onClick={apply}
        disabled={!prompt.trim() || isLoading}
        className="w-full rounded-lg bg-cyan-500 px-4 py-3 text-sm font-black text-gray-950 transition hover:bg-cyan-400 active:scale-95 disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-2"
      >
        {isLoading ? (
          <>
            <span className="inline-block h-4 w-4 rounded-full border-2 border-gray-950/30 border-t-gray-950 animate-spin" />
            AI zpracovává…
          </>
        ) : (
          '✨ Aplikovat s AI'
        )}
      </button>

      {error && (
        <div className="rounded-lg border border-red-700 bg-red-950/30 px-3 py-2 text-xs text-red-300">
          {error}
        </div>
      )}

      {lastResult && (
        <div className="rounded-lg border border-emerald-700 bg-emerald-950/30 px-3 py-2 text-xs text-emerald-300">
          <p className="font-bold mb-1">Aplikováno:</p>
          <ul className="space-y-0.5">
            {lastResult.map((f) => <li key={f} className="font-mono">✓ {f}</li>)}
          </ul>
        </div>
      )}

      {/* ── Examples ─────────────────────────────────────────────────── */}
      <div>
        <p className="text-[10px] font-semibold uppercase tracking-widest text-gray-600 mb-2">
          Příklady
        </p>
        <div className="flex flex-col gap-1.5">
          {EXAMPLES.map((ex) => (
            <button
              key={ex}
              onClick={() => setPrompt(ex)}
              className="text-left rounded-lg border border-gray-800 px-2.5 py-2 text-[11px] text-gray-400 hover:border-cyan-700 hover:text-gray-200 transition leading-snug"
            >
              {ex}
            </button>
          ))}
        </div>
      </div>

      {/* ── Edit history ─────────────────────────────────────────────── */}
      {history.length > 0 && (
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-widest text-gray-600 mb-2">
            Historie editů ({history.length})
          </p>
          <div className="space-y-2 max-h-60 overflow-y-auto">
            {[...history].reverse().map((edit) => (
              <div key={edit.id} className="rounded-lg border border-gray-800 px-2.5 py-2">
                {edit.prompt && (
                  <p className="text-xs text-gray-300 line-clamp-2 mb-1 leading-snug">{edit.prompt}</p>
                )}
                <div className="flex flex-wrap gap-1">
                  {(edit.applied_fields ?? []).slice(0, 5).map((f) => (
                    <span key={f} className="rounded px-1 py-px text-[9px] font-mono bg-gray-800 text-gray-400">
                      {f}
                    </span>
                  ))}
                  {(edit.applied_fields ?? []).length > 5 && (
                    <span className="text-[9px] text-gray-600">+{edit.applied_fields.length - 5}</span>
                  )}
                </div>
                <p className="mt-1 text-[9px] text-gray-600">
                  {new Date(edit.created_at).toLocaleString('cs-CZ')}
                </p>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
