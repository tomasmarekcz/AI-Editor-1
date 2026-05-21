import OpenAI from 'openai';
import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';
import type { VideoSettings } from '@/types';
import { generateGeminiContent } from '@/lib/geminiApi';
import { GEMINI_TTS_MODEL } from '@/lib/models';
import { VOICE_PRESETS } from './voicePresets';
import { GEMINI_TTS_PRESETS } from './geminiTtsPresets';
import { ELEVENLABS_PRESETS, ELEVENLABS_VOICE_ID } from './elevenLabsPresets';

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

function clampSpeed(speed: number | undefined) {
  return Math.max(0.65, Math.min(1.4, Number.isFinite(speed) ? speed as number : 1));
}

function geminiPaceInstruction(speed: number) {
  if (speed <= 0.8) {
    return 'Speak clearly at a slow, deliberate pace. Prioritize comprehension over energy. Add natural pauses between sentences.';
  }
  if (speed < 0.95) {
    return 'Speak clearly at a slightly slower than normal pace. Keep the energy, but leave enough space between words so every word is easy to understand.';
  }
  if (speed <= 1.05) {
    return 'Speak at a natural, clear narrator pace. Do not rush the words.';
  }
  return 'Speak with controlled energy at a moderately fast pace, but keep every word understandable.';
}

function applyAudioSpeed(inputPath: string, speed: number) {
  const normalizedSpeed = clampSpeed(speed);
  if (Math.abs(normalizedSpeed - 1) < 0.01) return;

  const parsed = path.parse(inputPath);
  const tmpPath = path.join(parsed.dir, `${parsed.name}_speed${parsed.ext}`);
  execSync(
    `ffmpeg -y -i "${inputPath}" -filter:a "atempo=${normalizedSpeed.toFixed(2)}" "${tmpPath}"`,
    { timeout: 60_000 },
  );
  fs.renameSync(tmpPath, inputPath);
}

/**
 * Generates a single voiceover MP3 for the entire script.
 * Segments are joined with a double newline (natural pause in TTS).
 *
 * @param texts  Enhanced text for each segment, in order.
 * @param jobId  Unique ID used as filename basis.
 * @param settings  Video settings (TTS provider + voice config).
 * @returns  Relative web path, absolute disk path, and total duration in seconds.
 */
export async function generateVoiceoverFull(
  texts: string[],
  jobId: string,
  settings: VideoSettings,
): Promise<{ audioRelPath: string; audioAbsPath: string; duration: number }> {
  const dir = path.join(process.cwd(), 'public', 'tmp', 'audio');
  fs.mkdirSync(dir, { recursive: true });

  const filename = `voiceover_${jobId}.mp3`;
  const absPath = path.join(dir, filename);
  const relPath = `/tmp/audio/${filename}`;

  // Join with double newline → natural pause between segments in TTS
  const fullText = texts.join('\n\n');

  if (settings.ttsProvider === 'gemini') {
    await generateGeminiVoiceover(fullText, absPath, settings);
  } else if (settings.ttsProvider === 'elevenlabs') {
    await generateElevenLabsVoiceover(fullText, absPath, settings);
  } else {
    await generateOpenAIVoiceover(fullText, absPath, settings);
  }

  const measured = probeAudioDuration(absPath);
  const fallback = Math.max(5, fullText.split(/\s+/).length / 2.5);
  const duration = measured ?? fallback;

  return { audioRelPath: relPath, audioAbsPath: absPath, duration };
}

