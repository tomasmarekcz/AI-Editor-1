export type ElevenLabsPreset = 'storyteller' | 'mysterious' | 'business' | 'custom';

export interface ElevenLabsPresetDef {
  label: string;
  icon: string;
  desc: string;
  stability: number;
  similarity_boost: number;
  style: number;
  use_speaker_boost: boolean;
}

export const ELEVENLABS_PRESETS: Record<ElevenLabsPreset, ElevenLabsPresetDef> = {
  storyteller: {
    label: 'Storyteller',
    icon: '🎯',
    desc: 'Excited storyteller voice with suspense and strong hooks',
    stability: 0.25,
    similarity_boost: 0.75,
    style: 0.85,
    use_speaker_boost: true,
  },
  mysterious: {
    label: 'Mysterious',
    icon: '🌑',
    desc: 'Slow mysterious deep voice with subtle tension',
    stability: 0.65,
    similarity_boost: 0.70,
    style: 0.45,
    use_speaker_boost: false,
  },
  business: {
    label: 'Business',
    icon: '💼',
    desc: 'Confident sharp persuasive business narrator',
    stability: 0.55,
    similarity_boost: 0.80,
    style: 0.60,
    use_speaker_boost: true,
  },
  custom: {
    label: 'Vlastní',
    icon: '✏️',
    desc: 'Vlastní Voice ID',
    stability: 0.50,
    similarity_boost: 0.75,
    style: 0.50,
    use_speaker_boost: true,
  },
};

export const ELEVENLABS_VOICE_ID = 'E4aVOlWL5DGbFy7TWmZA';
export const ELEVENLABS_PRESET_ORDER: ElevenLabsPreset[] = ['storyteller', 'mysterious', 'business', 'custom'];
