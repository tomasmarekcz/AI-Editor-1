'use client';

import { useState, useCallback, useMemo, useRef } from 'react';
import Link from 'next/link';
import dynamic from 'next/dynamic';
import type { VideoSettings, SegmentData, VideoInputProps } from '@/types';
import type { VideoEditPatch, EditorVideoData, EditorSaveStatus } from '@/types/editor';
import { validatePatch, applyPatchToSettings, applyPatchToSegments } from '@/lib/patchSchema';
import { Timeline } from './components/Timeline';
import { ScenePanel } from './components/ScenePanel';
import { StylePanel } from './components/StylePanel';
import { AIPatchSidebar } from './components/AIPatchSidebar';

const RemotionPreview = dynamic(
  () => import('./components/RemotionPreview').then((m) => m.RemotionPreview),
  { ssr: false, loading: () => <PreviewShell /> },
);

function PreviewShell({ children }: { children?: React.ReactNode }) {
  return (
    <div className="w-full h-full bg-gray-950 rounded-xl flex items-center justify-center min-h-[200px]">
      {children ?? <p className="text-xs text-gray-600 animate-pulse">Načítám náhled…</p>}
    </div>
  );
}

async function readApiError(res: Response) {
  try {
    const data = await res.json() as { error?: string };
    return data.error ?? `HTTP ${res.status}`;
  } catch {
    return `HTTP ${res.status}`;
  }
}

type Tab = 'scene' | 'style' | 'ai';

interface Props {
  video: EditorVideoData;
}

