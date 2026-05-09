import type { SegmentData, WordTiming } from '@/types';

/** Strip everything except letters (supports Czech + basic Latin) */
function normalize(w: string): string {
  return w.toLowerCase().replace(/[^a-záčďéěíňóřšťúůýž]/gi, '');
}

/** Split text into normalized, non-empty tokens */
function tokenize(text: string): string[] {
  return text.trim().split(/\s+/).map(normalize).filter(Boolean);
}

function estimateDurations(segments: SegmentData[], totalDuration: number): number[] {
  const weights = segments.map((seg) => {
    const text = seg.audioText || seg.text;
    const words = tokenize(text).length;
    const ellipsisPauses = (text.match(/\.\.\./g) ?? []).length;
    const sentencePauses = (text.match(/[.!?]+/g) ?? []).length;
    const commaPauses = (text.match(/[,;:—-]/g) ?? []).length;
    const linePauses = (text.match(/\n+/g) ?? []).length;
    const emphasisWords = (text.match(/\b[A-ZÁČĎÉĚÍŇÓŘŠŤÚŮÝŽ]{2,}\b/g) ?? []).length;
    const pauseWeight =
      ellipsisPauses * 3.0 +
      sentencePauses * 1.2 +
      commaPauses * 0.45 +
      linePauses * 1.5 +
      emphasisWords * 0.35;

    return Math.max(1, words + pauseWeight || Number(seg.duration) || 1);
  });
  const totalWeight = weights.reduce((sum, weight) => sum + weight, 0) || 1;

  return weights.map((weight, index) => {
    const proportional = totalDuration * (weight / totalWeight);
    const fallback = Number(segments[index].duration) || proportional;
    return Math.max(0.5, Number.isFinite(proportional) ? proportional : fallback);
  });
}

function applyEstimatedTimings(
  segments: SegmentData[],
  totalDuration: number,
  clearWordTimings: boolean,
): void {
  const durations = estimateDurations(segments, totalDuration);
  let cursor = 0;

  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i];
    const isLast = i === segments.length - 1;
    const end = isLast ? totalDuration : Math.min(totalDuration, cursor + durations[i]);
    seg.startTime = cursor;
    seg.endTime = Math.max(cursor + 0.1, end);
    seg.audioDuration = seg.endTime - seg.startTime;
    if (clearWordTimings) seg.wordTimings = undefined;
    cursor = seg.endTime;
  }
}

/**
 * Maps global word-level STT timestamps to each segment.
 *
 * For each segment this sets:
 *   - startTime  : absolute seconds in the full audio where this segment begins
 *   - endTime    : absolute seconds where this segment ends
 *   - audioDuration: endTime - startTime  (keeps Remotion timing working)
 *   - wordTimings: per-word timestamps RELATIVE to startTime
 *                  (same format Segment.tsx already consumes — no change there)
 *
 * Matching algorithm: greedy sequential scan.
 * Handles punctuation, capitalisation differences, and minor STT variations.
 */
export function mapSTTToSegments(
  sttWords: WordTiming[],
  segments: SegmentData[],
  audioDurationSeconds?: number,
): void {
  const fallbackTotalDuration = audioDurationSeconds
    ?? segments.reduce((sum, seg) => sum + (Number(seg.duration) || 0), 0);

  // ── Fallback when STT failed or returned nothing ──────────────────────────
  if (!sttWords.length) {
    applyEstimatedTimings(segments, Math.max(fallbackTotalDuration, segments.length), true);
    return;
  }

  let sttIdx = 0;
  let totalMatched = 0;
  let totalExpected = 0;
  let usedFallback = false;
  const totalAudioDuration = sttWords[sttWords.length - 1]?.end
    ?? fallbackTotalDuration;

  for (let si = 0; si < segments.length; si++) {
    const seg      = segments[si];
    const segWords = tokenize(seg.audioText || seg.text);
    totalExpected += segWords.length;

    // Absolute start of this segment = timestamp of first STT word we consume
    const segStart = sttWords[sttIdx]?.start ?? 0;
    const relativeTimings: WordTiming[] = [];
    let matched = 0;
    const startIdx = sttIdx;
    const maxScan = Math.min(
      sttWords.length,
      startIdx + Math.max(segWords.length * 3, segWords.length + 12),
    );

    // Walk STT words, matching them against the segment's words in order
    while (matched < segWords.length && sttIdx < maxScan) {
      const sttNorm = normalize(sttWords[sttIdx].word);
      const segNorm = segWords[matched];

      // Accept: exact match, or one string contains the other (handles apostrophes,
      // compound words, minor transcription variants like "don't" → "dont")
      const isMatch =
        sttNorm === segNorm ||
        (sttNorm.length > 1 && segNorm.length > 1 &&
          (sttNorm.includes(segNorm) || segNorm.includes(sttNorm)));

      if (isMatch) {
        relativeTimings.push({
          word:  sttWords[sttIdx].word,
          start: sttWords[sttIdx].start - segStart,
          end:   sttWords[sttIdx].end   - segStart,
        });
        matched++;
      }
      // Always advance STT cursor (skip unmatched STT words — noise / filler)
      sttIdx++;
    }
    totalMatched += matched;

    const matchRatio = segWords.length > 0 ? matched / segWords.length : 1;
    if (segWords.length > 0 && matchRatio < 0.35) {
      usedFallback = true;
      break;
    }

    // Absolute end: timestamp of the last word we consumed
    const lastConsumedEnd = sttWords[Math.min(sttIdx - 1, sttWords.length - 1)]?.end
      ?? segStart + (seg.audioDuration ?? seg.duration);

    seg.startTime    = segStart;
    seg.endTime      = lastConsumedEnd;
    seg.audioDuration = lastConsumedEnd - segStart;
    seg.wordTimings  = matchRatio >= 0.6 && relativeTimings.length > 0 ? relativeTimings : undefined;
  }

  const overallMatchRatio = totalExpected > 0 ? totalMatched / totalExpected : 0;
  if (usedFallback || overallMatchRatio < 0.5) {
    console.warn('[mapSTTToSegments] Low STT alignment confidence; using estimated segment timings.', {
      matched: totalMatched,
      expected: totalExpected,
      ratio: overallMatchRatio,
    });
    applyEstimatedTimings(segments, totalAudioDuration, true);
    return;
  }

  // Any remaining STT words after the last segment → stretch last segment's endTime
  if (sttWords.length > 0 && segments.length > 0) {
    const last       = segments[segments.length - 1];
    const trueEnd    = sttWords[sttWords.length - 1].end;
    if (trueEnd > (last.endTime ?? 0)) {
      last.endTime      = trueEnd;
      last.audioDuration = trueEnd - (last.startTime ?? 0);
    }
  }
}
