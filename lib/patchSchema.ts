import type { VideoSettings, SegmentData } from '@/types';
import type { VideoEditPatch, CaptionPatch } from '@/types/editor';

// ── Validation allowlists ──────────────────────────────────────────────────

const SUBTITLE_ANIMATIONS = ['none', 'word-highlight', 'word-reveal', 'pop', 'fade-slide'] as const;
const VIDEO_EFFECTS = ['none', 'flash', 'zoom-burst', 'shake', 'glitch'] as const;
const SUBTITLE_FONTS = [
  'Bebas Neue', 'Impact', 'Montserrat', 'Anton', 'Poppins', 'Inter',
  'Archivo Black', 'League Spartan', 'Raleway', 'Oswald', 'Roboto Condensed',
  'TheBoldFont', 'Arial Black', 'Georgia', 'Verdana', 'Courier New',
] as const;
const HEX_RE = /^#[0-9a-fA-F]{6}$/;

function isHex(v: unknown): v is string {
  return typeof v === 'string' && HEX_RE.test(v);
}

// ── Caption patch validation ───────────────────────────────────────────────

function validateCaptionPatch(raw: unknown): CaptionPatch {
  if (!raw || typeof raw !== 'object') return {};
  const p = raw as Record<string, unknown>;
  const out: CaptionPatch = {};

  if (typeof p.fontSize === 'number') {
    out.fontSize = Math.max(0.5, Math.min(3.0, p.fontSize));
  }
  if (typeof p.positionY === 'number') {
    out.positionY = Math.max(0, Math.min(100, p.positionY));
  }
  if (typeof p.stylePreset === 'string' && (SUBTITLE_ANIMATIONS as readonly string[]).includes(p.stylePreset)) {
    out.stylePreset = p.stylePreset as CaptionPatch['stylePreset'];
  }
  if (isHex(p.highlightColor)) out.highlightColor = p.highlightColor;
  if (isHex(p.color))          out.color = p.color;
  if (isHex(p.captionStrokeColor)) out.captionStrokeColor = p.captionStrokeColor;
  if (typeof p.captionStrokeWidth === 'number') {
    out.captionStrokeWidth = Math.max(0, Math.min(12, p.captionStrokeWidth));
  }
  if (typeof p.font === 'string' && (SUBTITLE_FONTS as readonly string[]).includes(p.font)) {
    out.font = p.font as CaptionPatch['font'];
  }
  if (typeof p.allCaps === 'boolean')  out.allCaps = p.allCaps;
  if (typeof p.highlight === 'boolean') out.highlight = p.highlight;
  if (p.chunkSize === 1 || p.chunkSize === 2 || p.chunkSize === 3) out.chunkSize = p.chunkSize;

  return out;
}

// ── Full patch validation ──────────────────────────────────────────────────

export function validatePatch(raw: unknown): VideoEditPatch {
  if (!raw || typeof raw !== 'object') return {};
  const p = raw as Record<string, unknown>;
  const out: VideoEditPatch = {};

  if (p.captions) out.captions = validateCaptionPatch(p.captions);

  if (p.effects && typeof p.effects === 'object') {
    const ef = p.effects as Record<string, unknown>;
    out.effects = {};
    if (typeof ef.enableEffects === 'boolean') out.effects.enableEffects = ef.enableEffects;
    if (typeof ef.globalEffect === 'string' && (VIDEO_EFFECTS as readonly string[]).includes(ef.globalEffect)) {
      out.effects.globalEffect = ef.globalEffect as NonNullable<typeof out.effects>['globalEffect'];
    }
  }

  if (p.trim && typeof p.trim === 'object') {
    const tr = p.trim as Record<string, unknown>;
    out.trim = {};
    if (typeof tr.startSeconds === 'number') out.trim.startSeconds = Math.max(0, tr.startSeconds);
    if (typeof tr.endSeconds === 'number')   out.trim.endSeconds = Math.max(0, tr.endSeconds);
  }

  if (p.scenes && typeof p.scenes === 'object') {
    out.scenes = {};
    for (const [key, val] of Object.entries(p.scenes as Record<string, unknown>)) {
      const idx = Number(key);
      if (!Number.isInteger(idx) || idx < 0) continue;
      if (!val || typeof val !== 'object') continue;
      const sc = val as Record<string, unknown>;
      const scenePatch: NonNullable<typeof out.scenes>[number] = {};
      if (typeof sc.remove === 'boolean') scenePatch.remove = sc.remove;
      if (typeof sc.effect === 'string' && (VIDEO_EFFECTS as readonly string[]).includes(sc.effect)) {
        scenePatch.effect = sc.effect as NonNullable<typeof scenePatch>['effect'];
      }
      if ([0, 1, 2, 3, 4].includes(sc.kbPreset as number)) {
        scenePatch.kbPreset = sc.kbPreset as 0 | 1 | 2 | 3 | 4;
      }
      if (typeof sc.transition === 'string' && ['fade', 'cut', 'dissolve'].includes(sc.transition)) {
        scenePatch.transition = sc.transition as 'fade' | 'cut' | 'dissolve';
      }
      if (typeof sc.newImagePrompt === 'string' && sc.newImagePrompt.length <= 500) {
        scenePatch.newImagePrompt = sc.newImagePrompt;
      }
      out.scenes[idx] = scenePatch;
    }
  }

  if (typeof p.visualMood === 'string') {
    out.visualMood = p.visualMood.slice(0, 200);
  }

  return out;
}

