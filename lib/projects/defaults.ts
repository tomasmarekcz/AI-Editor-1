import type { SubtitleSettings, VideoSettings } from '@/types';

export const DEFAULT_SUBTITLE_SETTINGS: SubtitleSettings = {
  font: 'Arial Black',
  allCaps: false,
  highlight: true,
  chunkSize: 3,
  positionY: 10,
  color: '#ffffff',
  highlightColor: '#FFE400',
  sizeScale: 1.0,
  animation: 'word-highlight',
};

export const DEFAULT_VIDEO_SETTINGS: VideoSettings = {
  ttsProvider: 'gemini',
  voice: 'onyx',
  voicePreset: 'hype',
  customInstructions: '',
  speed: 1.1,
  hdQuality: false,
  geminiVoice: 'Fenrir',
  geminiPreset: 'hype',
  geminiCustomPrompt: '',
  elevenLabsPreset: 'storyteller',
  elevenLabsCustomVoiceId: '',
  orientation: 'vertical',
  imageSource: 'google',
  subtitle: DEFAULT_SUBTITLE_SETTINGS,
  enableEffects: false,
  segmentDuration: 'auto',
};

export function mergeVideoSettings(settings?: Partial<VideoSettings> | null): VideoSettings {
  return {
    ...DEFAULT_VIDEO_SETTINGS,
    ...(settings ?? {}),
    subtitle: {
      ...DEFAULT_SUBTITLE_SETTINGS,
      ...(settings?.subtitle ?? {}),
    },
  };
}
