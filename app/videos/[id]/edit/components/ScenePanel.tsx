'use client';

import { useState, useCallback } from 'react';
import type { SegmentData, VideoEffect } from '@/types';
import type { VideoEditPatch } from '@/types/editor';

interface Props {
  segment: SegmentData & { _removed?: boolean };
  segmentIdx: number;
  totalSegments: number;
  videoId: string;
  projectId: string;
  imageUrl: string | undefined;
  previewImageUrl: string | undefined;
  orientation: string;
  onPatch: (patch: VideoEditPatch) => void;
  onMoveLeft: () => void;
  onMoveRight: () => void;
  onDuplicate: () => void;
  onImageRegenerated: (idx: number, localPath: string, prompt: string, mode: SegmentData['imageGenMode']) => void;
}

const EFFECTS: { value: VideoEffect; label: string; icon: string; color: string }[] = [
  { value: 'none',       label: 'Žádný',      icon: '○',  color: 'border-gray-700 text-gray-400' },
  { value: 'flash',      label: 'Flash',       icon: '⚡', color: 'border-yellow-600 text-yellow-300' },
  { value: 'zoom-burst', label: 'Zoom burst',  icon: '🔍', color: 'border-blue-600 text-blue-300' },
  { value: 'shake',      label: 'Shake',       icon: '💥', color: 'border-orange-600 text-orange-300' },
  { value: 'glitch',     label: 'Glitch',      icon: '📺', color: 'border-purple-600 text-purple-300' },
];

const KB_PRESETS: { value: 0 | 1 | 2 | 3 | 4; label: string; icon: string }[] = [
  { value: 0, label: 'Zoom in',    icon: '↗' },
  { value: 1, label: 'Zoom out',   icon: '↙' },
  { value: 2, label: 'Pan right',  icon: '→' },
  { value: 3, label: 'Pan left',   icon: '←' },
  { value: 4, label: 'Pan down',   icon: '↑' },
];

const TRANSITIONS: { value: 'fade' | 'cut' | 'dissolve'; label: string; icon: string }[] = [
  { value: 'fade',     label: 'Fade',    icon: '▒' },
  { value: 'cut',      label: 'Cut',     icon: '✂' },
  { value: 'dissolve', label: 'Dissolve', icon: '◌' },
];

