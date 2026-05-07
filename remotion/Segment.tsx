import React from 'react';
import {
  AbsoluteFill, Audio, Img, Video,
  interpolate, useCurrentFrame, useVideoConfig,
} from 'remotion';
import type { SegmentData, SubtitleFont, SubtitleSettings, WordTiming, VideoEffect } from '@/types';

// ── Ken Burns presets ─────────────────────────────────────────────────────
const KB = [
  { sf: 1.00, st: 1.12, xf: 0,  xt: 0,  yf: 0,  yt: 0  },
  { sf: 1.12, st: 1.00, xf: 0,  xt: 0,  yf: 0,  yt: 0  },
  { sf: 1.05, st: 1.14, xf: -2, xt: 2,  yf: 0,  yt: 0  },
  { sf: 1.05, st: 1.14, xf: 2,  xt: -2, yf: 0,  yt: 0  },
  { sf: 1.00, st: 1.10, xf: 0,  xt: 0,  yf: 2,  yt: -2 },
] as const;

function fontFamily(font: SubtitleFont): string {
  switch (font) {
    case 'Bebas Neue':       return '"Bebas Neue", Impact, sans-serif';
    case 'Impact':           return 'Impact, Haettenschweiler, sans-serif';
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
    case 'Arial Black':      return '"Arial Black", "Arial Bold", Gadget, sans-serif';
    case 'Georgia':          return 'Georgia, "Times New Roman", serif';
    case 'Verdana':          return 'Verdana, Geneva, Tahoma, sans-serif';
    case 'Courier New':      return '"Courier New", Courier, monospace';
  }
}

function normalize(w: string) {
  return w.toLowerCase().replace(/[^a-záčďéěíňóřšťúůýž]/g, '');
}

function isVideoSrc(src?: string) {
  return !!src && /\.(mp4|mov|webm|avi)/i.test(src);
}

// ── Build subtitle chunks ─────────────────────────────────────────────────
function buildChunks(segment: SegmentData, fallbackSize: number): string[][] {
  const safeFallbackSize = Math.max(1, Math.floor(fallbackSize || 1));

  if (segment.subtitleChunks && segment.subtitleChunks.length > 0) {
    const chunks = segment.subtitleChunks
      .map((c) => c.split(/\s+/).filter(Boolean))
      .filter((chunk) => chunk.length > 0);

    if (chunks.length > 0) return chunks;
  }

  const words = segment.text.split(/\s+/).filter(Boolean);
  if (words.length === 0) return [['']];

  return Array.from(
    { length: Math.ceil(words.length / safeFallbackSize) },
    (_, i) => words.slice(i * safeFallbackSize, (i + 1) * safeFallbackSize),
  );
}

// ── Word timing → chunk index + active word ───────────────────────────────
interface WordMap { chunkIdx: number; wordInChunk: number }

function buildWordMap(chunks: string[][]): WordMap[] {
  return chunks.flatMap((chunk, ci) => chunk.map((_, wi) => ({ chunkIdx: ci, wordInChunk: wi })));
}

function findActiveWordIdx(timings: WordTiming[], currentSec: number): number {
  let last = 0;
  for (let i = 0; i < timings.length; i++) {
    if (currentSec >= timings[i].start) last = i;
    else break;
  }
  return last;
}

// ── Effect helpers ────────────────────────────────────────────────────────

/** Deterministic pseudo-random from seed */
function prng(seed: number): number {
  const x = Math.sin(seed) * 10000;
  return x - Math.floor(x);
}

/** Flash overlay opacity (0→1→0 in first 10 frames) */
function flashOpacity(frame: number): number {
  return interpolate(frame, [0, 5, 10], [1, 0.6, 0], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });
}

/** Shake offset (damped sine for first 18 frames) */
function shakeOffset(frame: number): { x: number; y: number } {
  if (frame >= 20) return { x: 0, y: 0 };
  const decay = 1 - frame / 20;
  return {
    x: Math.sin(frame * 2.9) * 14 * decay,
    y: Math.cos(frame * 3.7) * 9 * decay,
  };
}

/** Zoom-burst scale: starts at 1.35 and snaps to normal KB scale by frame 12 */
function zoomBurstScale(frame: number, kbScale: number): number {
  if (frame >= 12) return kbScale;
  return interpolate(frame, [0, 12], [1.35, kbScale], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });
}

/** Glitch: random horizontal offset on specific frames, first 14 frames */
function glitchOffset(frame: number): number {
  if (frame >= 14) return 0;
  const active = prng(frame * 137) > 0.55; // ~45% of frames
  return active ? (prng(frame * 31) - 0.5) * 28 : 0;
}