export function VideoEditor({ video }: Props) {
  const initialSettings = useMemo(
    () => (video.edited_settings ?? video.settings) as Partial<VideoSettings>,
    [video],
  );
  const initialSegments = useMemo(
    () => (video.edited_segments ?? video.segments) as SegmentData[],
    [video],
  );

  // ── Core editor state ─────────────────────────────────────────────────
  const [editedSettings, setEditedSettings] = useState<Partial<VideoSettings>>(initialSettings);
  const [editedSegments, setEditedSegments] = useState<SegmentData[]>(initialSegments);
  const [selectedIdx, setSelectedIdx] = useState<number | null>(null);
  const [activeTab, setActiveTab] = useState<Tab>('scene');
  const [zoomPxPerSec, setZoomPxPerSec] = useState(72);

  // Local image URL overrides (from regenerate or image replace)
  const [localImageUrls, setLocalImageUrls] = useState<Record<number, string>>({});

  // ── Save state ────────────────────────────────────────────────────────
  const [saveStatus, setSaveStatus] = useState<EditorSaveStatus>('saved');
  const saveTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  const saveEdits = useCallback(async (settings: Partial<VideoSettings>, segments: SegmentData[]) => {
    const res = await fetch(`/api/videos/${video.id}/save-edit`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ editedSettings: settings, editedSegments: segments }),
    });
    if (!res.ok) throw new Error(await readApiError(res));
  }, [video.id]);

  const scheduleAutoSave = useCallback((settings: Partial<VideoSettings>, segments: SegmentData[]) => {
    setSaveStatus('unsaved');
    if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
    saveTimeoutRef.current = setTimeout(async () => {
      setSaveStatus('saving');
      try {
        await saveEdits(settings, segments);
        setSaveStatus('saved');
      } catch {
        setSaveStatus('error');
      }
    }, 1500);
  }, [saveEdits]);

  // ── Re-render state ───────────────────────────────────────────────────
  const [isRerendering, setIsRerendering] = useState(false);
  const [rerenderProgress, setRerenderProgress] = useState(0);
  const [rerenderStep, setRerenderStep] = useState('');
  const [renderedVideoUrl, setRenderedVideoUrl] = useState<string | null>(video.editedVideoUrl);
  const [rerenderError, setRerenderError] = useState<string | null>(null);
  const [showResult, setShowResult] = useState(!!video.editedVideoUrl);

  // ── Patch application ─────────────────────────────────────────────────
  const applyPatch = useCallback((rawPatch: VideoEditPatch) => {
    const patch = validatePatch(rawPatch as unknown);
    setEditedSettings((prev) => {
      const next = applyPatchToSettings(prev, patch);
      setEditedSegments((prevSegs) => {
        const nextSegs = applyPatchToSegments(prevSegs, patch);
        scheduleAutoSave(next, nextSegs);
        return nextSegs;
      });
      return next;
    });
  }, [scheduleAutoSave]);

  const onAIPatchApplied = useCallback((data: { editedSettings: unknown; editedSegments: unknown }) => {
    setEditedSettings(data.editedSettings as Partial<VideoSettings>);
    setEditedSegments(data.editedSegments as SegmentData[]);
    setSaveStatus('saved');
  }, []);

  // ── Scene operations ──────────────────────────────────────────────────
  const moveScene = useCallback((idx: number, dir: -1 | 1) => {
    const target = idx + dir;
    setEditedSegments((prev) => {
      if (target < 0 || target >= prev.length) return prev;
      const next = [...prev];
      [next[idx], next[target]] = [next[target], next[idx]];
      scheduleAutoSave(editedSettings, next);
      return next;
    });
    setSelectedIdx(target);
  }, [editedSettings, scheduleAutoSave]);

  const duplicateScene = useCallback((idx: number) => {
    setEditedSegments((prev) => {
      const clone: SegmentData = {
        ...prev[idx],
        id: `${prev[idx].id}_dup_${Date.now()}`,
      };
      const next = [...prev.slice(0, idx + 1), clone, ...prev.slice(idx + 1)];
      scheduleAutoSave(editedSettings, next);
      return next;
    });
    setSelectedIdx(idx + 1);
  }, [editedSettings, scheduleAutoSave]);

  const onImageRegenerated = useCallback((idx: number, localPath: string, prompt: string, mode: SegmentData['imageGenMode']) => {
    setLocalImageUrls((prev) => ({ ...prev, [idx]: localPath }));
    setEditedSegments((prev) => {
      if (idx < 0 || idx >= prev.length) return prev;
      const next = [...prev];
      next[idx] = {
        ...next[idx],
        localImagePath: localPath,
        imageUrl: localPath,
        imagePrompt: prompt,
        imageGenMode: mode,
      };
      delete (next[idx] as SegmentData & { _regenerateImage?: boolean })._regenerateImage;
      scheduleAutoSave(editedSettings, next);
      return next;
    });
  }, [editedSettings, scheduleAutoSave]);

  // ── Remotion preview props ─────────────────────────────────────────────
  const previewImageUrls = useMemo(() => ({
    ...video.imageUrlsByIndex,
    ...localImageUrls,
  }), [video.imageUrlsByIndex, localImageUrls]);

  const previewProps = useMemo<VideoInputProps>(() => {
    const segs = editedSegments
      .filter((s) => !(s as SegmentData & { _removed?: boolean })._removed)
      .map((seg, i) => {
        const origIdx = (video.edited_segments ?? video.segments as SegmentData[])
          .findIndex((s: SegmentData) => s.id === seg.id);
        const effIdx = origIdx >= 0 ? origIdx : i;
        return { ...seg, imageUrl: previewImageUrls[effIdx] ?? seg.imageUrl, localImagePath: undefined };
      });

    return {
      segments: segs,
      fps: 30,
      orientation: (editedSettings.orientation ?? 'vertical') as VideoInputProps['orientation'],
      subtitle: (editedSettings.subtitle ?? initialSettings.subtitle) as VideoInputProps['subtitle'],
      audioUrl: video.audioUrl ?? undefined,
    };
  }, [editedSettings, editedSegments, previewImageUrls, video, initialSettings]);

  // ── Re-render ─────────────────────────────────────────────────────────
  const startRerender = useCallback(async () => {
    setIsRerendering(true);
    setRerenderProgress(0);
    setRerenderStep('');
    setRerenderError(null);
    setShowResult(false);

    try {
      if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
      setSaveStatus('saving');
      await saveEdits(editedSettings, editedSegments);
      setSaveStatus('saved');

      const res = await fetch(`/api/videos/${video.id}/rerender`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      if (!res.ok) throw new Error(await readApiError(res));
      if (!res.body) throw new Error('No response stream');

      const reader = res.body.getReader();
      const decoder = new TextDecoder();

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        for (const line of decoder.decode(value).split('\n')) {
          if (!line.startsWith('data: ')) continue;
          const ev = JSON.parse(line.slice(6)) as {
            type: string; message?: string; progress?: number; videoUrl?: string; error?: string;
          };
          if (ev.type === 'step')     setRerenderStep(ev.message ?? '');
          if (ev.type === 'progress') setRerenderProgress(ev.progress ?? 0);
          if (ev.type === 'done')     { setRenderedVideoUrl(ev.videoUrl ?? null); setShowResult(true); setRerenderProgress(100); }
          if (ev.type === 'error')    setRerenderError(ev.error ?? 'Neznámá chyba');
        }
      }
    } catch (err) {
      setRerenderError(err instanceof Error ? err.message : 'Chyba při re-renderu');
    } finally {
      setIsRerendering(false);
    }
  }, [editedSettings, editedSegments, saveEdits, video.id]);

  // ── Derived ───────────────────────────────────────────────────────────
  const isVertical = (editedSettings.orientation ?? 'vertical') === 'vertical';
  const selectedSeg = selectedIdx != null ? editedSegments[selectedIdx] : null;

  const SAVE_LABEL: Record<EditorSaveStatus, string> = {
    unsaved: '● Neuloženo', saving: '⟳ Ukládám…', saved: '✓ Uloženo', error: '✗ Chyba',
  };
  const SAVE_COLOR: Record<EditorSaveStatus, string> = {
    unsaved: 'text-amber-400', saving: 'text-gray-500', saved: 'text-emerald-400', error: 'text-red-400',
  };

  const TABS: { id: Tab; label: string }[] = [
    { id: 'scene', label: selectedIdx != null ? `Scéna ${selectedIdx + 1}` : 'Scéna' },
    { id: 'style', label: 'Styl' },
    { id: 'ai',    label: '✨ AI' },
  ];

  return (
    <div className="h-screen overflow-hidden flex flex-col bg-[#0e0f11] text-white">

      {/* ── Header ────────────────────────────────────────────────────── */}
      <header className="flex-none flex items-center gap-3 px-4 py-2.5 border-b border-white/5 bg-[#0e0f11]/90 backdrop-blur z-20">
        <Link
          href={`/videos/${video.id}`}
          className="flex items-center gap-1.5 rounded-lg border border-white/10 px-3 py-1.5 text-[11px] font-bold text-gray-400 hover:border-white/20 hover:text-white transition"
        >
          ← Zpět
        </Link>

        <div className="flex-1 min-w-0">
          <h1 className="text-sm font-bold text-white truncate">{video.title}</h1>
        </div>

        <span className={`text-[11px] font-semibold ${SAVE_COLOR[saveStatus]}`}>
          {SAVE_LABEL[saveStatus]}
        </span>

        <button
          onClick={startRerender}
          disabled={isRerendering}
          className={[
            'flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-black transition active:scale-95 disabled:opacity-50',
            isRerendering
              ? 'bg-gray-800 text-gray-300'
              : 'bg-cyan-500 text-gray-950 hover:bg-cyan-400',
          ].join(' ')}
        >
          {isRerendering ? (
            <>
              <span className="h-4 w-4 rounded-full border-2 border-current/30 border-t-current animate-spin" />
              {rerenderProgress}%
            </>
          ) : (
            <> ▶ Re-render</>
          )}
        </button>
      </header>

      {/* ── Re-render progress bar ────────────────────────────────────── */}
      {isRerendering && (
        <div className="flex-none px-4 py-2 bg-gray-900/80 border-b border-white/5 flex items-center gap-3">
          <p className="text-[11px] text-gray-400 flex-none">{rerenderStep || 'Připravuji…'}</p>
          <div className="flex-1 h-1 bg-gray-800 rounded-full overflow-hidden">
            <div
              className="h-full bg-cyan-400 rounded-full transition-all duration-500"
              style={{ width: `${rerenderProgress}%` }}
            />
          </div>
          <span className="text-[11px] font-bold text-cyan-400 flex-none tabular-nums">{rerenderProgress}%</span>
        </div>
      )}

      {rerenderError && (
        <div className="flex-none px-4 py-2 bg-red-950/40 border-b border-red-800/40 text-[11px] text-red-300">
          ✕ {rerenderError}
        </div>
      )}

      {/* ── Main area: Preview + Right panel ──────────────────────────── */}
      <div className="flex-1 flex overflow-hidden min-h-0">

        {/* Preview column */}
        <div className="flex-1 flex flex-col overflow-hidden p-3 gap-3 min-w-0">

          {/* Rendered result banner */}
          {showResult && renderedVideoUrl && (
            <div className="flex-none flex items-center gap-3 rounded-xl border border-emerald-700/40 bg-emerald-950/30 px-4 py-2.5">
              <span className="text-emerald-400 text-sm">✓ Re-render hotový</span>
              <div className="flex gap-2 ml-auto">
                <a
                  href={renderedVideoUrl}
                  download="edited-video.mp4"
                  className="rounded-lg border border-emerald-600 px-3 py-1.5 text-xs font-bold text-emerald-300 hover:bg-emerald-600/10 transition"
                >
                  Stáhnout MP4
                </a>
                <button
                  onClick={() => setShowResult(false)}
                  className="rounded-lg px-3 py-1.5 text-xs text-gray-500 hover:text-gray-300 transition"
                >
                  Zavřít
                </button>
              </div>
            </div>
          )}

          {/* Video player area */}
          <div className="flex-1 flex items-center justify-center overflow-hidden min-h-0">
            {showResult && renderedVideoUrl ? (
              <video
                src={renderedVideoUrl}
                controls autoPlay loop
                className={[
                  'rounded-xl object-contain shadow-2xl',
                  isVertical ? 'h-full max-h-full' : 'w-full max-w-full',
                ].join(' ')}
              />
            ) : (
              <div
                className={[
                  'relative rounded-xl overflow-hidden shadow-2xl bg-black',
                  isVertical
                    ? 'h-full max-h-full aspect-[9/16]'
                    : 'w-full max-w-full aspect-video',
                ].join(' ')}
              >
                <RemotionPreview inputProps={previewProps} />
              </div>
            )}
          </div>

          {/* Info bar */}
          <div className="flex-none flex items-center gap-4 text-[10px] text-gray-600">
            <span>{editedSegments.filter((s) => !(s as SegmentData & { _removed?: boolean })._removed).length} scén</span>
            <span>
              {(editedSegments.reduce((sum, s) => {
                const dur = s.endTime != null && s.startTime != null
                  ? s.endTime - s.startTime
                  : s.audioDuration ?? s.duration ?? 3;
                return sum + dur;
              }, 0)).toFixed(1)}s celkem
            </span>
            <span>{isVertical ? '9:16 vertikální' : '16:9 horizontální'}</span>
            {selectedIdx != null && (
              <span className="text-cyan-500">● Scéna {selectedIdx + 1} vybrána</span>
            )}
            <span className="ml-auto text-gray-700">
              Náhled odráží změny. Re-render pro přesný výsledek.
            </span>
          </div>
        </div>

        {/* ── Right panel ────────────────────────────────────────────── */}
        <div className="flex-none w-[300px] xl:w-[340px] flex flex-col border-l border-white/5 overflow-hidden">

          {/* Tabs */}
          <div className="flex-none flex border-b border-white/5">
            {TABS.map((tab) => (
              <button
                key={tab.id}
                onClick={() => {
                  setActiveTab(tab.id);
                  if (tab.id === 'scene' && selectedIdx == null && editedSegments.length > 0) {
                    setSelectedIdx(0);
                  }
                }}
                className={[
                  'flex-1 py-2.5 text-[11px] font-bold transition border-b-2',
                  activeTab === tab.id
                    ? 'border-cyan-400 text-cyan-300'
                    : 'border-transparent text-gray-500 hover:text-gray-300',
                ].join(' ')}
              >
                {tab.label}
              </button>
            ))}
          </div>

          {/* Tab content */}
          <div className="flex-1 overflow-y-auto overscroll-contain p-4">
            {activeTab === 'scene' && (
              selectedSeg != null && selectedIdx != null ? (
                <ScenePanel
                  segment={selectedSeg as SegmentData & { _removed?: boolean }}
                  segmentIdx={selectedIdx}
                  totalSegments={editedSegments.length}
                  videoId={video.id}
                  projectId={video.project_id}
                  imageUrl={video.imageUrlsByIndex[selectedIdx]}
                  previewImageUrl={localImageUrls[selectedIdx]}
                  orientation={editedSettings.orientation ?? 'vertical'}
                  onPatch={applyPatch}
                  onMoveLeft={() => moveScene(selectedIdx, -1)}
                  onMoveRight={() => moveScene(selectedIdx, 1)}
                  onDuplicate={() => duplicateScene(selectedIdx)}
                  onImageRegenerated={onImageRegenerated}
                />
              ) : (
                <div className="flex flex-col items-center justify-center h-full gap-3 text-center py-12">
                  <div className="w-12 h-12 rounded-2xl bg-gray-900 border border-gray-800 flex items-center justify-center text-2xl">
                    🎬
                  </div>
                  <p className="text-sm font-semibold text-gray-400">Vyberte scénu</p>
                  <p className="text-[11px] text-gray-600 max-w-[180px]">
                    Klikni na scénu v timeline níže pro její editaci
                  </p>
                  {editedSegments.length > 0 && (
                    <button
                      onClick={() => setSelectedIdx(0)}
                      className="mt-2 rounded-lg border border-gray-700 px-3 py-1.5 text-xs font-bold text-gray-400 hover:border-cyan-600 hover:text-cyan-300 transition"
                    >
                      Vybrat scénu 1
                    </button>
                  )}
                </div>
              )
            )}
            {activeTab === 'style' && (
              <StylePanel settings={editedSettings} onPatch={applyPatch} />
            )}
            {activeTab === 'ai' && (
              <AIPatchSidebar
                videoId={video.id}
                editHistory={video.editHistory}
                onPatchApplied={onAIPatchApplied}
              />
            )}
          </div>
        </div>
      </div>

      {/* ── Timeline ──────────────────────────────────────────────────── */}
      <div className="flex-none h-[148px] border-t border-white/5 bg-[#0a0b0d]">
        <Timeline
          segments={editedSegments}
          imageUrlsByIndex={video.imageUrlsByIndex}
          previewImageUrls={localImageUrls}
          selectedIdx={selectedIdx}
          onSelect={(idx) => {
            setSelectedIdx(idx);
            if (activeTab !== 'ai') setActiveTab('scene');
          }}
          zoomPxPerSec={zoomPxPerSec}
          onZoomChange={setZoomPxPerSec}
        />
      </div>
    </div>
  );
}
