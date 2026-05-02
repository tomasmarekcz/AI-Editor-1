import OpenAI from 'openai';
import fs from 'fs';
import type { WordTiming } from '@/types';

/**
 * Transcribes an audio file using OpenAI Whisper with word-level timestamps.
 * Returns a flat array of {word, start, end} covering the full audio.
 */
export async function transcribeAudio(audioAbsPath: string): Promise<WordTiming[]> {
  const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

  const fileStream = fs.createReadStream(audioAbsPath);

  // Call via the raw HTTP client to sidestep SDK overload typing issues.
  // verbose_json + timestamp_granularities=['word'] returns word-level timestamps.
  const result = await openai.audio.transcriptions.create({
    file: fileStream as unknown as File,
    model: 'whisper-1',
    response_format: 'verbose_json',
    timestamp_granularities: ['word'],
  });

  // The SDK types TranscriptionVerbose but doesn't always expose `.words` directly.
  // We access it safely via an index cast.
  const words = (result as unknown as { words?: { word: string; start: number; end: number }[] }).words;

  if (!words || words.length === 0) {
    console.warn('[transcribeAudio] Whisper returned no word timestamps — subtitles will be estimated');
    return [];
  }

  return words.map((w) => ({
    word: w.word.trim(),
    start: w.start,
    end: w.end,
  }));
}
