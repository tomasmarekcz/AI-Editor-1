import type { VoicePreset } from '@/lib/voicePresets';
import type { ElevenLabsPreset } from '@/lib/elevenLabsPresets';
import type { GeminiTTSPreset, GeminiTTSVoice } from '@/lib/geminiTtsPresets';
export type { VoicePreset, ElevenLabsPreset, GeminiTTSPreset, GeminiTTSVoice };

export type TTSVoice = 'echo' | 'fable' | 'onyx';
export type TTSProvider = 'openai' | 'gemini' | 'elevenlabs';
export type Orientation = 'horizontal' | 'vertical';
export type ImageSource = 'google' | 'upload' | 'imagen' | 'hybrid';
export type ImageGenMode = 'google' | 'imagen';
export type SubtitleFont =
  | 'Bebas Neue' | 'Impact' | 'Montserrat' | 'Anton' | 'Poppins'
  | 'Inter' | 'Archivo Black' | 'League Spartan' | 'Raleway'
  | 'Oswald' | 'Roboto Condensed' | 'TheBoldFont'
  | 'Arial Black' | 'Georgia' | 'Verdana' | 'Courier New';
export type SubtitleAnimation = 'none' | 'word-highlight' | 'word-reveal' | 'pop' | 'fade-slide';

/** Visual effect applied to a single segment. */
export type VideoEffect = 'none' | 'flash' | 'zoom-burst' | 'shake' | 'glitch';

export interface SubtitleSettings {
  font: SubtitleFont;
  allCaps: boolean;
  highlight: boolean;
  chunkSize: 1 | 2 | 3;
  positionY: number;
  color: string;
  highlightColor: string;
  captionStrokeColor: string;
  captionStrokeWidth: number;
  sizeScale: number;
  animation: SubtitleAnimation;
}

export interface VideoSettings {
  // TTS provider
  ttsProvider: TTSProvider;

  // OpenAI voice settings
  voice: TTSVoice;
  voicePreset: VoicePreset;
  customInstructions: string;
  speed: number;
  hdQuality: boolean;

  // Gemini TTS settings
  geminiVoice: GeminiTTSVoice;
  geminiPreset: GeminiTTSPreset;
  geminiCustomPrompt: string;

  // ElevenLabs voice settings (kept for future use — not shown in UI)
  elevenLabsPreset: ElevenLabsPreset;
  elevenLabsCustomVoiceId: string;

  orientation: Orientation;
  imageSource: ImageSource;
  subtitle: SubtitleSettings;
  enableEffects: boolean;
  /** 'auto' = GPT decides (max 6s, paced); number = target seconds per segment */
  segmentDuration: 'auto' | number;
}

export interface WordTiming {
  word: string;
  start: number; // seconds from start of this segment's audio
  end: number;
}

export interface SegmentData {
  id: string;
  text: string;
  /** Gemini-enhanced text for TTS (same words, formatted for dramatic delivery) */
  audioText?: string;
  duration: number;
  keywords: string;
  importantWords?: string[];
  subtitleChunks?: string[];
  effect?: VideoEffect;
  imageUrl?: string;
  localImagePath?: string;
  /** Per-segment audio (legacy flow — not used when audioUrl is set on VideoInputProps) */
  audioPath?: string;
  audioDuration?: number;
  wordTimings?: WordTiming[];
  /** Absolute start time in the full voiceover audio (seconds) — set by mapSTTToSegments */
  startTime?: number;
  /** Absolute end time in the full voiceover audio (seconds) — set by mapSTTToSegments */
  endTime?: number;
  /** Gemini-generated search query or AI image generation prompt */
  imagePrompt?: string;
  /** Which mode was used to obtain this image (for hybrid) */
  imageGenMode?: ImageGenMode;
  /** Short user-facing note when the original planned image route failed and a fallback was used. */
  imageFallbackReason?: string;
  /** Ken Burns preset index override (0-4). Falls back to segment position if unset. */
  kbPreset?: 0 | 1 | 2 | 3 | 4;
  /** Scene transition style. Defaults to 'fade'. */
  transition?: 'fade' | 'cut' | 'dissolve';
}

export interface VideoInputProps {
  segments: SegmentData[];
  fps: number;
  orientation: Orientation;
  subtitle: SubtitleSettings;
  /** Full-script voiceover audio URL (new single-audio flow). When set, per-segment audioPath is ignored. */
  audioUrl?: string;
}

export type PipelineEvent =
  | { type: 'step'; step: string; message: string; total?: number }
  | { type: 'image_ready'; index: number; imageUrl: string; prompt?: string; mode?: ImageGenMode; attempts?: number; fallbackReason?: string }
  | { type: 'image_failed'; index: number; prompt?: string; mode?: ImageGenMode; error?: string }
  | { type: 'audio_ready'; index: number }
  | { type: 'effects_ready'; effects: VideoEffect[] }
  | { type: 'render_progress'; progress: number }
  | { type: 'done'; videoUrl: string; videoId?: string }
  | { type: 'error'; message: string };