// ── Apply patch to settings ────────────────────────────────────────────────

export function applyPatchToSettings(
  base: Partial<VideoSettings>,
  patch: VideoEditPatch,
): Partial<VideoSettings> {
  const settings = structuredClone(base) as Partial<VideoSettings>;

  if (patch.captions) {
    const c = patch.captions;
    const sub = { ...(settings.subtitle ?? {}) } as NonNullable<VideoSettings['subtitle']>;
    if (c.fontSize     != null) sub.sizeScale      = c.fontSize;
    if (c.positionY    != null) sub.positionY      = c.positionY;
    if (c.stylePreset  != null) sub.animation      = c.stylePreset;
    if (c.highlightColor != null) sub.highlightColor = c.highlightColor;
    if (c.color        != null) sub.color          = c.color;
    if (c.captionStrokeColor != null) sub.captionStrokeColor = c.captionStrokeColor;
    if (c.captionStrokeWidth != null) sub.captionStrokeWidth = c.captionStrokeWidth;
    if (c.font         != null) sub.font           = c.font;
    if (c.allCaps      != null) sub.allCaps        = c.allCaps;
    if (c.highlight    != null) sub.highlight      = c.highlight;
    if (c.chunkSize    != null) sub.chunkSize      = c.chunkSize;
    settings.subtitle = sub;
  }

  if (patch.effects?.enableEffects != null) {
    settings.enableEffects = patch.effects.enableEffects;
  }

  return settings;
}

// ── Apply patch to segments ────────────────────────────────────────────────

export function applyPatchToSegments(
  base: SegmentData[],
  patch: VideoEditPatch,
): SegmentData[] {
  let segments = structuredClone(base) as SegmentData[];

  if (patch.effects?.globalEffect) {
    segments = segments.map((seg) => ({ ...seg, effect: patch.effects!.globalEffect }));
  }

  if (patch.scenes) {
    for (const [idxStr, sc] of Object.entries(patch.scenes)) {
      const idx = Number(idxStr);
      if (idx < 0 || idx >= segments.length) continue;
      if (sc.remove) {
        (segments[idx] as SegmentData & { _removed?: boolean })._removed = true;
      }
      if (sc.effect != null) segments[idx].effect = sc.effect;
      if (sc.kbPreset != null) segments[idx].kbPreset = sc.kbPreset;
      if (sc.transition != null) segments[idx].transition = sc.transition;
      if (sc.newImagePrompt != null) {
        segments[idx].imagePrompt = sc.newImagePrompt;
        // Flag for re-render to regenerate this image
        (segments[idx] as SegmentData & { _regenerateImage?: boolean })._regenerateImage = true;
      }
    }
  }

  // Apply trim (scene-level rough trim)
  if (patch.trim) {
    const { startSeconds, endSeconds } = patch.trim;
    segments = segments.filter((seg) => {
      const end   = seg.endTime ?? (seg.startTime ?? 0) + (seg.duration ?? 1);
      const start = seg.startTime ?? 0;
      if (startSeconds != null && end <= startSeconds) return false;
      if (endSeconds   != null && start >= endSeconds)  return false;
      return true;
    });
  }

  return segments;
}

// ── List applied fields ────────────────────────────────────────────────────

export function listAppliedFields(patch: VideoEditPatch): string[] {
  const fields: string[] = [];
  if (patch.captions) {
    for (const k of Object.keys(patch.captions)) fields.push(`captions.${k}`);
  }
  if (patch.effects) {
    for (const k of Object.keys(patch.effects)) fields.push(`effects.${k}`);
  }
  if (patch.trim) {
    for (const k of Object.keys(patch.trim)) fields.push(`trim.${k}`);
  }
  if (patch.scenes) {
    for (const [i, sc] of Object.entries(patch.scenes)) {
      for (const k of Object.keys(sc)) fields.push(`scenes[${i}].${k}`);
    }
  }
  if (patch.visualMood) fields.push('visualMood');
  return fields;
}
