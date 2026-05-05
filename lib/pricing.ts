import type { VideoSettings } from '@/types';
import { OPENAI_SCRIPT_GENERATION_MODEL } from '@/lib/models';

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
  },
  google: {
    'gemini-2.5-flash-lite': { inputUsdPer1MTokens: 0.10, outputUsdPer1MTokens: 0.40 },
    'gemini-2.5-flash-preview-tts': {
      textInputUsdPer1MTokens: 0.50,
      audioOutputUsdPer1MTokens: 10.0,
      estimatedUsdPerMinute: 0.012,
    },
    'imagen-4.0-generate-001': { usdPerImage: 0.04 },
  },
  serper: {
    imagesSearchUsdPerQuery: 0.001,
  },
  elevenlabs: {
    eleven_multilingual_v2: { usdPer1KCharacters: 0.10 },
  },
} as const;

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

export function estimateScriptGenerationCost({
  description,
  preferredLengthSeconds,
  projectName,
  projectNiche,
  projectLanguage,
  voiceStyle,
  defaultProjectPrompt,
  defaultVisualPrompt,
}: {
  description: string;
  preferredLengthSeconds: number;
  projectName: string;
  projectNiche: string;
  projectLanguage: string;
  voiceStyle: string;
  defaultProjectPrompt?: string;
  defaultVisualPrompt?: string;
}): CostLine {
  const promptText = [
    description,
    String(preferredLengthSeconds),
    projectName,
    projectNiche,
    projectLanguage,
    voiceStyle,
    defaultProjectPrompt ?? '',
    defaultVisualPrompt ?? '',
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
      provider: 'google',
      model: 'imagen-4.0-generate-001',
      step: 'image_generation',
      usage: { estimatedImages: imagenImages },
      costUsd: roundCost(imagenImages * PRICING.google['imagen-4.0-generate-001'].usdPerImage),
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
    lines.push({
      provider: 'google',
      model: 'gemini-2.5-flash-preview-tts',
      step: 'tts',
      usage: { estimatedCharacters: script.length, estimatedAudioSeconds: audioSeconds },
      costUsd: roundCost(audioMinutes * PRICING.google['gemini-2.5-flash-preview-tts'].estimatedUsdPerMinute),
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
    const model = settings.voicePreset === 'custom' ? 'gpt-4o-mini-tts' : settings.hdQuality ? 'tts-1-hd' : 'tts-1';
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
      estimatedImagenImages: imagenImages,
      estimatedSerperQueries: serperQueries,
    },
  };
}