// ── ElevenLabs TTS ─────────────────────────────────────────────────────────
async function generateElevenLabsVoiceover(
  text: string,
  outputPath: string,
  settings: VideoSettings,
): Promise<void> {
  const apiKey = process.env.ELEVENLABS_API_KEY;
  if (!apiKey) throw new Error('ELEVENLABS_API_KEY is not set');

  const presetDef = ELEVENLABS_PRESETS[settings.elevenLabsPreset];
  const voiceId =
    settings.elevenLabsPreset === 'custom' && settings.elevenLabsCustomVoiceId.trim()
      ? settings.elevenLabsCustomVoiceId.trim()
      : ELEVENLABS_VOICE_ID;

  const res = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`, {
    method: 'POST',
    headers: {
      'xi-api-key': apiKey,
      'Content-Type': 'application/json',
      Accept: 'audio/mpeg',
    },
    body: JSON.stringify({
      text,
      model_id: 'eleven_multilingual_v2',
      voice_settings: {
        stability: presetDef.stability,
        similarity_boost: presetDef.similarity_boost,
        style: presetDef.style,
        use_speaker_boost: presetDef.use_speaker_boost,
      },
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`ElevenLabs API error ${res.status}: ${body.slice(0, 300)}`);
  }

  fs.writeFileSync(outputPath, Buffer.from(await res.arrayBuffer()));
}

// ── OpenAI TTS ──────────────────────────────────────────────────────────────
async function generateOpenAIVoiceover(
  text: string,
  outputPath: string,
  settings: VideoSettings,
): Promise<void> {
  const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

  const instructions =
    settings.voicePreset === 'custom'
      ? settings.customInstructions.trim()
      : VOICE_PRESETS[settings.voicePreset].instructions;

  const useInstructions = instructions.length > 0;

  const params: Record<string, unknown> = {
    model: settings.hdQuality ? 'tts-1-hd' : useInstructions ? 'gpt-4o-mini-tts' : 'tts-1',
    voice: settings.voice,
    input: text,
    speed: Math.max(0.25, Math.min(4.0, settings.speed)),
  };
  if (useInstructions && !settings.hdQuality) params.instructions = instructions;

  const mp3 = await openai.audio.speech.create(
    params as unknown as Parameters<typeof openai.audio.speech.create>[0],
  );
  const buffer = Buffer.from(await mp3.arrayBuffer());
  fs.writeFileSync(outputPath, buffer);
}

// ── Gemini TTS ──────────────────────────────────────────────────────────────
async function generateGeminiVoiceover(
  text: string,
  outputPath: string,
  settings: VideoSettings,
): Promise<void> {
  const dir = path.dirname(outputPath);
  const base = path.basename(outputPath, '.mp3');
  const pcmPath = path.join(dir, `${base}.pcm`);

  const stylePrompt =
    settings.geminiPreset === 'custom'
      ? settings.geminiCustomPrompt.trim()
      : GEMINI_TTS_PRESETS[settings.geminiPreset].prompt;
  const speed = clampSpeed(settings.speed);
  const paceInstruction = geminiPaceInstruction(speed);
  const inputText = stylePrompt
    ? `${stylePrompt}\n\nPacing instruction:\n${paceInstruction}\n\nText to synthesize:\n${text}`
    : `${paceInstruction}\n\nText to synthesize:\n${text}`;

  const body: Record<string, unknown> = {
    contents: [{ role: 'user', parts: [{ text: inputText }] }],
    generationConfig: {
      responseModalities: ['AUDIO'],
      speechConfig: {
        voiceConfig: {
          prebuiltVoiceConfig: { voiceName: settings.geminiVoice },
        },
      },
    },
  };

  const data = await generateGeminiContent<{
    candidates?: Array<{
      content?: { parts?: Array<{ inlineData?: { data?: string } }> };
    }>;
  }>(GEMINI_TTS_MODEL, body);

  const b64 = data.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
  if (!b64) throw new Error('Gemini TTS returned no audio data');

  fs.writeFileSync(pcmPath, Buffer.from(b64, 'base64'));
  execSync(`ffmpeg -y -f s16le -ar 24000 -ac 1 -i "${pcmPath}" "${outputPath}"`, { timeout: 60_000 });
  try { fs.unlinkSync(pcmPath); } catch { /* ignore */ }
  applyAudioSpeed(outputPath, speed);
}
