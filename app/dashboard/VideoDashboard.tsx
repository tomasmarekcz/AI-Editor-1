'use client';

import { useState, useCallback, useEffect, useRef } from 'react';
import Link from 'next/link';
import { SubtitlePreview } from '../components/SubtitlePreview';
import { VOICE_PRESETS } from '@/lib/voicePresets';
import { GEMINI_TTS_PRESETS, GEMINI_TTS_VOICES, GEMINI_TTS_PRESET_ORDER } from '@/lib/geminiTtsPresets';
import { createClient } from '@/lib/supabase/client';
import { DEFAULT_SUBTITLE_SETTINGS, DEFAULT_VIDEO_SETTINGS, mergeVideoSettings } from '@/lib/projects/defaults';
import { estimateVideoCost, formatUsd, type CostEstimate, type CostLine } from '@/lib/pricing';
import type {
  TTSVoice, TTSProvider, VideoSettings, SegmentData, SubtitleFont, SubtitleSettings,
  VoicePreset, GeminiTTSPreset, GeminiTTSVoice, VideoEffect, ImageGenMode,
} from '@/types';

const EFFECT_META: Record<VideoEffect, { icon: string; label: string }> = {
  none:         { icon: '○',  label: 'Bez efektu' },
  flash:        { icon: '⚡', label: 'Flash' },
  'zoom-burst': { icon: '🔍', label: 'Zoom' },
  shake:        { icon: '💥', label: 'Shake' },
  glitch:       { icon: '📺', label: 'Glitch' },
};

const MODE_META: Record<ImageGenMode, { icon: string; label: string; color: string }> = {
  google: { icon: '🔍', label: 'Google',  color: 'bg-blue-700/70' },
  imagen: { icon: '🎨', label: 'AI Gen',  color: 'bg-purple-700/70' },
};

// ── Static config ──────────────────────────────────────────────────────────
const OPENAI_VOICES: { id: TTSVoice; label: string; desc: string }[] = [
  { id: 'onyx',  label: 'Onyx',  desc: 'Hluboký, dramatický' },
  { id: 'echo',  label: 'Echo',  desc: 'Vyvážený, univerzální' },
  { id: 'fable', label: 'Fable', desc: 'Vyprávěcí, dynamický' },
];

const PRESET_ORDER: VoicePreset[] = ['hype', 'storyteller', 'mystery', 'business', 'documentary', 'custom'];

const FEATURED_FONTS: { id: SubtitleFont; label: string; css: string }[] = [
  { id: 'Bebas Neue',  label: 'Bebas',    css: '"Bebas Neue", Impact, sans-serif' },
  { id: 'Impact',      label: 'Impact',   css: 'Impact, sans-serif' },
  { id: 'TheBoldFont', label: 'Bold',     css: '"TheBoldFont", Impact, sans-serif' },
  { id: 'Montserrat',  label: 'Montserrat', css: '"Montserrat", sans-serif' },
  { id: 'Anton',       label: 'Anton',    css: '"Anton", Impact, sans-serif' },
];

const ALL_FONTS: { id: SubtitleFont; label: string; css: string }[] = [
  { id: 'Bebas Neue',       label: 'Bebas Neue',      css: '"Bebas Neue", Impact, sans-serif' },
  { id: 'Impact',           label: 'Impact',          css: 'Impact, sans-serif' },
  { id: 'TheBoldFont',      label: 'TheBoldFont',     css: '"TheBoldFont", Impact, sans-serif' },
  { id: 'Anton',            label: 'Anton',           css: '"Anton", Impact, sans-serif' },
  { id: 'Montserrat',       label: 'Montserrat',      css: '"Montserrat", sans-serif' },
  { id: 'Oswald',           label: 'Oswald',          css: '"Oswald", sans-serif' },
  { id: 'Roboto Condensed', label: 'Roboto Cond.',    css: '"Roboto Condensed", sans-serif' },
  { id: 'Archivo Black',    label: 'Archivo Black',   css: '"Archivo Black", sans-serif' },
  { id: 'League Spartan',   label: 'League Spartan',  css: '"League Spartan", sans-serif' },
  { id: 'Poppins',          label: 'Poppins',         css: '"Poppins", sans-serif' },
  { id: 'Inter',            label: 'Inter',           css: '"Inter", sans-serif' },
  { id: 'Raleway',          label: 'Raleway',         css: '"Raleway", sans-serif' },
  { id: 'Arial Black',      label: 'Arial Black',     css: '"Arial Black", sans-serif' },
  { id: 'Georgia',          label: 'Georgia',         css: 'Georgia, serif' },
  { id: 'Verdana',          label: 'Verdana',         css: 'Verdana, sans-serif' },
  { id: 'Courier New',      label: 'Courier New',     css: '"Courier New", monospace' },
];

const HIGHLIGHT_COLORS = [
  '#FFE400', '#FF4444', '#44FF88', '#44AAFF', '#FF8800', '#FF44FF',
  '#00FFFF', '#FF6B35', '#A855F7', '#10B981',
];
const TEXT_COLORS = [
  '#ffffff', '#FFE400', '#000000', '#cccccc',
  '#FF4444', '#44AAFF', '#44FF88', '#FF8800',
];

const IMAGE_SOURCES = [
  { id: 'google' as const,  icon: '🔍', label: 'Google',    desc: 'Automatické vyhledávání' },
  { id: 'imagen' as const,  icon: '🎨', label: 'AI Obr.',   desc: 'GPT Image 2 low generování' },
  { id: 'hybrid' as const,  icon: '⚡', label: 'Hybrid',    desc: 'Gemini rozhodne' },
  { id: 'upload' as const,  icon: '📂', label: 'Vlastní',   desc: 'Nahrát ručně' },
];

async function readApiError(res: Response) {
  try {
    const data = await res.json() as { error?: string };
    return data.error ?? `HTTP ${res.status}`;
  } catch {
    return `HTTP ${res.status}`;
  }
}

const DEFAULT_SUBTITLE: SubtitleSettings = DEFAULT_SUBTITLE_SETTINGS;
const DEFAULT_SETTINGS: VideoSettings = DEFAULT_VIDEO_SETTINGS;

// ── Types ──────────────────────────────────────────────────────────────────
type AppStep = 'idle' | 'segmenting' | 'generating-images' | 'awaiting-review' | 'awaiting-uploads' | 'queued' | 'rendering' | 'done' | 'error';
interface SegmentState extends SegmentData { uploadPreviewUrl?: string; uploading?: boolean; imageError?: string; reviewing?: boolean; attempts?: number }
type ImageLightboxState = { src: string; label: string; fallbackReason?: string } | null;

