import OpenAI from 'openai';
import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';
import type { TTSVoice, WordTiming } from '@/types';
import { VOICE_PRESETS, type VoicePreset } from './voicePresets';
import { getWordTimings } from './getWordTimings';

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

/** Returns real audio duration in seconds via ffprobe. */
function probeAudioDuration(filepath: string): number | null {
  try {
    const out = execSync(
      `ffprobe -v quiet -print_format json -show_format "${filepath}"`,
      { encoding: 'utf8', timeout: 10_000 },
    );
    const json = JSON.parse(out) as { format?: { duration?: string } };
    const d = parseFloat(json.format?.duration ?? '');
    return isNaN(d) ? null : d;
  } catch {
    return null;
  }
}

export async function generateTTS(
  text: string,
  id: string,
  voice: TTSVoice = 'onyx',
  preset: VoicePreset = 'hype',
  customInstructions = '',
  speed = 1.1,
  hdQuality = false,
  ttsText = '',
): Promise<{ audioPath: string; duration: number; wordTimings: WordTiming[] | null }> {
  const dir = path.join(process.cwd(), 'public', 'tmp', 'audio');
  fs.mkdirSync(dir, { recursive: true });

  const filename = `${id}.mp3`;
  const filepath = path.join(dir, filename);

  const instructions =
    preset === 'custom'
      ? customInstructions.trim()
      : VOICE_PRESETS[preset].instructions;

  const useInstructions = instructions.length > 0;

  const params: Record<string, unknown> = {
    model: useInstructions ? 'gpt-4o-mini-tts' : hdQuality ? 'tts-1-hd' : 'tts-1',
    voice,
    input: ttsText || text,
    speed: Math.max(0.25, Math.min(4.0, speed)),
  };
  if (useInstructions) params.instructions = instructions;

  const mp3 = await openai.audio.speech.create(
    params as unknown as Parameters<typeof openai.audio.speech.create>[0],
  );

  const buffer = Buffer.from(await mp3.arrayBuffer());
  fs.writeFileSync(filepath, buffer);

  // Real duration + 0.4 s tail buffer so audio never clips
  const measured = probeAudioDuration(filepath);
  const fallback = Math.max(2.5, text.trim().split(/\s+/).length / 2.3);
  const duration = (measured ?? fallback) + 0.4;

  // WhisperX forced alignment via Python server
  const wordTimings = await getWordTimings(filepath, text);

  return { audioPath: `/tmp/audio/${filename}`, duration, wordTimings };
}
