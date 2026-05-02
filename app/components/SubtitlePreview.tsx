'use client';

import { useRef, useEffect, useCallback, useState } from 'react';
import type { SubtitleSettings, SubtitleFont, SubtitleAnimation, Orientation } from '@/types';

// ── Sample data ────────────────────────────────────────────────────────────
const SAMPLE_CHUNKS = [
  ['Tohle', 'je', 'ukázka'],
  ['titulků', 've', 'videu'],
  ['vypadá', 'skvěle!'],
];
const IMPORTANT = new Set(['ukázka', 'titulků', 'skvěle']);
const FRAMES_PER_CHUNK = 60; // 2 s at 30 fps for preview

function fontFamily(font: SubtitleFont): string {
  switch (font) {
    case 'Bebas Neue':       return '"Bebas Neue", Impact, sans-serif';
    case 'Impact':      return 'Impact, Haettenschweiler, sans-serif';
    case 'Montserrat':       return '"Montserrat", "Arial Black", sans-serif';
    case 'Anton':            return '"Anton", Impact, sans-serif';
    case 'Poppins':          return '"Poppins", sans-serif';
    case 'Inter':            return '"Inter", sans-serif';
    case 'Archivo Black':    return '"Archivo Black", "Arial Black", sans-serif';
    case 'League Spartan':   return '"League Spartan", "Arial Black", sans-serif';
    case 'Raleway':          return '"Raleway", sans-serif';
    case 'Oswald':           return '"Oswald", "Arial Narrow", sans-serif';
    case 'Roboto Condensed': return '"Roboto Condensed", "Arial Narrow", sans-serif';
    case 'TheBoldFont':      return '"TheBoldFont", Impact, sans-serif';
    case 'Arial Black': return '"Arial Black", "Arial Bold", Gadget, sans-serif';
    case 'Georgia':     return 'Georgia, "Times New Roman", serif';
    case 'Verdana':     return 'Verdana, Geneva, Tahoma, sans-serif';
    case 'Courier New': return '"Courier New", Courier, monospace';
  }
}

function normalize(w: string) {
  return w.toLowerCase().replace(/[^a-záčďéěíňóřšťúůýž]/g, '');
}

// ── Animation definitions (for selector) ──────────────────────────────────
export const ANIMATIONS: { id: SubtitleAnimation; label: string; icon: string; desc: string }[] = [
  { id: 'none',           label: 'Statické',   icon: '━',  desc: 'Bez animace' },
  { id: 'word-highlight', label: 'Karaoke',    icon: '🎤', desc: 'Zvýrazní slovo při výslovnosti' },
  { id: 'word-reveal',    label: 'Odhalování', icon: '▶',  desc: 'Slova se postupně objevují' },
  { id: 'pop',            label: 'Pop',        icon: '💥', desc: 'Fráze vyskočí při změně' },
  { id: 'fade-slide',     label: 'Slide',      icon: '↑',  desc: 'Fráze najede zdola' },
];

// ── Props ──────────────────────────────────────────────────────────────────
interface Props {
  orientation: Orientation;
  subtitle: SubtitleSettings;
  onChange: (s: SubtitleSettings) => void;
}

