import type { VideoSettings } from '@/types';
import type { Orientation } from '@/types';
import { GEMINI_TTS_MODEL, OPENAI_SCRIPT_GENERATION_MODEL } from '@/lib/models';
import { OPENAI_IMAGE_MODEL, OPENAI_IMAGE_QUALITY, openAIImageSizeForOrientation } from '@/lib/generateWithOpenAIImage';

export const PRICING = {
  openai: {
    [OPENAI_SCRIPT_GENERATION_MODEL]: { inputUsdPer1MTokens: 2.50, outputUsdPer1MTokens: 15.00 },
    'gpt-4o-mini': { inputUsdPer1MTokens: 0.15, outputUsdPer1MTokens: 0.60 },
    'whisper-1': { usdPerMinute: 0.006 },
    'tts-1': { usdPer1MCharacters: 15.0 },
    'tts-1-hd': { usdPer1MCharacters: 30.0 },
    'gpt-4o-mini-tts': {
      textInputUsdPer1MTokens: 0.60,
      audioOutputUsdPer1MTokens: 12.0,
      estimatedUsdPerMinute: 0.015,
    },
    [OPENAI_IMAGE_MODEL]: {
      textInputUsdPer1MTokens: 5.00,
      textCachedInputUsdPer1MTokens: 1.25,
      imageInputUsdPer1MTokens: 8.00,
      imageCachedInputUsdPer1MTokens: 2.00,
      imageOutputUsdPer1MTokens: 30.00,
      lowUsdBySize: {
        '1024x1024': 0.006,
        '1024x1536': 0.005,
        '1536x1024': 0.005,
      },
    },
  },
  google: {
    'gemini-2.5-flash-lite': { inputUsdPer1MTokens: 0.10, outputUsdPer1MTokens: 0.40 },
    'gemini-2.5-flash-preview-tts': {
      textInputUsdPer1MTokens: 0.50,
      audioOutputUsdPer1MTokens: 10.0,
    },
  },
  serper: {
    imagesSearchUsdPerQuery: 0.001,
  },
  elevenlabs: {
    eleven_multilingual_v2: { usdPer1KCharacters: 0.10 },
  },
} as const;

export const GEMINI_TTS_AUDIO_OUTPUT_TOKENS_PER_SECOND = 25;

export type CostLine = {
  provider: string;
  model?: string;
  step: string;
  usage: Record<string, number | string | boolean>;
  costUsd: number;
};

export type CostEstimate = {
  totalUsd: number;
  lines: CostLine[];
  usage: Record<string, number | string | boolean>;
};

export function roundCost(value: number) {
  return Math.round(value * 1_000_000) / 1_000_000;
}

export function formatUsd(value?: number | null) {
  if (value == null) return '$0.00';
  if (value > 0 && value < 0.01) return `$${value.toFixed(4)}`;
  return `$${value.toFixed(2)}`;
}

export function estimateTokens(text: string) {
  return Math.max(1, Math.ceil(text.length / 4));
}