function segmentOpacity(
  frame: number,
  durationInFrames: number,
  fps: number,
  transition: 'fade' | 'cut' | 'dissolve' = 'fade',
): number {
  if (transition === 'cut') return 1;
  if (durationInFrames <= 1) return 1;

  const transitionFrames = Math.max(1, Math.round(fps * 0.15));
  const fadeFrames = Math.max(
    1,
    Math.min(transitionFrames, Math.floor((durationInFrames - 1) / 2)),
  );

  if (durationInFrames <= fadeFrames * 2) {
    return interpolate(frame, [0, durationInFrames / 2, durationInFrames], [0, 1, 0], {
      extrapolateLeft: 'clamp',
      extrapolateRight: 'clamp',
    });
  }

  return interpolate(
    frame,
    [0, fadeFrames, durationInFrames - fadeFrames, durationInFrames],
    [0, 1, 1, 0],
    { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' },
  );
}

// ── Component ─────────────────────────────────────────────────────────────
interface Props {
  segment: SegmentData;
  durationInFrames: number;
  index: number;
  subtitle: SubtitleSettings;
}

export const Segment: React.FC<Props> = ({ segment, durationInFrames, index, subtitle }) => {
  const frame = useCurrentFrame();
  const { fps, width, height } = useVideoConfig();
  const isVertical = height > width;
  const effect: VideoEffect = segment.effect ?? 'none';

  // ── Base Ken Burns ────────────────────────────────────────────────────
  const p = KB[(segment.kbPreset ?? index) % KB.length];
  let kbScale = interpolate(frame, [0, durationInFrames], [p.sf, p.st]);
  const tx = interpolate(frame, [0, durationInFrames], [p.xf, p.xt]);
  const ty = interpolate(frame, [0, durationInFrames], [p.yf, p.yt]);

  // ── Apply zoom-burst override ─────────────────────────────────────────
  if (effect === 'zoom-burst') {
    kbScale = zoomBurstScale(frame, kbScale);
  }

  // ── Apply shake ───────────────────────────────────────────────────────
  const shake = effect === 'shake' ? shakeOffset(frame) : { x: 0, y: 0 };

  // ── Apply glitch ──────────────────────────────────────────────────────
  const glitchX = effect === 'glitch' ? glitchOffset(frame) : 0;

  // ── Segment fade ──────────────────────────────────────────────────────
  const segOpacity = segmentOpacity(frame, durationInFrames, fps, segment.transition ?? 'fade');

  // ── Subtitle ──────────────────────────────────────────────────────────
  const {
    font,
    allCaps,
    highlight,
    chunkSize,
    color,
    highlightColor,
    captionStrokeColor = '#000000',
    captionStrokeWidth = 0,
    sizeScale,
    positionY,
    animation,
  } = subtitle;
  const strokeStyle = captionStrokeWidth > 0
    ? { WebkitTextStroke: `${captionStrokeWidth}px ${captionStrokeColor}` }
    : {};
  const baseFontSize  = (isVertical ? 82 : 62) * sizeScale;
  const importantSet  = new Set((segment.importantWords ?? []).map(normalize));
  const isKey = (w: string) => highlight && importantSet.has(normalize(w));
  const disp  = (w: string) => allCaps ? w.toUpperCase() : w;

  const chunks   = buildChunks(segment, chunkSize);
  const wordMap  = buildWordMap(chunks);
  const timings  = segment.wordTimings;
  const hasTiming = timings && timings.length > 0;

  let chunkIdx      = 0;
  let activeWordIdx = 0;
  let frameInChunk  = frame;
  let framesPerChunk = Math.max(1, Math.floor(durationInFrames / chunks.length));

  if (hasTiming) {
    const currentSec = frame / fps;
    const flatIdx    = findActiveWordIdx(timings!, currentSec);
    const mapped     = wordMap[Math.min(flatIdx, wordMap.length - 1)];
    chunkIdx      = mapped.chunkIdx;
    activeWordIdx = mapped.wordInChunk;

    const firstInChunk = wordMap.findIndex((m) => m.chunkIdx === chunkIdx);
    const lastInChunk  = [...wordMap].reverse().findIndex((m) => m.chunkIdx === chunkIdx);
    const lastIdx      = wordMap.length - 1 - lastInChunk;

    const chunkStart = timings![firstInChunk]?.start ?? 0;
    const chunkEnd   = timings![lastIdx]?.end ?? (durationInFrames / fps);
    frameInChunk     = Math.max(0, (currentSec - chunkStart) * fps);
    framesPerChunk   = Math.max(1, (chunkEnd - chunkStart) * fps);
  } else {
    const fpChunk = Math.max(1, Math.floor(durationInFrames / chunks.length));
    chunkIdx      = Math.min(Math.floor(frame / fpChunk), chunks.length - 1);
    frameInChunk  = frame % fpChunk;
    framesPerChunk = fpChunk;
    const n = chunks[chunkIdx]?.length ?? 1;
    activeWordIdx = Math.min(Math.floor(frameInChunk / (framesPerChunk / n)), n - 1);
  }

  const chunkWords = chunks[chunkIdx] ?? [];

  // ── Shared text style ─────────────────────────────────────────────────
  const textStyle: React.CSSProperties = {
    fontFamily: fontFamily(font),
    fontSize: baseFontSize,
    fontWeight: 900,
    lineHeight: 1.15,
    letterSpacing: '-0.01em',
    textShadow:
      '0 0 30px rgba(0,0,0,0.9), 0 2px 6px rgba(0,0,0,0.9), ' +
      '2px 2px 0 rgba(0,0,0,0.6), -2px -2px 0 rgba(0,0,0,0.6)',
    ...strokeStyle,
  };

  const wordSpans = (words: string[], activeIdx = -1) =>
    words.map((word, i) => {
      const active = i === activeIdx;
      return (
        <span key={i} style={{
          color: active ? highlightColor : isKey(word) ? highlightColor : color,
          opacity: animation === 'word-highlight' && activeIdx >= 0 && !active ? 0.4 : 1,
          fontWeight: active ? 900 : 700,
        }}>
          {disp(word)}{i < words.length - 1 ? ' ' : ''}
        </span>
      );
    });

  // ── Animation ─────────────────────────────────────────────────────────
  let subtitleNode: React.ReactNode;

  switch (animation) {
    case 'word-highlight':
      subtitleNode = <span style={textStyle}>{wordSpans(chunkWords, activeWordIdx)}</span>;
      break;

    case 'word-reveal': {
      const visible = Math.min(activeWordIdx + 1, chunkWords.length);
      subtitleNode = (
        <span style={textStyle}>
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
      const t = Math.min(frameInChunk / 11, 1);
      const s = t < 0.3 ? 0.65 + (t / 0.3) * 0.47
               : t < 0.6 ? 1.12 - ((t - 0.3) / 0.3) * 0.18
               : 1.0;
      subtitleNode = (
        <span style={{ ...textStyle, display: 'inline-block', transform: `scale(${s})` }}>
          {wordSpans(chunkWords)}
        </span>
      );
      break;
    }

    case 'fade-slide': {
      const t = Math.min(frameInChunk / 10, 1);
      subtitleNode = (
        <span style={{ ...textStyle, display: 'inline-block', transform: `translateY(${(1 - t) * 24}px)`, opacity: t }}>
          {wordSpans(chunkWords)}
        </span>
      );
      break;
    }

    default:
      subtitleNode = <span style={textStyle}>{wordSpans(chunkWords)}</span>;
  }

  // ── Render ────────────────────────────────────────────────────────────
  const bgTransform = [
    `scale(${kbScale})`,
    `translate(${tx + shake.x / 100}%, ${ty + shake.y / 100}%)`,
    glitchX !== 0 ? `translateX(${glitchX}px)` : '',
  ].filter(Boolean).join(' ');

  return (
    <AbsoluteFill style={{ opacity: segOpacity }}>
      {/* Background */}
      <AbsoluteFill style={{ overflow: 'hidden' }}>
        {segment.imageUrl ? (
          <div style={{ position: 'absolute', inset: 0, transform: bgTransform, transformOrigin: 'center center' }}>
            {isVideoSrc(segment.imageUrl)
              ? <Video src={segment.imageUrl} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
              : <Img   src={segment.imageUrl} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
            }
          </div>
        ) : (
          <div style={{ position: 'absolute', inset: 0, background: 'linear-gradient(135deg, #1a1a2e, #16213e, #0f3460)' }} />
        )}
      </AbsoluteFill>

      {/* Glitch: second offset layer (colour fringe) */}
      {effect === 'glitch' && glitchX !== 0 && segment.imageUrl && (
        <AbsoluteFill style={{ overflow: 'hidden', opacity: 0.35, mixBlendMode: 'screen' }}>
          <div style={{
            position: 'absolute', inset: 0,
            transform: `scale(${kbScale}) translate(${tx}%, ${ty}%) translateX(${-glitchX * 0.6}px)`,
            transformOrigin: 'center center',
            filter: 'hue-rotate(120deg)',
          }}>
            <Img src={segment.imageUrl} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
          </div>
        </AbsoluteFill>
      )}

      {/* Vignette */}
      <AbsoluteFill style={{
        background:
          'radial-gradient(ellipse at center, transparent 50%, rgba(0,0,0,0.3) 100%), ' +
          'linear-gradient(to bottom, rgba(0,0,0,0.1) 0%, transparent 25%, transparent 55%, rgba(0,0,0,0.7) 100%)',
      }} />

      {/* Flash overlay */}
      {effect === 'flash' && (
        <AbsoluteFill style={{ backgroundColor: 'white', opacity: flashOpacity(frame), pointerEvents: 'none' }} />
      )}

      {/* Subtitle */}
      <div style={{ position: 'absolute', bottom: `${positionY}%`, left: 0, right: 0, textAlign: 'center', padding: '0 5%' }}>
        {subtitleNode}
      </div>

      {segment.audioPath && <Audio src={segment.audioPath} />}
    </AbsoluteFill>
  );
};