// ── Component ──────────────────────────────────────────────────────────────
export function SubtitlePreview({ orientation, subtitle, onChange }: Props) {
  const containerRef  = useRef<HTMLDivElement>(null);
  const isDragging    = useRef(false);
  const subtitleRef   = useRef(subtitle);
  subtitleRef.current = subtitle;
  const onChangeRef   = useRef(onChange);
  onChangeRef.current = onChange;

  // ── Simulated frame counter for live animation preview ─────────────────
  const [frame, setFrame] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setFrame((f) => (f + 1) % (FRAMES_PER_CHUNK * SAMPLE_CHUNKS.length)), 1000 / 30);
    return () => clearInterval(id);
  }, []);

  // ── Drag position logic ────────────────────────────────────────────────
  const updatePos = useCallback((clientY: number) => {
    const el = containerRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const pct  = 100 - ((clientY - rect.top) / rect.height) * 100;
    const clamped = Math.round(Math.max(2, Math.min(85, pct)));
    onChangeRef.current({ ...subtitleRef.current, positionY: clamped });
  }, []);

  useEffect(() => {
    const onMove  = (e: MouseEvent) => { if (isDragging.current) updatePos(e.clientY); };
    const onTouch = (e: TouchEvent) => { if (isDragging.current) updatePos(e.touches[0].clientY); };
    const onUp    = () => { isDragging.current = false; };

    document.addEventListener('mousemove', onMove);
    document.addEventListener('touchmove', onTouch, { passive: true });
    document.addEventListener('mouseup', onUp);
    document.addEventListener('touchend', onUp);
    return () => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('touchmove', onTouch);
      document.removeEventListener('mouseup', onUp);
      document.removeEventListener('touchend', onUp);
    };
  }, [updatePos]);

  // ── Compute subtitle content for current preview frame ─────────────────
  const isVertical     = orientation === 'vertical';
  const { font, allCaps, highlight, color, highlightColor, sizeScale, positionY, animation } = subtitle;

  const chunkIdx     = Math.min(Math.floor(frame / FRAMES_PER_CHUNK), SAMPLE_CHUNKS.length - 1);
  const frameInChunk = frame - chunkIdx * FRAMES_PER_CHUNK;
  const chunkWords   = SAMPLE_CHUNKS[chunkIdx];
  const baseFs       = (isVertical ? 16 : 18) * sizeScale;

  const disp  = (w: string) => (allCaps ? w.toUpperCase() : w);
  const isKey = (w: string) => highlight && IMPORTANT.has(normalize(w));

  const wordSpans = (words: string[], activeIdx = -1) =>
    words.map((word, i) => {
      const active = i === activeIdx;
      return (
        <span
          key={i}
          style={{
            color: active ? highlightColor : isKey(word) ? highlightColor : color,
            opacity: activeIdx >= 0 && !active ? 0.45 : 1,
            fontWeight: active ? 900 : 700,
            transition: 'color 0.05s, opacity 0.05s',
          }}
        >
          {disp(word)}{i < words.length - 1 ? ' ' : ''}
        </span>
      );
    });

  let subtitleNode: React.ReactNode;
  const shared: React.CSSProperties = {
    fontFamily: fontFamily(font),
    fontSize: baseFs,
    fontWeight: 900,
    lineHeight: 1.2,
    letterSpacing: '-0.01em',
    textShadow: '0 1px 6px rgba(0,0,0,0.9), 1px 1px 0 rgba(0,0,0,0.5)',
  };

  switch (animation) {
    case 'word-highlight': {
      const n = chunkWords.length;
      const fpw = FRAMES_PER_CHUNK / n;
      const active = Math.min(Math.floor(frameInChunk / fpw), n - 1);
      subtitleNode = <span style={shared}>{wordSpans(chunkWords, active)}</span>;
      break;
    }
    case 'word-reveal': {
      const n = chunkWords.length;
      const fpw = FRAMES_PER_CHUNK / n;
      const visible = Math.min(Math.floor(frameInChunk / fpw) + 1, n);
      subtitleNode = (
        <span style={shared}>
          {chunkWords.slice(0, visible).map((w, i) => (
            <span key={i} style={{ color: isKey(w) ? highlightColor : color }}>
              {disp(w)}{i < visible - 1 ? ' ' : ''}
            </span>
          ))}
        </span>
      );
      break;
    }
    case 'pop': {
      // Simulate bounce using CSS animation class keyed to chunkIdx
      const t = Math.min(frameInChunk / 10, 1);
      const s = t < 0.3 ? 0.65 + t / 0.3 * 0.47 : t < 0.6 ? 1.12 - (t - 0.3) / 0.3 * 0.18 : t < 0.9 ? 0.94 + (t - 0.6) / 0.3 * 0.06 : 1.0;
      subtitleNode = (
        <span style={{ ...shared, display: 'inline-block', transform: `scale(${s})` }}>
          {wordSpans(chunkWords)}
        </span>
      );
      break;
    }
    case 'fade-slide': {
      const t = Math.min(frameInChunk / 10, 1);
      const y = (1 - t) * 14;
      subtitleNode = (
        <span style={{ ...shared, display: 'inline-block', transform: `translateY(${y}px)`, opacity: t }}>
          {wordSpans(chunkWords)}
        </span>
      );
      break;
    }
    default:
      subtitleNode = <span style={shared}>{wordSpans(chunkWords)}</span>;
  }

  // ── Render ─────────────────────────────────────────────────────────────
  return (
    <div className="select-none space-y-3">
      {/* ── Video frame mockup ── */}
      <div
        ref={containerRef}
        className="relative overflow-hidden rounded-2xl cursor-crosshair"
        style={{
          aspectRatio: isVertical ? '9 / 16' : '16 / 9',
          background: 'linear-gradient(135deg, #1a1a3e 0%, #16213e 40%, #0f3460 100%)',
          userSelect: 'none',
          touchAction: 'none',
        }}
        onMouseDown={(e) => { isDragging.current = true; updatePos(e.clientY); }}
        onTouchStart={(e) => { isDragging.current = true; updatePos(e.touches[0].clientY); }}
      >
        {/* Mock image blobs */}
        <div className="absolute inset-0 opacity-20" style={{
          backgroundImage:
            'radial-gradient(circle at 25% 35%, #5a5aaa, transparent 55%),' +
            'radial-gradient(circle at 75% 65%, #2a7a5a, transparent 55%)',
        }} />
        {/* Bottom gradient */}
        <div className="absolute inset-0" style={{
          background: 'linear-gradient(to bottom, transparent 40%, rgba(0,0,0,0.8) 100%)',
        }} />

        {/* Format badge */}
        <div className="absolute top-2 left-2 bg-black/60 text-white text-[10px] font-bold px-2 py-0.5 rounded">
          {isVertical ? '9:16' : '16:9'}
        </div>
        {/* Position badge */}
        <div className="absolute top-2 right-2 bg-blue-700/80 text-white text-[10px] px-2 py-0.5 rounded">
          ↕ {positionY}%
        </div>

        {/* ── Subtitle ── */}
        <div
          className="absolute left-0 right-0 text-center pointer-events-none"
          style={{ bottom: `${positionY}%`, padding: '0 6%' }}
        >
          {subtitleNode}
        </div>

        {/* Drag rail */}
        <div className="absolute left-0 right-0 pointer-events-none" style={{ bottom: `${positionY}%` }}>
          <div style={{ height: 1, background: 'rgba(96,165,250,0.45)', margin: '0 8px' }} />
        </div>

        {/* Drag handle */}
        <div
          className="absolute right-0 flex items-center justify-center cursor-grab active:cursor-grabbing"
          style={{
            bottom: `calc(${positionY}% - 10px)`,
            width: 28, height: 20,
            background: 'rgba(0,0,0,0.55)',
            borderRadius: '4px 0 0 4px',
            pointerEvents: 'auto',
          }}
          onMouseDown={(e) => { e.stopPropagation(); isDragging.current = true; }}
          onTouchStart={(e) => { e.stopPropagation(); isDragging.current = true; }}
        >
          <svg width="12" height="12" viewBox="0 0 12 12" fill="rgba(255,255,255,0.75)">
            <circle cx="3" cy="3" r="1.2" /><circle cx="9" cy="3" r="1.2" />
            <circle cx="3" cy="6" r="1.2" /><circle cx="9" cy="6" r="1.2" />
            <circle cx="3" cy="9" r="1.2" /><circle cx="9" cy="9" r="1.2" />
          </svg>
        </div>
      </div>

      <p className="text-center text-[11px] text-gray-600">
        Přetáhni pro změnu výšky · animace běží živě
      </p>

      {/* ── Animation selector ── */}
      <div>
        <p className="text-[11px] uppercase tracking-widest text-gray-500 mb-2">Animace titulků</p>
        <div className="grid grid-cols-5 gap-1.5">
          {ANIMATIONS.map((a) => (
            <button
              key={a.id}
              onClick={() => onChange({ ...subtitle, animation: a.id })}
              title={a.desc}
              className={`flex flex-col items-center gap-1 py-2 px-1 rounded-lg text-center text-[11px] transition-colors border ${
                subtitle.animation === a.id
                  ? 'bg-blue-700 border-blue-500 text-white'
                  : 'bg-gray-800 border-gray-700 text-gray-400 hover:border-gray-500'
              }`}
            >
              <span className="text-base leading-none">{a.icon}</span>
              <span className="leading-tight font-medium">{a.label}</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
