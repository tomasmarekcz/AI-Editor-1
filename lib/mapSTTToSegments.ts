import type { SegmentData, WordTiming } from '@/types';

/** Strip everything except letters (supports Czech + basic Latin) */
function normalize(w: string): string {
  return w.toLowerCase().replace(/[^a-záčďéěíňóřšťúůýž]/gi, '');
}

/** Split text into normalized, non-empty tokens */
function tokenize(text: string): string[] {
  return text.trim().split(/\s+/).map(normalize).filter(Boolean);
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
): void {
  // ── Fallback when STT failed or returned nothing ──────────────────────────
  if (!sttWords.length) {
    let cursor = 0;
    for (const seg of segments) {
      const dur = seg.audioDuration ?? seg.duration;
      seg.startTime = cursor;
      seg.endTime   = cursor + dur;
      cursor        = seg.endTime;
      seg.wordTimings = undefined;
    }
    return;
  }

  let sttIdx = 0;

  for (let si = 0; si < segments.length; si++) {
    const seg      = segments[si];
    const segWords = tokenize(seg.text);
    const isLast   = si === segments.length - 1;

    // Absolute start of this segment = timestamp of first STT word we consume
    const segStart = sttWords[sttIdx]?.start ?? 0;
    const relativeTimings: WordTiming[] = [];
    let matched = 0;

    // Walk STT words, matching them against the segment's words in order
    while (matched < segWords.length && sttIdx < sttWords.length) {
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

    // Absolute end: timestamp of the last word we consumed
    const lastConsumedEnd = sttWords[Math.min(sttIdx - 1, sttWords.length - 1)]?.end
      ?? segStart + (seg.audioDuration ?? seg.duration);

    seg.startTime    = segStart;
    seg.endTime      = lastConsumedEnd;
    seg.audioDuration = lastConsumedEnd - segStart;
    seg.wordTimings  = relativeTimings.length > 0 ? relativeTimings : undefined;
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