export function ScenePanel({
  segment,
  segmentIdx,
  totalSegments,
  videoId,
  projectId,
  imageUrl,
  previewImageUrl,
  orientation,
  onPatch,
  onMoveLeft,
  onMoveRight,
  onDuplicate,
  onImageRegenerated,
}: Props) {
  const [imagePrompt, setImagePrompt] = useState(segment.imagePrompt ?? '');
  const [isRegenerating, setIsRegenerating] = useState(false);
  const [regenError, setRegenError] = useState<string | null>(null);

  const displayDuration = segment.endTime != null && segment.startTime != null
    ? (segment.endTime - segment.startTime).toFixed(2)
    : (segment.audioDuration ?? segment.duration ?? 3).toFixed(2);

  const currentEffect = segment.effect ?? 'none';
  const currentKb = segment.kbPreset;
  const currentTransition = segment.transition ?? 'fade';

  const regenerateImage = useCallback(async () => {
    if (!imagePrompt.trim()) return;
    setIsRegenerating(true);
    setRegenError(null);

    try {
      const res = await fetch('/api/images/regenerate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          segmentId: segment.id,
          videoId,
          projectId,
          prompt: imagePrompt.trim(),
          mode: segment.imageGenMode ?? 'google',
          orientation: orientation ?? 'vertical',
        }),
      });
      const data = await res.json() as { localImagePath?: string; usedMode?: SegmentData['imageGenMode']; error?: string };
      if (!res.ok || data.error) {
        setRegenError(data.error ?? 'Regenerace selhala');
        return;
      }
      if (data.localImagePath) {
        onImageRegenerated(segmentIdx, data.localImagePath, imagePrompt.trim(), data.usedMode ?? segment.imageGenMode ?? 'google');
      }
    } catch (err) {
      setRegenError(err instanceof Error ? err.message : 'Chyba sítě');
    } finally {
      setIsRegenerating(false);
    }
  }, [imagePrompt, segment, videoId, projectId, orientation, segmentIdx, onImageRegenerated]);

  const thumbUrl = previewImageUrl ?? imageUrl;
  const aspectClass = orientation === 'horizontal' ? 'aspect-video' : 'aspect-[9/16]';

  return (
    <div className="space-y-4">
      {/* Scene header */}
      <div className="flex items-center gap-2">
        <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-cyan-500/20 text-xs font-black text-cyan-300">
          {segmentIdx + 1}
        </span>
        <span className="text-sm font-bold text-white">Scéna {segmentIdx + 1}</span>
        {segment._removed && (
          <span className="rounded px-1.5 py-0.5 text-[9px] font-bold uppercase bg-red-500/20 text-red-300">
            Smazáno
          </span>
        )}
      </div>

      {/* Thumbnail */}
      <div className={`relative ${aspectClass} w-full max-w-[200px] mx-auto rounded-xl overflow-hidden bg-gray-900 border border-gray-800`}>
        {thumbUrl ? (
          <img src={thumbUrl} alt="" className="w-full h-full object-cover" />
        ) : (
          <div className="absolute inset-0 bg-gradient-to-br from-gray-800 to-gray-900 flex items-center justify-center">
            <span className="text-gray-600 text-xs">Bez obrázku</span>
          </div>
        )}
        {isRegenerating && (
          <div className="absolute inset-0 bg-gray-950/70 flex items-center justify-center">
            <div className="h-6 w-6 rounded-full border-2 border-cyan-400 border-t-transparent animate-spin" />
          </div>
        )}
      </div>

      {/* Duration (read-only) */}
      <div className="flex items-center justify-between rounded-lg border border-gray-800 bg-gray-900/50 px-3 py-2">
        <span className="text-[11px] font-semibold uppercase tracking-widest text-gray-500">Délka</span>
        <span className="text-sm font-bold text-white">{displayDuration}s</span>
      </div>

      {/* Scene text */}
      <div>
        <p className="text-[10px] font-semibold uppercase tracking-widest text-gray-600 mb-1">Text scény</p>
        <p className="text-xs text-gray-300 leading-relaxed line-clamp-4 rounded-lg border border-gray-800 bg-gray-900/50 px-3 py-2">
          {segment.text}
        </p>
      </div>

      {/* Effect */}
      <div>
        <p className="text-[10px] font-semibold uppercase tracking-widest text-gray-600 mb-2">Efekt</p>
        <div className="grid grid-cols-3 gap-1.5">
          {EFFECTS.map((ef) => (
            <button
              key={ef.value}
              onClick={() => onPatch({ scenes: { [segmentIdx]: { effect: ef.value } } })}
              className={[
                'rounded-lg border px-2 py-2 text-center transition',
                currentEffect === ef.value
                  ? `${ef.color} bg-white/5 font-bold`
                  : 'border-gray-800 text-gray-500 hover:border-gray-600 hover:text-gray-300',
              ].join(' ')}
            >
              <div className="text-base leading-none mb-0.5">{ef.icon}</div>
              <div className="text-[9px] leading-none">{ef.label}</div>
            </button>
          ))}
        </div>
      </div>

      {/* Ken Burns preset */}
      <div>
        <p className="text-[10px] font-semibold uppercase tracking-widest text-gray-600 mb-2">Pohyb kamery</p>
        <div className="grid grid-cols-5 gap-1">
          {KB_PRESETS.map((kb) => (
            <button
              key={kb.value}
              onClick={() => onPatch({ scenes: { [segmentIdx]: { kbPreset: kb.value } } })}
              title={kb.label}
              className={[
                'rounded-lg border py-2 text-center text-base transition',
                currentKb === kb.value
                  ? 'border-cyan-500 bg-cyan-500/10 text-cyan-300'
                  : 'border-gray-800 text-gray-400 hover:border-gray-600 hover:text-white',
              ].join(' ')}
            >
              {kb.icon}
            </button>
          ))}
        </div>
        <p className="mt-1 text-[9px] text-gray-600">
          Efekt okamžitě viditelný v náhledu
        </p>
      </div>

      {/* Transition */}
      <div>
        <p className="text-[10px] font-semibold uppercase tracking-widest text-gray-600 mb-2">Přechod</p>
        <div className="grid grid-cols-3 gap-1.5">
          {TRANSITIONS.map((tr) => (
            <button
              key={tr.value}
              onClick={() => onPatch({ scenes: { [segmentIdx]: { transition: tr.value } } })}
              className={[
                'rounded-lg border py-2 text-center transition',
                currentTransition === tr.value
                  ? 'border-cyan-500 bg-cyan-500/10 text-cyan-300'
                  : 'border-gray-800 text-gray-500 hover:border-gray-600 hover:text-gray-300',
              ].join(' ')}
            >
              <div className="text-base leading-none mb-0.5">{tr.icon}</div>
              <div className="text-[9px] leading-none">{tr.label}</div>
            </button>
          ))}
        </div>
      </div>

      {/* Image regeneration */}
      <div>
        <p className="text-[10px] font-semibold uppercase tracking-widest text-gray-600 mb-2">Obrázek scény</p>
        <textarea
          value={imagePrompt}
          onChange={(e) => setImagePrompt(e.target.value)}
          placeholder="Popis obrázku pro tuto scénu..."
          className="w-full rounded-lg border border-gray-700 bg-gray-900/60 px-3 py-2 text-xs text-white placeholder-gray-600 focus:border-cyan-500 focus:outline-none resize-none"
          rows={2}
        />
        <button
          onClick={regenerateImage}
          disabled={isRegenerating || !imagePrompt.trim()}
          className="mt-1.5 w-full rounded-lg border border-amber-600 px-3 py-2 text-xs font-bold text-amber-300 transition hover:bg-amber-600/10 active:scale-95 disabled:opacity-40 flex items-center justify-center gap-2"
        >
          {isRegenerating ? (
            <>
              <span className="h-3 w-3 rounded-full border border-amber-300 border-t-transparent animate-spin" />
              Generuji…
            </>
          ) : (
            '🎨 Regenerovat obrázek'
          )}
        </button>
        {regenError && (
          <p className="mt-1 text-[10px] text-red-400">{regenError}</p>
        )}
      </div>

      {/* Scene actions */}
      <div>
        <p className="text-[10px] font-semibold uppercase tracking-widest text-gray-600 mb-2">Akce</p>
        <div className="grid grid-cols-2 gap-1.5">
          <button
            onClick={onMoveLeft}
            disabled={segmentIdx === 0}
            className="rounded-lg border border-gray-700 py-2 text-xs font-bold text-gray-300 hover:border-gray-500 hover:text-white transition disabled:opacity-30"
          >
            ← Posunout
          </button>
          <button
            onClick={onMoveRight}
            disabled={segmentIdx >= totalSegments - 1}
            className="rounded-lg border border-gray-700 py-2 text-xs font-bold text-gray-300 hover:border-gray-500 hover:text-white transition disabled:opacity-30"
          >
            Posunout →
          </button>
          <button
            onClick={onDuplicate}
            className="rounded-lg border border-gray-700 py-2 text-xs font-bold text-gray-300 hover:border-cyan-600 hover:text-cyan-200 transition"
          >
            ⧉ Duplikovat
          </button>
          <button
            onClick={() => onPatch({ scenes: { [segmentIdx]: { remove: !segment._removed } } })}
            className={[
              'rounded-lg border py-2 text-xs font-bold transition',
              segment._removed
                ? 'border-green-700 text-green-300 hover:bg-green-700/10'
                : 'border-red-800 text-red-400 hover:bg-red-800/10',
            ].join(' ')}
          >
            {segment._removed ? '↩ Obnovit' : '✕ Smazat'}
          </button>
        </div>
        {segment._removed && (
          <p className="mt-1.5 text-[9px] text-amber-500/80 leading-snug">
            Audio pro smazanou scénu bude stále přehrávat. Re-generování audia ji odstraní úplně.
          </p>
        )}
      </div>
    </div>
  );
}
