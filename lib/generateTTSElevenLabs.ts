import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';
import type { WordTiming } from '@/types';
import {
  ELEVENLABS_PRESETS,
  ELEVENLABS_VOICE_ID,
  type ElevenLabsPreset,
} from './elevenLabsPresets';
import { getWordTimings } from './getWordTimings';

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

export async function generateTTSElevenLabs(
  text: string,
  ttsText: string,
  id: string,
  preset: ElevenLabsPreset = 'storyteller',
  customVoiceId = '',
): Promise<{ audioPath: string; duration: number; wordTimings: WordTiming[] | null }> {
  const apiKey = process.env.ELEVENLABS_API_KEY;
  if (!apiKey) throw new Error('ELEVENLABS_API_KEY is not set');

  const dir = path.join(process.cwd(), 'public', 'tmp', 'audio');
  fs.mkdirSync(dir, { recursive: true });

  const filename = `${id}.mp3`;
  const filepath = path.join(dir, filename);

  const presetDef = ELEVENLABS_PRESETS[preset];
  const voiceId =
    preset === 'custom' && customVoiceId.trim()
      ? customVoiceId.trim()
      : ELEVENLABS_VOICE_ID;

  const res = await fetch(
    `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`,
    {
      method: 'POST',
      headers: {
        'xi-api-key': apiKey,
        'Content-Type': 'application/json',
        Accept: 'audio/mpeg',
      },
      body: JSON.stringify({
        text: ttsText || text,
        model_id: 'eleven_multilingual_v2',
        voice_settings: {
          stability: presetDef.stability,
          similarity_boost: presetDef.similarity_boost,
          style: presetDef.style,
          use_speaker_boost: presetDef.use_speaker_boost,
        },
      }),
    },
  );

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`ElevenLabs API error ${res.status}: ${body.slice(0, 300)}`);
  }

  const buffer = Buffer.from(await res.arrayBuffer());
  fs.writeFileSync(filepath, buffer);

  const measured = probeAudioDuration(filepath);
  const fallback = Math.max(2.5, text.trim().split(/\s+/).length / 2.3);
  const duration = (measured ?? fallback) + 0.4;

  // Use original text for WhisperX alignment (words unchanged)
  const wordTimings = await getWordTimings(filepath, text);

  return { audioPath: `/tmp/audio/${filename}`, duration, wordTimings };
}
