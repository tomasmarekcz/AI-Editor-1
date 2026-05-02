import fs from 'fs';
import type { WordTiming } from '@/types';

const SERVER = process.env.ALIGNMENT_SERVER_URL ?? 'http://localhost:8001';

/**
 * Get precise word-level timestamps via WhisperX forced alignment.
 * Gracefully returns null if the Python server is unavailable —
 * callers should fall back to even distribution in that case.
 */
export async function getWordTimings(
  audioFilePath: string, // absolute path to MP3
  text: string,
  language = 'cs',
): Promise<WordTiming[] | null> {
  // Quick health check (2 s timeout) before sending the file
  try {
    const health = await fetch(`${SERVER}/health`, {
      signal: AbortSignal.timeout(2000),
    });
    if (!health.ok) {
      console.warn('[alignment] server unhealthy, skipping');
      return null;
    }
  } catch {
    console.warn('[alignment] server not reachable — using even-split fallback');
    return null;
  }

  try {
    const audioBuffer = fs.readFileSync(audioFilePath);
    const blob = new Blob([audioBuffer], { type: 'audio/mpeg' });

    const fd = new FormData();
    fd.append('file', blob, 'audio.mp3');
    fd.append('text', text);
    fd.append('language', language);

    const res = await fetch(`${SERVER}/align`, {
      method: 'POST',
      body: fd,
      signal: AbortSignal.timeout(40_000),
    });

    if (!res.ok) {
      console.warn(`[alignment] server returned ${res.status}`);
      return null;
    }

    const data = (await res.json()) as { words?: WordTiming[] };
    const words = data.words ?? [];

    if (words.length === 0) {
      console.warn('[alignment] no words returned');
      return null;
    }

    return words;
  } catch (err) {
    console.warn('[alignment] request failed:', err);
    return null;
  }
}