export function estimateWords(text: string) {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

export function estimateSegments(script: string) {
  return Math.max(1, Math.ceil(estimateWords(script) / 14));
}

export function estimateAudioSeconds(script: string) {
  return Math.max(5, estimateWords(script) / 2.5);
}

export function costOpenAIText(inputTokens: number, outputTokens: number) {
  const p = PRICING.openai['gpt-4o-mini'];
  return roundCost((inputTokens / 1_000_000) * p.inputUsdPer1MTokens + (outputTokens / 1_000_000) * p.outputUsdPer1MTokens);
}

export function costOpenAIModelText(model: keyof typeof PRICING.openai, inputTokens: number, outputTokens: number) {
  const p = PRICING.openai[model];
  if (!('inputUsdPer1MTokens' in p) || !('outputUsdPer1MTokens' in p)) return 0;
  return roundCost((inputTokens / 1_000_000) * p.inputUsdPer1MTokens + (outputTokens / 1_000_000) * p.outputUsdPer1MTokens);
}

export function costGeminiText(inputTokens: number, outputTokens: number) {
  const p = PRICING.google['gemini-2.5-flash-lite'];
  return roundCost((inputTokens / 1_000_000) * p.inputUsdPer1MTokens + (outputTokens / 1_000_000) * p.outputUsdPer1MTokens);
}

export function estimateGeminiTtsUsage(text: string, audioSeconds: number) {
  return {
    estimatedInputTokens: estimateTokens(text),
    estimatedAudioOutputTokens: Math.max(1, Math.ceil(audioSeconds * GEMINI_TTS_AUDIO_OUTPUT_TOKENS_PER_SECOND)),
    estimatedAudioSeconds: audioSeconds,
    audioOutputTokensPerSecond: GEMINI_TTS_AUDIO_OUTPUT_TOKENS_PER_SECOND,
  };
}

export function costGeminiTts(textInputTokens: number, audioOutputTokens: number) {
  const p = PRICING.google['gemini-2.5-flash-preview-tts'];
  return roundCost(
    (textInputTokens / 1_000_000) * p.textInputUsdPer1MTokens +
    (audioOutputTokens / 1_000_000) * p.audioOutputUsdPer1MTokens,
  );
}

export function costOpenAIImage2Low(images: number, orientation: Orientation) {
  const size = openAIImageSizeForOrientation(orientation) as keyof typeof PRICING.openai[typeof OPENAI_IMAGE_MODEL]['lowUsdBySize'];
  const p = PRICING.openai[OPENAI_IMAGE_MODEL];
  return roundCost(images * (p.lowUsdBySize[size] ?? p.lowUsdBySize['1024x1024']));
}

export function openAIImage2Usage(images: number, orientation: Orientation) {
  return {
    images,
    model: OPENAI_IMAGE_MODEL,
    quality: OPENAI_IMAGE_QUALITY,
    size: openAIImageSizeForOrientation(orientation),
    estimated: true,
  };
}

export function estimateScriptGenerationCost({
  description,
  preferredLengthSeconds,
  projectName,
  projectNiche,
  projectLanguage,
  voiceStyle,
  defaultProjectPrompt,
}: {
  description: string;
  preferredLengthSeconds: number;
  projectName: string;
  projectNiche: string;
  projectLanguage: string;
  voiceStyle: string;
  defaultProjectPrompt?: string;
}): CostLine {
  const promptText = [
    description,
    String(preferredLengthSeconds),
    projectName,
    projectNiche,
    projectLanguage,
    voiceStyle,
    defaultProjectPrompt ?? '',
  ].join('\n');
  const estimatedInputTokens = estimateTokens(promptText) + 650;
  const estimatedOutputTokens = Math.max(180, Math.ceil(preferredLengthSeconds * 6));
  return {
    provider: 'openai',
    model: OPENAI_SCRIPT_GENERATION_MODEL,
    step: 'script_generation',
    usage: { estimatedInputTokens, estimatedOutputTokens, preferredLengthSeconds },
    costUsd: costOpenAIModelText(OPENAI_SCRIPT_GENERATION_MODEL, estimatedInputTokens, estimatedOutputTokens),
  };
}

export function estimateVideoCost(
  script: string,
  settings: VideoSettings,
  additionalLines: CostLine[] = [],
): CostEstimate {
  const tokens = estimateTokens(script);
  const words = estimateWords(script);
  const segmentCount = estimateSegments(script);
  const audioSeconds = estimateAudioSeconds(script);
  const audioMinutes = audioSeconds / 60;
  const lines: CostLine[] = [];

  lines.push({
    provider: 'openai',
    model: 'gpt-4o-mini',
    step: 'script_segmentation',
    usage: { estimatedInputTokens: tokens + 900, estimatedOutputTokens: segmentCount * 120 },
    costUsd: costOpenAIText(tokens + 900, segmentCount * 120),
  });

  lines.push({
    provider: 'google',
    model: 'gemini-2.5-flash-lite',
    step: 'image_planning',
    usage: { estimatedInputTokens: tokens + 700, estimatedOutputTokens: segmentCount * 70 },
    costUsd: costGeminiText(tokens + 700, segmentCount * 70),
  });

  const imagenImages =
    settings.imageSource === 'imagen' ? segmentCount :
    settings.imageSource === 'hybrid' ? Math.ceil(segmentCount / 2) : 0;
  const serperQueries =
    settings.imageSource === 'google' ? segmentCount :
    settings.imageSource === 'hybrid' ? Math.floor(segmentCount / 2) : 0;

  if (imagenImages > 0) {
    lines.push({
      provider: 'openai',
      model: OPENAI_IMAGE_MODEL,
      step: 'image_generation',
      usage: openAIImage2Usage(imagenImages, settings.orientation),
      costUsd: costOpenAIImage2Low(imagenImages, settings.orientation),
    });
  }

  if (serperQueries > 0) {
    lines.push({
      provider: 'serper',
      step: 'image_search',
      usage: { estimatedQueries: serperQueries },
      costUsd: roundCost(serperQueries * PRICING.serper.imagesSearchUsdPerQuery),
    });
    lines.push({
      provider: 'google',
      model: 'gemini-2.5-flash-lite',
      step: 'image_selection',
      usage: { estimatedSelections: serperQueries, estimatedInputTokens: serperQueries * 900, estimatedOutputTokens: serperQueries * 40 },
      costUsd: costGeminiText(serperQueries * 900, serperQueries * 40),
    });
  }

  if (settings.imageSource !== 'upload') {
    lines.push({
      provider: 'google',
      model: 'gemini-2.5-flash-lite',
      step: 'image_review',
      usage: { estimatedReviews: segmentCount, estimatedInputTokens: segmentCount * 450, estimatedOutputTokens: segmentCount * 50 },
      costUsd: costGeminiText(segmentCount * 450, segmentCount * 50),
    });
  }

  if (settings.enableEffects) {
    lines.push({
      provider: 'openai',
      model: 'gpt-4o-mini',
      step: 'effects',
      usage: { estimatedInputTokens: tokens + 500, estimatedOutputTokens: segmentCount * 8 },
      costUsd: costOpenAIText(tokens + 500, segmentCount * 8),
    });
  }

  if (settings.ttsProvider === 'gemini') {
    const usage = estimateGeminiTtsUsage(script, audioSeconds);
    lines.push({
      provider: 'google',
      model: GEMINI_TTS_MODEL,
      step: 'tts',
      usage: { estimatedCharacters: script.length, ...usage },
      costUsd: costGeminiTts(usage.estimatedInputTokens, usage.estimatedAudioOutputTokens),
    });
  } else if (settings.ttsProvider === 'elevenlabs') {
    lines.push({
      provider: 'elevenlabs',
      model: 'eleven_multilingual_v2',
      step: 'tts',
      usage: { estimatedCharacters: script.length, estimatedAudioSeconds: audioSeconds },
      costUsd: roundCost((script.length / 1_000) * PRICING.elevenlabs.eleven_multilingual_v2.usdPer1KCharacters),
    });
  } else {
    const hasInstructions = settings.voicePreset === 'custom'
      ? settings.customInstructions.trim().length > 0
      : true;
    const model = settings.hdQuality ? 'tts-1-hd' : hasInstructions ? 'gpt-4o-mini-tts' : 'tts-1';
    const costUsd = model === 'gpt-4o-mini-tts'
      ? audioMinutes * PRICING.openai['gpt-4o-mini-tts'].estimatedUsdPerMinute
      : (script.length / 1_000_000) * PRICING.openai[model].usdPer1MCharacters;
    lines.push({
      provider: 'openai',
      model,
      step: 'tts',
      usage: { estimatedCharacters: script.length, estimatedAudioSeconds: audioSeconds },
      costUsd: roundCost(costUsd),
    });
  }

  lines.push({
    provider: 'openai',
    model: 'whisper-1',
    step: 'transcription',
    usage: { estimatedAudioSeconds: audioSeconds },
    costUsd: roundCost(audioMinutes * PRICING.openai['whisper-1'].usdPerMinute),
  });

  const allLines = [...additionalLines, ...lines];
  const totalUsd = roundCost(allLines.reduce((sum, line) => sum + line.costUsd, 0));
  return {
    totalUsd,
    lines: allLines,
    usage: {
      estimatedWords: words,
      estimatedTokens: tokens,
      estimatedSegments: segmentCount,
      estimatedAudioSeconds: audioSeconds,
      estimatedAiImages: imagenImages,
      estimatedSerperQueries: serperQueries,
    },
  };
}
