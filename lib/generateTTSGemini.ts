import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';
import type { WordTiming } from '@/types';
import {
  GEMINI_TTS_PRESETS,
  type GeminiTTSVoice,
  type GeminiTTSPreset,
} from './geminiTtsPresets';
import { getWordTimings } from './getWordTimings';

const GEMINI_TTS_MODEL = 'gemini-2.5-flash-preview-tts';

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

/** Convert raw PCM (s16le 24kHz mono) to MP3 via ffmpeg */
function pcmToMp3(pcmPath: string, mp3Path: string): void {
  execSync(
    `ffmpeg -y -f s16le -ar 24000 -ac 1 -i "${pcmPath}" "${mp3Path}"`,
    { timeout: 30_000 },
  );
}

export async function generateTTSGemini(
  text: string,
  ttsText: string,
  id: string,
  voice: GeminiTTSVoice = 'Fenrir',
  preset: GeminiTTSPreset = 'hype',
  customPrompt = '',
): Promise<{ audioPath: string; duration: number; wordTimings: WordTiming[] | null }> {
  const apiKey = process.env.GOOGLE_AI_API_KEY;
  if (!apiKey) throw new Error('GOOGLE_AI_API_KEY is not set');

  const dir = path.join(process.cwd(), 'public', 'tmp', 'audio');
  fs.mkdirSync(dir, { recursive: true });

  const pcmPath = path.join(dir, `${id}.pcm`);
  const mp3Path = path.join(dir, `${id}.mp3`);

  const stylePrompt =
    preset === 'custom'
      ? customPrompt.trim()
      : GEMINI_TTS_PRESETS[preset].prompt;

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_TTS_MODEL}:generateContent?key=${apiKey}`;

  const body: Record<string, unknown> = {
    contents: [{ role: 'user', parts: [{ text: ttsText || text }] }],
    generationConfig: {
      responseModalities: ['AUDIO'],
      speechConfig: {
        voiceConfig: {
          prebuiltVoiceConfig: { voiceName: voice },
        },
      },
    },
  };

  if (stylePrompt) {
    body.systemInstruction = { parts: [{ text: stylePrompt }] };
  }

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Gemini TTS error ${res.status}: ${err.slice(0, 300)}`);
  }

  const data = await res.json() as {
    candidates?: Array<{
      content?: {
        parts?: Array<{
          inlineData?: { mimeType?: string; data?: string };
        }>;
      };
    }>;
  };

  const inlineData = data.candidates?.[0]?.content?.parts?.[0]?.inlineData;
  if (!inlineData?.data) {
    throw new Error('Gemini TTS returned no audio data');
  }

  // Write raw PCM, convert to MP3, clean up
  const pcmBuffer = Buffer.from(inlineData.data, 'base64');
  fs.writeFileSync(pcmPath, pcmBuffer);
  pcmToMp3(pcmPath, mp3Path);
  try { fs.unlinkSync(pcmPath); } catch { /* ignore */ }

  const measured = probeAudioDuration(mp3Path);
  const fallback = Math.max(2.5, text.trim().split(/\s+/).length / 2.3);
  const duration = (measured ?? fallback) + 0.4;

  // WhisperX alignment uses original text (words unchanged)
  const wordTimings = await getWordTimings(mp3Path, text);

  return { audioPath: `/tmp/audio/${id}.mp3`, duration, wordTimings };
}