// ── Small helpers ──────────────────────────────────────────────────────────
function Toggle({ active, onClick, children }: {
  active: boolean; onClick: () => void; children: React.ReactNode
}) {
  return (
    <button
      onClick={onClick}
      className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors border ${
        active
          ? 'bg-blue-600 border-blue-500 text-white'
          : 'bg-gray-800 border-gray-700 text-gray-400 hover:border-gray-500'
      }`}
    >
      {children}
    </button>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return <p className="text-[11px] uppercase tracking-widest text-gray-500 mb-2">{children}</p>;
}

function Spinner({ size = 4 }: { size?: number }) {
  return (
    <span
      className={`inline-block border-2 border-current border-t-transparent rounded-full animate-spin`}
      style={{ width: size * 4, height: size * 4 }}
    />
  );
}

// ── Main page ──────────────────────────────────────────────────────────────
export default function VideoDashboard({
  projectId,
  projectName,
  initialSettings,
  shouldSaveFirstVideoDefaults = false,
}: {
  projectId: string;
  projectName: string;
  initialSettings?: Partial<VideoSettings> | null;
  shouldSaveFirstVideoDefaults?: boolean;
}) {
  const [script, setScript]       = useState('');
  const [settings, setSettings]   = useState<VideoSettings>(() => mergeVideoSettings(initialSettings));
  const [step, setStep]           = useState<AppStep>('idle');
  const [statusMsg, setStatusMsg] = useState('');
  const [segments, setSegments]   = useState<SegmentState[]>([]);
  const [renderPct, setRenderPct] = useState(0);
  const [videoUrl, setVideoUrl]   = useState('');
  const [savedVideoId, setSavedVideoId] = useState('');
  const [activeVideoId, setActiveVideoId] = useState('');
  const [costEstimate, setCostEstimate] = useState<CostEstimate | null>(null);
  const [scriptGenerationCostLines, setScriptGenerationCostLines] = useState<CostLine[]>([]);
  const [isStartingVideo, setIsStartingVideo] = useState(false);
  const [error, setError]         = useState('');
  const [settingsSaveMsg, setSettingsSaveMsg] = useState('');
  const [hasSavedFirstVideoDefaults, setHasSavedFirstVideoDefaults] = useState(!shouldSaveFirstVideoDefaults);
  const [showFontModal, setShowFontModal] = useState(false);
  const [imageLightbox, setImageLightbox] = useState<ImageLightboxState>(null);

  // Review-step state
  const [editingPrompts, setEditingPrompts] = useState<Record<string, string>>({});
  const [regeneratingIds, setRegeneratingIds] = useState<Set<string>>(new Set());

  const fileInputRefs = useRef<Record<string, HTMLInputElement | null>>({});

  const setS = <K extends keyof VideoSettings>(k: K, v: VideoSettings[K]) =>
    setSettings((s) => ({ ...s, [k]: v }));
  const setSub = (patch: Partial<SubtitleSettings>) =>
    setSettings((s) => ({ ...s, subtitle: { ...s.subtitle, ...patch } }));

  const isBusy = step === 'segmenting' || step === 'queued' || step === 'rendering' || step === 'generating-images';

  useEffect(() => {
    const raw = window.sessionStorage.getItem(`videoScriptPrefill:${projectId}`);
    if (!raw) return;

    try {
      const parsed = JSON.parse(raw) as {
        script?: string;
        scriptGenerationCostLines?: CostLine[];
      };
      if (typeof parsed.script === 'string') {
        setScript(parsed.script);
      }
      if (Array.isArray(parsed.scriptGenerationCostLines)) {
        setScriptGenerationCostLines(parsed.scriptGenerationCostLines);
      }
    } catch {
      // Ignore malformed prefill data.
    } finally {
      window.sessionStorage.removeItem(`videoScriptPrefill:${projectId}`);
    }
  }, [projectId]);

  const saveProjectDefaults = useCallback(async (showMessage = true) => {
    setSettingsSaveMsg(showMessage ? 'Ukládám nastavení projektu...' : '');
    const supabase = createClient();
    const { error: saveError } = await supabase
      .from('projects')
      .update({ default_settings: settings })
      .eq('id', projectId);

    if (saveError) {
      setSettingsSaveMsg(`Nastavení se nepodařilo uložit: ${saveError.message}`);
      return false;
    }

    setSettingsSaveMsg(showMessage ? 'Nastavení projektu uloženo.' : '');
    return true;
  }, [projectId, settings]);

  // ── Segmentation ──────────────────────────────────────────────────────────
  const beginGeneration = useCallback(async (videoId: string) => {
    if (!script.trim() || isBusy) return;
    setStep('segmenting'); setStatusMsg('Rozděluji scénář...'); setError(''); setSegments([]);

    try {
      const res  = await fetch('/api/segment', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          projectId,
          videoId,
          script,
          chunkSize: settings.subtitle.chunkSize,
          segmentDuration: settings.segmentDuration,
        }),
      });
      const data = await res.json() as { segments?: SegmentData[]; error?: string };
      if (!res.ok || data.error) throw new Error(data.error ?? await readApiError(res));

      setSegments(data.segments!.map((s) => ({ ...s })));

      if (settings.imageSource === 'upload') {
        setStep('awaiting-uploads');
        setStatusMsg(`Scénář rozdělen na ${data.segments!.length} segmentů. Nahrajte obrázky.`);
      } else {
        await startImageGeneration(data.segments!, videoId);
      }
    } catch (err) {
      setStep('error');
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [script, settings, isBusy, projectId]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleSegment = useCallback(() => {
    if (!script.trim() || isBusy) return;
    setCostEstimate(estimateVideoCost(script, settings, scriptGenerationCostLines));
  }, [script, settings, isBusy, scriptGenerationCostLines]);

  const confirmGeneration = useCallback(async () => {
    if (!script.trim() || isBusy || !costEstimate) return;
    setIsStartingVideo(true);
    setError('');
    try {
      const res = await fetch('/api/videos/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectId, script, settings, scriptGenerationCostLines }),
      });
      const data = await res.json() as { videoId?: string; error?: string };
      if (!res.ok || data.error || !data.videoId) {
        throw new Error(data.error ?? await readApiError(res));
      }
      setActiveVideoId(data.videoId);
      setSavedVideoId(data.videoId);
      setCostEstimate(null);
      await beginGeneration(data.videoId);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsStartingVideo(false);
    }
  }, [beginGeneration, costEstimate, isBusy, projectId, script, settings, scriptGenerationCostLines]);

  // ── Image generation (SSE) ────────────────────────────────────────────────
  const startImageGeneration = useCallback(async (segs: SegmentData[], videoId = activeVideoId) => {
    setStep('generating-images');
    setStatusMsg('Připravuji obrázky...');
    setEditingPrompts({});
    setRegeneratingIds(new Set());

    try {
      const res = await fetch('/api/images', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          projectId,
          videoId,
          segments: segs,
          settings: { imageSource: settings.imageSource, orientation: settings.orientation },
        }),
      });
      if (!res.ok || !res.body) throw new Error(await readApiError(res));

      const reader  = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const lines = buf.split('\n'); buf = lines.pop() ?? '';

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          try {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const ev = JSON.parse(line.slice(6)) as Record<string, any>;
            if (ev.type === 'step') {
              setStatusMsg(ev.message);
            } else if (ev.type === 'reviewing') {
              setSegments((p) => p.map((s, i) =>
                i === ev.index ? { ...s, reviewing: true } : s,
              ));
            } else if (ev.type === 'image_ready') {
              setSegments((p) => p.map((s, i) =>
                i === ev.index
                  ? { ...s, localImagePath: ev.imageUrl, imagePrompt: ev.prompt, imageGenMode: ev.mode, imageFallbackReason: ev.fallbackReason as string | undefined, reviewing: false, attempts: ev.attempts as number | undefined }
                  : s,
              ));
            } else if (ev.type === 'image_failed') {
              setSegments((p) => p.map((s, i) =>
                i === ev.index
                  ? { ...s, imagePrompt: ev.prompt, imageGenMode: ev.mode, imageError: ev.error as string | undefined, reviewing: false }
                  : s,
              ));
            } else if (ev.type === 'done') {
              const serverSegs = ev.segments as SegmentData[];
              // Merge server data with client-side error messages from image_failed events
              setSegments((prev) => serverSegs.map((s: SegmentData, i: number) => ({
                ...s,
                uploadPreviewUrl: prev[i]?.uploadPreviewUrl,
                imageError: s.localImagePath ? undefined : prev[i]?.imageError,
                imageFallbackReason: s.imageFallbackReason ?? prev[i]?.imageFallbackReason,
              })));
              setStep('awaiting-review');
            } else if (ev.type === 'error') {
              throw new Error(ev.message);
            }
          } catch (pe) {
            if (pe instanceof Error && !pe.message.includes('JSON')) throw pe;
          }
        }
      }
    } catch (err) {
      setStep('error');
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [activeVideoId, projectId, settings]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Upload ────────────────────────────────────────────────────────────────
  const handleUpload = useCallback(async (segId: string, file: File, segmentIndex: number) => {
    setSegments((p) => p.map((s) => s.id === segId ? { ...s, uploading: true } : s));
    const preview = URL.createObjectURL(file);
    const fd = new FormData();
    fd.append('file', file);
    fd.append('segmentId', segId);
    fd.append('segmentIndex', String(segmentIndex));
    if (projectId) fd.append('projectId', projectId);
    if (activeVideoId) fd.append('videoId', activeVideoId);
    try {
      const res  = await fetch('/api/upload', { method: 'POST', body: fd });
      const data = await res.json() as { localPath?: string; storagePath?: string | null; error?: string };
      if (!res.ok || data.error) throw new Error(data.error ?? await readApiError(res));
      setSegments((p) =>
        p.map((s) => s.id === segId
          ? {
              ...s,
              localImagePath: data.localPath,
              uploadPreviewUrl: preview,
              uploading: false,
              imageGenMode: undefined,
              imagePrompt: undefined,
              imageError: undefined,
            }
          : s,
        ),
      );
    } catch (err) {
      setSegments((p) => p.map((s) => s.id === segId ? { ...s, uploading: false } : s));
      alert(`Chyba nahrávání: ${err instanceof Error ? err.message : err}`);
    }
  }, [activeVideoId, projectId]);

  // ── Regenerate single image (review step) ─────────────────────────────────
  const handleRegenerate = useCallback(async (segId: string, prompt: string, mode: ImageGenMode, segmentIndex: number) => {
    setRegeneratingIds((p) => new Set(p).add(segId));
    try {
      const res = await fetch('/api/images/regenerate', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ segmentId: segId, prompt, mode, orientation: settings.orientation, projectId, videoId: activeVideoId, segmentIndex }),
      });
      const data = await res.json() as { localImagePath?: string; usedMode?: ImageGenMode; error?: string };
      if (!res.ok || data.error) throw new Error(data.error ?? await readApiError(res));
      setSegments((p) =>
        p.map((s) => s.id === segId
          ? {
              ...s,
              localImagePath: data.localImagePath,
              imagePrompt: prompt,
              imageGenMode: data.usedMode ?? mode,
              imageError: undefined,
              uploadPreviewUrl: undefined,
            }
          : s,
        ),
      );
      setEditingPrompts((p) => { const n = { ...p }; delete n[segId]; return n; });
    } catch (err) {
      alert(`Chyba regenerace: ${err instanceof Error ? err.message : err}`);
    } finally {
      setRegeneratingIds((p) => { const n = new Set(p); n.delete(segId); return n; });
    }
  }, [activeVideoId, projectId, settings.orientation]);

  // ── Render queue ──────────────────────────────────────────────────────────
  const startRender = useCallback(async (segs: SegmentData[]) => {
    setStep('rendering'); setStatusMsg('Řadím video do fronty...'); setRenderPct(0); setVideoUrl('');

    try {
      const res = await fetch('/api/render', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ segments: segs, settings, projectId, originalScript: script, videoId: activeVideoId, scriptGenerationCostLines }),
      });
      const data = await res.json() as {
        videoId?: string;
        message?: string;
        workerTriggered?: boolean;
        workerTriggerSkipped?: boolean;
        error?: string;
      };
      if (!res.ok || data.error || !data.videoId) throw new Error(data.error ?? await readApiError(res));

      setSavedVideoId(data.videoId);
      setActiveVideoId(data.videoId);
      setStep('queued');
      setStatusMsg(data.message ?? 'Job queued. Worker will pick it up shortly.');

      if (!hasSavedFirstVideoDefaults) {
        const saved = await saveProjectDefaults(false);
        if (saved) setHasSavedFirstVideoDefaults(true);
      }
    } catch (err) {
      setStep('error');
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [activeVideoId, hasSavedFirstVideoDefaults, projectId, saveProjectDefaults, script, settings, scriptGenerationCostLines]);

  const handleReset = () => {
    setStep('idle'); setSegments([]); setVideoUrl(''); setSavedVideoId(''); setActiveVideoId(''); setCostEstimate(null); setError(''); setRenderPct(0);
    setEditingPrompts({}); setRegeneratingIds(new Set());
  };

  // ── Voice panel ────────────────────────────────────────────────────────────
  const VoicePanel = () => {
    const speedLabel = settings.speed.toFixed(2) + '×';
    const isGemini = settings.ttsProvider === 'gemini';

    return (
      <div className="bg-gray-900 border border-gray-800 rounded-xl p-4 space-y-4">

        {/* Provider selector */}
        <div>
          <SectionLabel>Voice Software</SectionLabel>
          <div className="grid grid-cols-2 gap-2">
            {([ { id: 'gemini', label: 'Gemini TTS', icon: '✨' }, { id: 'openai', label: 'OpenAI TTS', icon: '🤖' } ] as { id: TTSProvider; label: string; icon: string }[]).map((p) => (
              <button key={p.id} onClick={() => setS('ttsProvider', p.id)}
                className={`py-2.5 px-3 rounded-lg text-sm font-semibold transition-colors border flex items-center gap-2 justify-center ${
                  settings.ttsProvider === p.id
                    ? 'bg-indigo-600 border-indigo-500 text-white'
                    : 'bg-gray-800 border-gray-700 text-gray-300 hover:border-gray-600'
                }`}
              >
                <span>{p.icon}</span>
                <span>{p.label}</span>
              </button>
            ))}
          </div>
        </div>

        {/* ── Gemini TTS section ── */}
        {isGemini && (
          <>
            <div>
              <SectionLabel>Hlas (mužský)</SectionLabel>
              <div className="grid grid-cols-3 gap-1.5">
                {GEMINI_TTS_VOICES.map((v) => (
                  <button key={v.id} onClick={() => setS('geminiVoice', v.id as GeminiTTSVoice)}
                    className={`py-2 px-2 rounded-lg text-left transition-colors border ${
                      settings.geminiVoice === v.id
                        ? 'bg-blue-600 border-blue-500 text-white'
                        : 'bg-gray-800 border-gray-700 text-gray-300 hover:border-gray-600'
                    }`}
                  >
                    <div className="font-semibold text-sm">{v.label}</div>
                    <div className="text-[10px] opacity-60 leading-tight">{v.desc}</div>
                  </button>
                ))}
              </div>
            </div>

            <div>
              <SectionLabel>Styl hlasu</SectionLabel>
              <div className="grid grid-cols-3 gap-1.5 mb-2">
                {GEMINI_TTS_PRESET_ORDER.map((id) => {
                  const p = GEMINI_TTS_PRESETS[id];
                  return (
                    <button key={id} onClick={() => setS('geminiPreset', id as GeminiTTSPreset)}
                      className={`flex flex-col items-center gap-1 py-2 px-1 rounded-lg text-[11px] transition-colors border ${
                        settings.geminiPreset === id
                          ? 'bg-orange-600 border-orange-500 text-white'
                          : 'bg-gray-800 border-gray-700 text-gray-400 hover:border-gray-600'
                      }`}
                    >
                      <span className="text-base leading-none">{p.icon}</span>
                      <span className="font-semibold leading-tight">{p.label}</span>
                    </button>
                  );
                })}
              </div>

              {settings.geminiPreset === 'custom' && (
                <textarea
                  value={settings.geminiCustomPrompt}
                  onChange={(e) => setS('geminiCustomPrompt', e.target.value)}
                  rows={5}
                  placeholder={`Napiš vlastní voice prompt v angličtině, např.:\n\nYou are a viral TikTok storyteller.\nFast exciting intro.\nSlow dramatic pause before final line.`}
                  className="w-full bg-gray-800 border border-gray-700 rounded-lg p-3 text-sm text-white placeholder-gray-600 resize-none focus:outline-none focus:ring-2 focus:ring-orange-500 font-mono"
                />
              )}

              {settings.geminiPreset !== 'custom' && (
                <p className="text-[11px] text-gray-500 italic">
                  {GEMINI_TTS_PRESETS[settings.geminiPreset].desc}
                </p>
              )}
            </div>
          </>
        )}

        {/* ── OpenAI section ── */}
        {!isGemini && (
          <>
            <div>
              <SectionLabel>Hlas (mužský)</SectionLabel>
              <div className="grid grid-cols-3 gap-1.5">
                {OPENAI_VOICES.map((v) => (
                  <button key={v.id} onClick={() => setS('voice', v.id)}
                    className={`py-2 px-2 rounded-lg text-left transition-colors border ${
                      settings.voice === v.id
                        ? 'bg-blue-600 border-blue-500 text-white'
                        : 'bg-gray-800 border-gray-700 text-gray-300 hover:border-gray-600'
                    }`}
                  >
                    <div className="font-semibold text-sm">{v.label}</div>
                    <div className="text-[10px] opacity-60 leading-tight">{v.desc}</div>
                  </button>
                ))}
              </div>
            </div>

            <div>
              <SectionLabel>Styl hlasu</SectionLabel>
              <div className="grid grid-cols-3 gap-1.5 mb-2">
                {PRESET_ORDER.map((id) => {
                  const p = VOICE_PRESETS[id];
                  return (
                    <button key={id} onClick={() => setS('voicePreset', id)}
                      className={`flex flex-col items-center gap-1 py-2 px-1 rounded-lg text-[11px] transition-colors border ${
                        settings.voicePreset === id
                          ? 'bg-orange-600 border-orange-500 text-white'
                          : 'bg-gray-800 border-gray-700 text-gray-400 hover:border-gray-600'
                      }`}
                    >
                      <span className="text-base leading-none">{p.icon}</span>
                      <span className="font-semibold leading-tight">{p.label}</span>
                    </button>
                  );
                })}
              </div>

              {settings.voicePreset === 'custom' && (
                <textarea
                  value={settings.customInstructions}
                  onChange={(e) => setS('customInstructions', e.target.value)}
                  rows={3}
                  placeholder="Napiš instrukce pro hlas v angličtině, např. 'Speak slowly and dramatically, like a documentary narrator...'"
                  className="w-full bg-gray-800 border border-gray-700 rounded-lg p-3 text-sm text-white placeholder-gray-600 resize-none focus:outline-none focus:ring-2 focus:ring-orange-500"
                />
              )}

              {settings.voicePreset !== 'custom' && (
                <p className="text-[11px] text-gray-500 italic">
                  {VOICE_PRESETS[settings.voicePreset].desc}
                </p>
              )}
            </div>

            <div className="grid grid-cols-2 gap-4 items-end">
              <div>
                <SectionLabel>Rychlost — {speedLabel}</SectionLabel>
                <input
                  type="range" min={80} max={160} step={5}
                  value={Math.round(settings.speed * 100)}
                  onChange={(e) => setS('speed', Number(e.target.value) / 100)}
                  className="w-full accent-orange-500"
                />
                <div className="flex justify-between text-[11px] text-gray-600 mt-0.5">
                  <span>0.8× Pomalý</span><span>1.6× Rychlý</span>
                </div>
              </div>
              <div>
                <SectionLabel>Kvalita</SectionLabel>
                <button
                  onClick={() => setS('hdQuality', !settings.hdQuality)}
                  className={`w-full py-2 rounded-lg text-sm font-medium transition-colors border ${
                    settings.hdQuality
                      ? 'bg-yellow-600 border-yellow-500 text-white'
                      : 'bg-gray-800 border-gray-700 text-gray-400 hover:border-gray-600'
                  }`}
                >
                  {settings.hdQuality ? '✦ HD' : '○ Standard'}
                </button>
                <p className="text-[10px] text-gray-600 mt-1 text-center">
                  {settings.hdQuality ? 'tts-1-hd, bez voice instrukcí' : 'preset používá instrukční model'}
                </p>
              </div>
            </div>
          </>
        )}

      </div>
    );
  };

  // ── Subtitle panel ─────────────────────────────────────────────────────────
  const SubtitlePanel = () => (
    <div className="space-y-3">
      <SubtitlePreview
        orientation={settings.orientation}
        subtitle={settings.subtitle}
        onChange={(s) => setSettings((prev) => ({ ...prev, subtitle: s }))}
      />
      <div className="bg-gray-900 border border-gray-800 rounded-xl p-4 space-y-4">

        <div>
          <SectionLabel>Font</SectionLabel>
          <div className="grid grid-cols-5 gap-1.5">
            {FEATURED_FONTS.map((f) => (
              <button key={f.id} onClick={() => setSub({ font: f.id })}
                className={`py-2 rounded-lg text-sm font-bold transition-colors border ${
                  settings.subtitle.font === f.id
                    ? 'bg-purple-700 border-purple-500 text-white'
                    : 'bg-gray-800 border-gray-700 text-gray-300 hover:border-gray-500'
                }`}
                style={{ fontFamily: f.css }}
              >
                {f.label}
              </button>
            ))}
          </div>
          {/* If current font isn't a featured one, show it as selected */}
          {!FEATURED_FONTS.some((f) => f.id === settings.subtitle.font) && (
            <div className="mt-1.5 px-3 py-1.5 bg-purple-900/40 border border-purple-700/60 rounded-lg text-sm text-purple-300">
              ✓ {settings.subtitle.font}
            </div>
          )}
          <button
            onClick={() => setShowFontModal(true)}
            className="mt-1.5 w-full py-1.5 rounded-lg text-[12px] text-gray-500 hover:text-gray-300 border border-dashed border-gray-700 hover:border-gray-500 transition-colors"
          >
            Více fontů… ({ALL_FONTS.length})
          </button>
        </div>

        <div>
          <SectionLabel>Styl</SectionLabel>
          <div className="flex gap-2">
            <Toggle active={settings.subtitle.allCaps} onClick={() => setSub({ allCaps: !settings.subtitle.allCaps })}>
              ABC Caps
            </Toggle>
            <Toggle active={settings.subtitle.highlight} onClick={() => setSub({ highlight: !settings.subtitle.highlight })}>
              ⬡ Zvýraznit
            </Toggle>
          </div>
        </div>

        <div>
          <SectionLabel>Slov najednou</SectionLabel>
          <div className="flex gap-2">
            {([1, 2, 3] as const).map((n) => (
              <Toggle key={n} active={settings.subtitle.chunkSize === n} onClick={() => setSub({ chunkSize: n })}>
                {n === 1 ? '1 slovo' : n === 2 ? '2 slova' : '3 slova'}
              </Toggle>
            ))}
          </div>
        </div>

        <div>
          <SectionLabel>Velikost — {Math.round(settings.subtitle.sizeScale * 100)}%</SectionLabel>
          <input
            type="range" min={70} max={150} step={5}
            value={Math.round(settings.subtitle.sizeScale * 100)}
            onChange={(e) => setSub({ sizeScale: Number(e.target.value) / 100 })}
            className="w-full accent-purple-500"
          />
        </div>

        <div>
          <SectionLabel>Barva textu</SectionLabel>
          <div className="flex gap-1.5 flex-wrap mb-2">
            {TEXT_COLORS.map((c) => (
              <button key={c} onClick={() => setSub({ color: c })}
                className={`w-7 h-7 rounded-full border-2 transition-all ${
                  settings.subtitle.color === c ? 'border-white scale-110' : 'border-gray-600'
                }`}
                style={{ backgroundColor: c }}
              />
            ))}
            <input type="color" value={settings.subtitle.color}
              onChange={(e) => setSub({ color: e.target.value })}
              title="Vlastní barva"
              className="w-7 h-7 rounded-full border-2 border-gray-600 cursor-pointer bg-transparent"
            />
          </div>
          <div className="flex items-center gap-2">
            <div className="w-6 h-6 rounded border border-gray-600 flex-shrink-0" style={{ backgroundColor: settings.subtitle.color }} />
            <input
              type="text"
              value={settings.subtitle.color}
              onChange={(e) => {
                const v = e.target.value;
                if (/^#[0-9a-fA-F]{0,6}$/.test(v)) setSub({ color: v.length === 7 ? v : v });
              }}
              onBlur={(e) => {
                if (!/^#[0-9a-fA-F]{6}$/.test(e.target.value)) setSub({ color: settings.subtitle.color });
              }}
              maxLength={7}
              placeholder="#ffffff"
              className="flex-1 bg-gray-800 border border-gray-700 rounded px-2 py-1 text-xs text-gray-300 font-mono focus:outline-none focus:border-purple-500"
            />
          </div>
        </div>

        {settings.subtitle.highlight && (
          <div>
            <SectionLabel>Barva zvýraznění</SectionLabel>
            <div className="flex gap-1.5 flex-wrap mb-2">
              {HIGHLIGHT_COLORS.map((c) => (
                <button key={c} onClick={() => setSub({ highlightColor: c })}
                  className={`w-7 h-7 rounded-full border-2 transition-all ${
                    settings.subtitle.highlightColor === c ? 'border-white scale-110' : 'border-gray-600'
                  }`}
                  style={{ backgroundColor: c }}
                />
              ))}
              <input type="color" value={settings.subtitle.highlightColor}
                onChange={(e) => setSub({ highlightColor: e.target.value })}
                title="Vlastní barva zvýraznění"
                className="w-7 h-7 rounded-full border-2 border-gray-600 cursor-pointer bg-transparent"
              />
            </div>
            <div className="flex items-center gap-2">
              <div className="w-6 h-6 rounded border border-gray-600 flex-shrink-0" style={{ backgroundColor: settings.subtitle.highlightColor }} />
              <input
                type="text"
                value={settings.subtitle.highlightColor}
                onChange={(e) => {
                  const v = e.target.value;
                  if (/^#[0-9a-fA-F]{0,6}$/.test(v)) setSub({ highlightColor: v.length === 7 ? v : v });
                }}
                onBlur={(e) => {
                  if (!/^#[0-9a-fA-F]{6}$/.test(e.target.value)) setSub({ highlightColor: settings.subtitle.highlightColor });
                }}
                maxLength={7}
                placeholder="#FFE400"
                className="flex-1 bg-gray-800 border border-gray-700 rounded px-2 py-1 text-xs text-gray-300 font-mono focus:outline-none focus:border-purple-500"
              />
            </div>
          </div>
        )}

        <div>
          <SectionLabel>Barva ohraničení</SectionLabel>
          <div className="flex gap-1.5 flex-wrap mb-2">
            {TEXT_COLORS.map((c) => (
              <button key={c} onClick={() => setSub({ captionStrokeColor: c })}
                className={`w-7 h-7 rounded-full border-2 transition-all ${
                  (settings.subtitle.captionStrokeColor ?? '#000000') === c ? 'border-white scale-110' : 'border-gray-600'
                }`}
                style={{ backgroundColor: c }}
              />
            ))}
            <input type="color" value={settings.subtitle.captionStrokeColor ?? '#000000'}
              onChange={(e) => setSub({ captionStrokeColor: e.target.value })}
              title="Vlastní barva ohraničení"
              className="w-7 h-7 rounded-full border-2 border-gray-600 cursor-pointer bg-transparent"
            />
          </div>
          <div className="flex items-center gap-2">
            <div className="w-6 h-6 rounded border border-gray-600 flex-shrink-0" style={{ backgroundColor: settings.subtitle.captionStrokeColor ?? '#000000' }} />
            <input
              type="text"
              value={settings.subtitle.captionStrokeColor ?? '#000000'}
              onChange={(e) => {
                const v = e.target.value;
                if (/^#[0-9a-fA-F]{0,6}$/.test(v)) setSub({ captionStrokeColor: v.length === 7 ? v : v });
              }}
              onBlur={(e) => {
                if (!/^#[0-9a-fA-F]{6}$/.test(e.target.value)) setSub({ captionStrokeColor: settings.subtitle.captionStrokeColor ?? '#000000' });
              }}
              maxLength={7}
              placeholder="#000000"
              className="flex-1 bg-gray-800 border border-gray-700 rounded px-2 py-1 text-xs text-gray-300 font-mono focus:outline-none focus:border-purple-500"
            />
          </div>
        </div>

        <div>
          <SectionLabel>Ohraničení — {settings.subtitle.captionStrokeWidth ?? 0}px</SectionLabel>
          <input
            type="range" min={0} max={12} step={1}
            value={settings.subtitle.captionStrokeWidth ?? 0}
            onChange={(e) => setSub({ captionStrokeWidth: Number(e.target.value) })}
            className="w-full accent-purple-500"
          />
        </div>
      </div>
    </div>
  );

  // ── Main settings ──────────────────────────────────────────────────────────
  const MainSettings = () => (
    <div className="space-y-5">
      <div>
        <SectionLabel>Scénář</SectionLabel>
        <textarea
          value={script}
          onChange={(e) => setScript(e.target.value)}
          rows={7}
          placeholder="Napište nebo vložte scénář videa..."
          className="w-full bg-gray-900 border border-gray-800 rounded-xl p-4 text-white placeholder-gray-600 resize-none focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
      </div>

      {VoicePanel()}

      <div className="bg-gray-900 border border-gray-800 rounded-xl p-4 grid grid-cols-2 gap-4">
        <div>
          <SectionLabel>Formát</SectionLabel>
          <div className="flex gap-2">
            {(['vertical', 'horizontal'] as const).map((o) => (
              <button key={o} onClick={() => setS('orientation', o)}
                className={`flex-1 py-2 rounded-lg text-sm font-medium transition-colors border ${
                  settings.orientation === o
                    ? 'bg-green-700 border-green-600 text-white'
                    : 'bg-gray-800 border-gray-700 text-gray-400 hover:border-gray-600'
                }`}
              >
                {o === 'vertical' ? '📱 9:16' : '🖥 16:9'}
              </button>
            ))}
          </div>
        </div>
        <div>
          <SectionLabel>Obrázky</SectionLabel>
          <div className="grid grid-cols-2 gap-1.5">
            {IMAGE_SOURCES.map((src) => (
              <button key={src.id} onClick={() => setS('imageSource', src.id)}
                title={src.desc}
                className={`flex items-center gap-1.5 py-2 px-2 rounded-lg text-sm font-medium transition-colors border ${
                  settings.imageSource === src.id
                    ? 'bg-teal-700 border-teal-600 text-white'
                    : 'bg-gray-800 border-gray-700 text-gray-400 hover:border-gray-600'
                }`}
              >
                <span>{src.icon}</span>
                <span>{src.label}</span>
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="bg-gray-900 border border-gray-800 rounded-xl p-4 space-y-3">
        <SectionLabel>Délka segmentu</SectionLabel>
        <div className="flex items-center justify-between gap-3">
          <p className="text-sm text-gray-400 leading-snug flex-1">
            {settings.segmentDuration === 'auto'
              ? 'GPT odhadne délku podle počtu slov (4–6 s)'
              : `Pevná délka: ${settings.segmentDuration} s — GPT přizpůsobí délku textu`
            }
          </p>
          <button
            onClick={() => setS('segmentDuration', settings.segmentDuration === 'auto' ? 5 : 'auto')}
            className={`flex-shrink-0 px-4 py-2 rounded-lg text-sm font-semibold transition-colors border ${
              settings.segmentDuration === 'auto'
                ? 'bg-gray-800 border-gray-700 text-gray-400 hover:border-gray-500'
                : 'bg-indigo-600 border-indigo-500 text-white'
            }`}
          >
            {settings.segmentDuration === 'auto' ? '⏱ Auto' : '⏱ Vlastní'}
          </button>
        </div>
        {settings.segmentDuration !== 'auto' && (
          <div>
            <div className="flex justify-between text-[11px] text-gray-500 mb-1">
              <span>2 s</span>
              <span className="text-indigo-400 font-semibold">{settings.segmentDuration} s</span>
              <span>8 s</span>
            </div>
            <input
              type="range" min={2} max={8} step={1}
              value={settings.segmentDuration as number}
              onChange={(e) => setS('segmentDuration', Number(e.target.value))}
              className="w-full accent-indigo-500"
            />
            <div className="flex justify-between mt-1">
              {[2, 3, 4, 5, 6, 7, 8].map((n) => (
                <button key={n} onClick={() => setS('segmentDuration', n)}
                  className={`text-[11px] px-1.5 py-0.5 rounded transition-colors ${
                    settings.segmentDuration === n
                      ? 'bg-indigo-600 text-white'
                      : 'text-gray-600 hover:text-gray-400'
                  }`}
                >
                  {n}s
                </button>
              ))}
            </div>
          </div>
        )}
      </div>

      <div className="bg-gray-900 border border-gray-800 rounded-xl p-4">
        <SectionLabel>Vizuální efekty</SectionLabel>
        <div className="flex items-center justify-between">
          <div className="text-sm text-gray-400 leading-snug">
            GPT přiřadí efekty (flash, zoom, shake, glitch) klíčovým momentům
          </div>
          <button
            onClick={() => setS('enableEffects', !settings.enableEffects)}
            className={`ml-4 flex-shrink-0 px-4 py-2 rounded-lg text-sm font-semibold transition-colors border ${
              settings.enableEffects
                ? 'bg-pink-600 border-pink-500 text-white'
                : 'bg-gray-800 border-gray-700 text-gray-400 hover:border-gray-500'
            }`}
          >
            {settings.enableEffects ? '⚡ Zapnuty' : '○ Vypnuty'}
          </button>
        </div>
        {settings.enableEffects && (
          <div className="mt-3 flex flex-wrap gap-1.5">
            {(Object.entries(EFFECT_META) as [VideoEffect, { icon: string; label: string }][]).map(([key, meta]) => (
              key !== 'none' && (
                <span key={key} className="text-[11px] bg-gray-800 border border-gray-700 rounded px-2 py-0.5 text-gray-400">
                  {meta.icon} {meta.label}
                </span>
              )
            ))}
          </div>
        )}
      </div>

      {step === 'error' && error && (
        <div className="bg-red-950/50 border border-red-800 rounded-xl p-4 text-red-300 text-sm">
          {error}
          <button onClick={handleReset} className="ml-3 underline text-red-400 hover:text-red-300">
            Zkusit znovu
          </button>
        </div>
      )}

      <button
        onClick={handleSegment}
        disabled={!script.trim() || isBusy}
        className="w-full py-4 rounded-xl font-semibold text-base transition-all bg-blue-600 hover:bg-blue-500 disabled:bg-gray-800 disabled:text-gray-600 disabled:cursor-not-allowed"
      >
        {isBusy
          ? <span className="flex items-center justify-center gap-2">
              <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
              {statusMsg}
            </span>
          : settings.imageSource === 'upload'
            ? 'Segmentovat scénář →'
            : 'Připravit obrázky →'
        }
      </button>
    </div>
  );

  const renderImageLightbox = () => imageLightbox ? (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 p-4"
      onClick={() => setImageLightbox(null)}
    >
      <div className="relative w-[75vw] max-w-6xl max-h-[82vh]" onClick={(event) => event.stopPropagation()}>
        <button
          onClick={() => setImageLightbox(null)}
          className="absolute -top-10 right-0 rounded-lg border border-gray-700 bg-gray-900 px-3 py-1.5 text-sm text-gray-200 hover:bg-gray-800"
        >
          Zavřít
        </button>
        <img
          src={imageLightbox.src}
          alt={imageLightbox.label}
          className="max-h-[82vh] w-full rounded-xl border border-gray-800 bg-gray-950 object-contain shadow-2xl"
        />
        {imageLightbox.fallbackReason && (
          <div className="absolute right-3 top-3 rounded-md bg-red-700 px-2.5 py-1 text-xs font-semibold text-white shadow-lg" title={imageLightbox.fallbackReason}>
            Fallback
          </div>
        )}
      </div>
    </div>
  ) : null;

  // ── Upload mode ────────────────────────────────────────────────────────────
  if (step === 'awaiting-uploads') {
    return (
      <main className="min-h-screen bg-gray-950 py-10 px-4">
        <div className="max-w-4xl mx-auto space-y-5">
          <div className="flex items-center justify-between">
            <h2 className="text-xl font-bold">Nahrajte obrázky</h2>
            <button onClick={handleReset} className="text-sm text-gray-500 hover:text-gray-300">← Zpět</button>
          </div>
          <p className="text-sm text-gray-400">{statusMsg}</p>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4">
            {segments.map((seg, i) => (
              <div key={seg.id} className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
                <div className="aspect-video relative bg-gray-800">
                  {seg.uploadPreviewUrl ? (
                    <>
                      <img src={seg.uploadPreviewUrl} alt="" className="w-full h-full object-cover" />
                      <button
                        onClick={() => setSegments((p) => p.map((s) => s.id === seg.id
                          ? { ...s, localImagePath: undefined, uploadPreviewUrl: undefined } : s))}
                        className="absolute top-1 right-1 bg-black/60 text-white rounded-full w-5 h-5 text-xs flex items-center justify-center hover:bg-black/80"
                      >×</button>
                    </>
                  ) : (
                    <button
                      onClick={() => fileInputRefs.current[seg.id]?.click()}
                      disabled={seg.uploading}
                      className="w-full h-full flex flex-col items-center justify-center gap-1 text-gray-500 hover:text-gray-300 transition-colors disabled:opacity-50"
                    >
                      {seg.uploading
                        ? <Spinner />
                        : <><span className="text-2xl">+</span><span className="text-[11px]">Nahrát</span></>
                      }
                    </button>
                  )}
                  <input
                    ref={(el) => { fileInputRefs.current[seg.id] = el; }}
                    type="file" accept="image/*,video/mp4,video/mov,video/webm" className="hidden"
                    onChange={(e) => { const f = e.target.files?.[0]; if (f) handleUpload(seg.id, f, i); }}
                  />
                  <span className="absolute top-1 left-1 bg-black/60 text-white text-[10px] px-1.5 rounded">#{i + 1}</span>
                </div>
                <div className="p-2">
                  <p className="text-gray-400 text-[11px] leading-snug line-clamp-2">{seg.text}</p>
                </div>
              </div>
            ))}
          </div>
          <button onClick={() => startRender(segments)}
            className="w-full py-4 rounded-xl font-semibold text-base bg-blue-600 hover:bg-blue-500 transition-colors">
            Vygenerovat video →
          </button>
        </div>
      </main>
    );
  }

  // ── Generating images ──────────────────────────────────────────────────────
  if (step === 'generating-images') {
    const doneCount = segments.filter((s) => s.localImagePath).length;
    const total = segments.length;
    return (
      <main className="min-h-screen bg-gray-950 py-10 px-4">
        <div className="max-w-3xl mx-auto space-y-5">
          <h2 className="text-xl font-bold">Připravuji obrázky</h2>
          <div className="flex items-start gap-3 bg-gray-900 border border-gray-800 rounded-xl p-4">
            <span className="mt-0.5 w-4 h-4 border-2 border-teal-400 border-t-transparent rounded-full animate-spin flex-shrink-0" />
            <div>
              <p className="text-sm text-gray-300">{statusMsg}</p>
              {total > 0 && (
                <p className="text-xs text-gray-500 mt-1">{doneCount} / {total} hotovo</p>
              )}
              {segments.some((s) => s.reviewing) && (
                <p className="text-xs text-purple-400 mt-1 flex items-center gap-1">
                  <span className="inline-block w-2.5 h-2.5 border border-purple-400 border-t-transparent rounded-full animate-spin" />
                  Gemini kontroluje obrázky…
                </p>
              )}
            </div>
          </div>
          {total > 0 && (
            <div className="h-1.5 bg-gray-800 rounded-full overflow-hidden">
              <div className="h-full bg-teal-500 rounded-full transition-all duration-500"
                style={{ width: `${total ? (doneCount / total) * 100 : 0}%` }} />
            </div>
          )}
          {segments.length > 0 && (
            <div className="grid grid-cols-4 gap-2 sm:grid-cols-6">
              {segments.map((seg, i) => (
                <div
                  key={seg.id ?? i}
                  className="aspect-video bg-gray-900 rounded-lg overflow-hidden relative border border-gray-800"
                  onClick={() => {
                    if (seg.localImagePath && !seg.reviewing) {
                      setImageLightbox({
                        src: seg.uploadPreviewUrl ?? seg.localImagePath,
                        label: `Obrázek ${i + 1}`,
                        fallbackReason: seg.imageFallbackReason,
                      });
                    }
                  }}
                >
                  {seg.localImagePath && !seg.reviewing
                    ? <img src={seg.uploadPreviewUrl ?? seg.localImagePath} alt="" className="w-full h-full object-cover cursor-zoom-in" />
                    : <div className="w-full h-full flex flex-col items-center justify-center gap-1">
                        <Spinner size={3} />
                        {seg.reviewing && (
                          <span className="text-[8px] text-purple-400 leading-none">AI QA</span>
                        )}
                      </div>
                  }
                  {seg.imageGenMode && !seg.reviewing && (
                    <span className={`absolute top-0.5 left-0.5 text-[8px] px-1 rounded text-white ${MODE_META[seg.imageGenMode].color}`}>
                      {MODE_META[seg.imageGenMode].icon}
                    </span>
                  )}
                  {seg.imageFallbackReason && !seg.reviewing && (
                    <span
                      className="absolute top-0.5 right-0.5 text-[8px] px-1 rounded bg-red-700 text-white"
                      title={seg.imageFallbackReason}
                    >
                      Fallback
                    </span>
                  )}
                  {seg.reviewing && (
                    <span className="absolute top-0.5 left-0.5 text-[8px] px-1 rounded text-white bg-purple-700/90">
                      👁
                    </span>
                  )}
                  <span className="absolute bottom-0.5 right-0.5 bg-black/60 text-[9px] px-1 rounded text-white">
                    #{i + 1}
                  </span>
                </div>
              ))}
            </div>
          )}
          {renderImageLightbox()}
        </div>
      </main>
    );
  }

  // ── Review step ────────────────────────────────────────────────────────────
  if (step === 'awaiting-review') {
    const anyRegenerating = regeneratingIds.size > 0;
    return (
      <main className="min-h-screen bg-gray-950 py-10 px-4">
        <div className="max-w-5xl mx-auto space-y-5">

          {/* Header */}
          <div className="flex items-center justify-between flex-wrap gap-3">
            <div>
              <h2 className="text-xl font-bold">Zkontrolujte obrázky</h2>
              <p className="text-sm text-gray-500 mt-0.5">
                Nahrajte vlastní nebo přepište prompt a regenerujte — pak odsouhlaste.
              </p>
            </div>
            <div className="flex gap-3">
              <button onClick={handleReset} className="py-2 px-4 rounded-lg text-sm text-gray-500 hover:text-gray-300 border border-gray-800 hover:border-gray-600 transition-colors">
                ← Zpět
              </button>
              <button
                onClick={() => startRender(segments)}
                disabled={anyRegenerating}
                className="py-2 px-5 rounded-lg font-semibold text-sm bg-blue-600 hover:bg-blue-500 disabled:bg-gray-800 disabled:text-gray-600 disabled:cursor-not-allowed transition-colors"
              >
                {anyRegenerating ? 'Čekám na regeneraci...' : 'Odsouhlasit a renderovat →'}
              </button>
            </div>
          </div>

          {/* Grid */}
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
            {segments.map((seg, i) => {
              const isRegen = regeneratingIds.has(seg.id);
              const isEditing = seg.id in editingPrompts;
              const editPrompt = editingPrompts[seg.id] ?? '';
              const mode = seg.imageGenMode;
              const canRegen = !!mode; // only if image was AI/google generated (has a mode)
              const thumbSrc = seg.uploadPreviewUrl ?? (seg.localImagePath
                ? `/api/image?path=${encodeURIComponent(seg.localImagePath)}`
                : null);

              return (
                <div key={seg.id} className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden flex flex-col">

                  {/* Thumbnail */}
                  <div
                    className="aspect-video relative bg-gray-800 flex-shrink-0"
                    onClick={() => {
                      if (thumbSrc && !isRegen) {
                        setImageLightbox({
                          src: thumbSrc,
                          label: `Obrázek ${i + 1}`,
                          fallbackReason: seg.imageFallbackReason,
                        });
                      }
                    }}
                  >
                    {isRegen ? (
                      <div className="w-full h-full flex flex-col items-center justify-center gap-2 text-gray-500">
                        <Spinner size={5} />
                        <span className="text-[10px]">Hledám...</span>
                      </div>
                    ) : thumbSrc ? (
                      <img src={thumbSrc} alt="" className="w-full h-full object-cover cursor-zoom-in" />
                    ) : (
                      <div className="w-full h-full flex flex-col items-center justify-center gap-1 p-2">
                        <span className="text-yellow-500 text-base">⚠</span>
                        <span className="text-[9px] text-gray-500 text-center leading-tight line-clamp-3">
                          {(seg as SegmentState).imageError ?? 'Obrázek se nepodařilo načíst'}
                        </span>
                      </div>
                    )}

                    {/* Badges */}
                    <span className="absolute top-1 left-1 bg-black/60 text-white text-[9px] px-1.5 rounded font-mono">
                      #{i + 1}
                    </span>
                    {mode && !isRegen && !seg.imageFallbackReason && (
                      <span className={`absolute top-1 right-1 text-[9px] px-1.5 py-0.5 rounded text-white ${MODE_META[mode].color}`}>
                        {MODE_META[mode].icon} {MODE_META[mode].label}
                      </span>
                    )}
                    {mode && !isRegen && seg.imageFallbackReason && (
                      <span className={`absolute bottom-1 right-1 text-[9px] px-1.5 py-0.5 rounded text-white ${MODE_META[mode].color}`}>
                        {MODE_META[mode].icon} {MODE_META[mode].label}
                      </span>
                    )}
                    {seg.imageFallbackReason && !isRegen && (
                      <span
                        className="absolute top-1 right-1 rounded bg-red-700 px-1.5 py-0.5 text-[9px] font-semibold text-white"
                        title={seg.imageFallbackReason}
                      >
                        Fallback
                      </span>
                    )}
                    {(seg as SegmentState).attempts != null && (seg as SegmentState).attempts! > 1 && !isRegen && (
                      <span className="absolute bottom-1 left-1 bg-purple-800/80 text-purple-200 text-[8px] px-1 py-0.5 rounded" title="Počet pokusů AI revieweru">
                        👁 {(seg as SegmentState).attempts}×
                      </span>
                    )}

                    {/* Hidden file input */}
                    <input
                      ref={(el) => { fileInputRefs.current[seg.id] = el; }}
                      type="file" accept="image/*,video/mp4,video/mov,video/webm" className="hidden"
                      onChange={(e) => { const f = e.target.files?.[0]; if (f) handleUpload(seg.id, f, i); }}
                    />
                  </div>

                  {/* Body */}
                  <div className="p-3 flex flex-col gap-2 flex-1">
                    {/* Segment text */}
                    <p className="text-gray-400 text-[11px] leading-snug line-clamp-2">{seg.text}</p>

                    {/* Prompt / edit area */}
                    {isEditing ? (
                      <div className="text-[10px] text-gray-600 leading-snug">
                        <p className="text-[10px] text-purple-400 mb-1">🎨 AI prompt pro generování:</p>
                        <textarea
                          value={editPrompt}
                          onChange={(e) => setEditingPrompts((p) => ({ ...p, [seg.id]: e.target.value }))}
                          rows={3}
                          placeholder="Popiš obrázek v angličtině pro AI generování…"
                          className="w-full bg-gray-800 border border-gray-700 rounded p-1.5 text-gray-300 text-[11px] resize-none focus:outline-none focus:border-purple-500"
                          autoFocus
                        />
                      </div>
                    ) : seg.imagePrompt && (
                      <div className="text-[10px] text-gray-600 leading-snug">
                        <span className="italic line-clamp-2 text-gray-500">
                          {mode === 'google' ? '🔍 ' : '🎨 '}
                          {seg.imagePrompt}
                        </span>
                      </div>
                    )}

                    {/* Action buttons */}
                    <div className="flex gap-1.5 mt-auto flex-wrap">
                      {/* Upload own */}
                      <button
                        onClick={() => fileInputRefs.current[seg.id]?.click()}
                        disabled={isRegen}
                        className="flex-1 py-1.5 rounded text-[11px] bg-gray-800 hover:bg-gray-700 border border-gray-700 text-gray-400 hover:text-gray-200 disabled:opacity-40 transition-colors"
                      >
                        {seg.uploading ? <Spinner size={2} /> : '↑ Vlastní'}
                      </button>

                      {/* AI generate with custom prompt */}
                      {canRegen && (
                        isEditing ? (
                          <>
                            <button
                              onClick={() => setEditingPrompts((p) => { const n = { ...p }; delete n[seg.id]; return n; })}
                              className="py-1.5 px-2 rounded text-[11px] bg-gray-800 hover:bg-gray-700 border border-gray-700 text-gray-400 transition-colors"
                            >
                              Zrušit
                            </button>
                            <button
                              onClick={() => handleRegenerate(seg.id, editPrompt, 'imagen', i)}
                              disabled={!editPrompt.trim() || isRegen}
                              className="flex-1 py-1.5 rounded text-[11px] bg-purple-700 hover:bg-purple-600 border border-purple-600 text-white disabled:opacity-40 transition-colors"
                            >
                              {isRegen ? <Spinner size={2} /> : '🎨 Vygenerovat'}
                            </button>
                          </>
                        ) : (
                          <button
                            onClick={() => setEditingPrompts((p) => ({ ...p, [seg.id]: seg.imagePrompt ?? '' }))}
                            disabled={isRegen}
                            className="flex-1 py-1.5 rounded text-[11px] bg-purple-900/60 hover:bg-purple-800/60 border border-purple-700 text-purple-300 hover:text-purple-100 disabled:opacity-40 transition-colors"
                          >
                            🎨 AI nový
                          </button>
                        )
                      )}
                    </div>
                  </div>

                </div>
              );
            })}
          </div>

          {/* Bottom approve button */}
          <button
            onClick={() => startRender(segments)}
            disabled={anyRegenerating}
            className="w-full py-4 rounded-xl font-semibold text-base bg-blue-600 hover:bg-blue-500 disabled:bg-gray-800 disabled:text-gray-600 disabled:cursor-not-allowed transition-colors"
          >
            {anyRegenerating ? 'Čekám na dokončení regenerace...' : 'Odsouhlasit a renderovat video →'}
          </button>

        </div>
        {renderImageLightbox()}
      </main>
    );
  }

  // ── Rendering ──────────────────────────────────────────────────────────────
  if (step === 'rendering') {
    return (
      <main className="min-h-screen bg-gray-950 py-10 px-4">
        <div className="max-w-3xl mx-auto space-y-5">
          <h2 className="text-xl font-bold">Generuji video</h2>
          <div className="flex items-start gap-3 bg-gray-900 border border-gray-800 rounded-xl p-4">
            <span className="mt-0.5 w-4 h-4 border-2 border-blue-400 border-t-transparent rounded-full animate-spin flex-shrink-0" />
            <p className="text-sm text-gray-300">{statusMsg}</p>
          </div>
          {renderPct > 0 && (
            <div>
              <div className="flex justify-between text-xs text-gray-400 mb-1.5">
                <span>Render</span><span>{renderPct}%</span>
              </div>
              <div className="h-2 bg-gray-800 rounded-full overflow-hidden">
                <div className="h-full bg-blue-500 rounded-full transition-all duration-300"
                  style={{ width: `${renderPct}%` }} />
              </div>
            </div>
          )}
          {segments.length > 0 && (
            <div className="grid grid-cols-4 gap-2 sm:grid-cols-6">
              {segments.map((seg, i) => (
                <div key={seg.id ?? i} className="aspect-video bg-gray-900 rounded-lg overflow-hidden relative border border-gray-800">
                  {(seg.localImagePath || seg.uploadPreviewUrl)
                    ? <img src={seg.uploadPreviewUrl ?? `/api/image?path=${encodeURIComponent(seg.localImagePath!)}`} alt="" className="w-full h-full object-cover" />
                    : <div className="w-full h-full flex items-center justify-center text-gray-700 text-xs">#{i + 1}</div>
                  }
                  {seg.audioPath && <span className="absolute bottom-0.5 right-0.5 bg-blue-600/80 text-[9px] px-1 rounded">♪</span>}
                  {seg.effect && seg.effect !== 'none' && (
                    <span className="absolute top-0.5 right-0.5 bg-black/70 text-[9px] px-1 rounded leading-tight">
                      {EFFECT_META[seg.effect].icon}
                    </span>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </main>
    );
  }

  if (step === 'queued') {
    return (
      <main className="min-h-screen bg-gray-950 py-10 px-4">
        <div className="max-w-2xl mx-auto space-y-5">
          <div className="rounded-xl border border-cyan-900/60 bg-cyan-950/20 p-5">
            <p className="text-xs font-black uppercase tracking-[0.25em] text-cyan-300">Queued</p>
            <h2 className="mt-2 text-xl font-bold text-white">Video je ve frontě</h2>
            <p className="mt-2 text-sm text-gray-300">{statusMsg}</p>
          </div>
          <div className="flex flex-wrap gap-3">
            {savedVideoId && (
              <Link href={`/videos/${savedVideoId}`}
                className="flex-1 rounded-xl bg-cyan-600 px-4 py-3 text-center text-sm font-semibold text-white transition hover:bg-cyan-500 min-w-[160px]">
                Otevřít detail videa
              </Link>
            )}
            <Link href="/videos"
              className="flex-1 rounded-xl bg-gray-800 px-4 py-3 text-center text-sm font-semibold text-gray-200 transition hover:bg-gray-700 min-w-[160px]">
              Zobrazit historii
            </Link>
            <button onClick={handleReset}
              className="flex-1 rounded-xl border border-gray-700 px-4 py-3 text-sm font-semibold text-gray-300 transition hover:border-gray-500 hover:text-white min-w-[140px]">
              Vytvořit další
            </button>
          </div>
        </div>
      </main>
    );
  }

  // ── Done ───────────────────────────────────────────────────────────────────
  if (step === 'done' && videoUrl) {
    return (
      <main className="min-h-screen bg-gray-950 py-10 px-4">
        <div className="max-w-2xl mx-auto space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-xl font-bold text-green-400">Video hotovo!</h2>
            <button onClick={handleReset} className="text-sm text-gray-500 hover:text-gray-300">Nové video</button>
          </div>
          <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
            <video src={videoUrl} controls autoPlay loop className="w-full" />
          </div>
          <div className="flex gap-3 flex-wrap">
            <a href={savedVideoId ? `/api/videos/${savedVideoId}/download` : videoUrl}
              className="flex-1 py-3 bg-green-600 hover:bg-green-500 rounded-xl text-center font-semibold text-sm transition-colors min-w-[120px]">
              Stáhnout MP4
            </a>
            {savedVideoId && (
              <Link href={`/videos/${savedVideoId}/publish`}
                className="flex-1 py-3 bg-purple-600 hover:bg-purple-500 rounded-xl text-center font-semibold text-sm transition-colors min-w-[160px]">
                Schedule Publishing
              </Link>
            )}
            {savedVideoId && (
              <Link href={`/videos/${savedVideoId}/edit`}
                className="flex-1 py-3 bg-cyan-600 hover:bg-cyan-500 rounded-xl text-center font-semibold text-sm transition-colors min-w-[120px]">
                ✏️ Editovat video
              </Link>
            )}
            {savedVideoId && (
              <Link href={`/videos/${savedVideoId}`}
                className="flex-1 py-3 bg-gray-700 hover:bg-gray-600 rounded-xl text-center font-semibold text-sm transition-colors min-w-[120px]">
                Detail
              </Link>
            )}
            <button onClick={handleReset}
              className="flex-1 py-3 bg-gray-800 hover:bg-gray-700 rounded-xl text-center font-semibold text-sm transition-colors min-w-[120px]">
              Vytvořit nové
            </button>
          </div>
        </div>
      </main>
    );
  }

  // ── Idle / Error → main layout ─────────────────────────────────────────────
  return (
    <main className="min-h-screen bg-gray-950 py-10 px-4">
      <div className="max-w-6xl mx-auto">
        <div className="mb-6 flex flex-col gap-3 rounded-xl border border-gray-800 bg-gray-900/70 p-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-[11px] uppercase tracking-widest text-gray-500">Selected project</p>
            <h2 className="mt-1 text-lg font-bold text-white">{projectName}</h2>
            {settingsSaveMsg && <p className="mt-1 text-xs text-cyan-300">{settingsSaveMsg}</p>}
          </div>
          <div className="flex flex-wrap gap-2">
            <Link
              href="/projects"
              className="rounded-lg border border-gray-700 px-3 py-2 text-sm font-semibold text-gray-300 transition hover:border-gray-500 hover:text-white"
            >
              ← Projects
            </Link>
            <button
              onClick={() => saveProjectDefaults(true)}
              className="rounded-lg border border-cyan-700 bg-cyan-400/10 px-3 py-2 text-sm font-semibold text-cyan-200 transition hover:border-cyan-400 hover:text-white"
            >
              Save current settings
            </button>
          </div>
        </div>

        <div className="text-center mb-8">
          <h1 className="text-4xl font-bold tracking-tight">AI Video Generator</h1>
          <p className="text-gray-500 mt-1 text-sm">Scénář → obrázky · hlas · titulky → hotové video</p>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-[3fr_2fr] gap-8 items-start">
          {MainSettings()}
          <div className="lg:sticky lg:top-8 space-y-1">
            <p className="text-sm font-semibold text-gray-300 mb-3">Titulky &amp; Preview</p>
            {SubtitlePanel()}
          </div>
        </div>
      </div>

      {/* ── Font picker modal ────────────────────────────────────────────── */}
      {showFontModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm"
          onClick={() => setShowFontModal(false)}
        >
          <div
            className="bg-gray-900 border border-gray-700 rounded-2xl p-6 w-full max-w-lg shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-base font-bold text-white">Vyberte font</h3>
              <button onClick={() => setShowFontModal(false)}
                className="text-gray-500 hover:text-white text-xl leading-none">×</button>
            </div>
            <div className="grid grid-cols-2 gap-2 max-h-[60vh] overflow-y-auto pr-1">
              {ALL_FONTS.map((f) => (
                <button
                  key={f.id}
                  onClick={() => { setSub({ font: f.id }); setShowFontModal(false); }}
                  className={`py-3 px-4 rounded-xl text-left transition-colors border ${
                    settings.subtitle.font === f.id
                      ? 'bg-purple-700 border-purple-500 text-white'
                      : 'bg-gray-800 border-gray-700 text-gray-300 hover:border-gray-500 hover:bg-gray-750'
                  }`}
                >
                  <span className="block text-base font-bold leading-tight" style={{ fontFamily: f.css }}>
                    {f.label}
                  </span>
                  <span className="block text-[10px] text-gray-500 mt-0.5" style={{ fontFamily: f.css }}>
                    AaBbCc 123
                  </span>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {costEstimate && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4 backdrop-blur-sm">
          <div className="w-full max-w-lg rounded-2xl border border-gray-700 bg-gray-900 p-6 shadow-2xl">
            <p className="text-xs font-bold uppercase tracking-[0.22em] text-cyan-300">
              Estimated cost
            </p>
            <h3 className="mt-2 text-2xl font-black tracking-normal text-white">
              Estimated cost for this video
            </h3>
            <p className="mt-2 text-sm leading-6 text-gray-400">
              This is an approximate pre-generation estimate. Final cost can change with image retries, audio duration and provider responses.
            </p>

            <div className="my-5 rounded-xl border border-cyan-900 bg-cyan-950/30 p-4">
              <p className="text-sm text-gray-400">Estimated total</p>
              <p className="mt-1 text-4xl font-black text-cyan-200">{formatUsd(costEstimate.totalUsd)}</p>
            </div>

            <div className="max-h-64 space-y-2 overflow-y-auto pr-1">
              {costEstimate.lines.map((line, index) => (
                <div key={`${line.step}-${index}`} className="flex items-center justify-between gap-3 rounded-lg border border-gray-800 bg-gray-950 px-3 py-2">
                  <div>
                    <p className="text-sm font-bold text-gray-200">{line.step.replaceAll('_', ' ')}</p>
                    <p className="text-xs text-gray-500">{line.provider}{line.model ? ` · ${line.model}` : ''}</p>
                  </div>
                  <p className="text-sm font-bold text-cyan-200">{formatUsd(line.costUsd)}</p>
                </div>
              ))}
            </div>

            <div className="mt-6 flex gap-3">
              <button
                onClick={() => setCostEstimate(null)}
                disabled={isStartingVideo}
                className="flex-1 rounded-lg border border-gray-700 px-4 py-3 text-sm font-bold text-gray-300 transition hover:border-gray-500 hover:text-white disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                onClick={confirmGeneration}
                disabled={isStartingVideo}
                className="flex-1 rounded-lg bg-cyan-400 px-4 py-3 text-sm font-black uppercase tracking-[0.16em] text-gray-950 transition hover:bg-cyan-300 disabled:opacity-60"
              >
                {isStartingVideo ? 'Starting...' : 'Generate Video'}
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
