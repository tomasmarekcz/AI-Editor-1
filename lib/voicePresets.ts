export type VoicePreset =
  | 'hype'
  | 'storyteller'
  | 'mystery'
  | 'business'
  | 'documentary'
  | 'custom';

export interface PresetDef {
  label: string;
  icon: string;
  desc: string;
  instructions: string;
}

export const VOICE_PRESETS: Record<VoicePreset, PresetDef> = {
  hype: {
    label: 'Hype',
    icon: '🔥',
    desc: 'Ultra-rychlý, výbušný — Instagram Reels',
    instructions:
      'Speak like an explosive social media hype creator. Extremely high energy, very fast delivery, ' +
      'punchy and unstoppable. Every word hits hard. Sound fired up, raw, and impossible to ignore.',
  },
  storyteller: {
    label: 'Storyteller',
    icon: '🎯',
    desc: 'Napínavý vypravěč — silné hooks',
    instructions:
      'Speak like an excited storyteller who pulls the listener in immediately. ' +
      'Build suspense with every sentence. Use dramatic pauses before reveals. ' +
      'Sound gripping, urgent, and impossible to scroll past.',
  },
  mystery: {
    label: 'Mystery',
    icon: '🌑',
    desc: 'Pomalý, temný, napínavý',
    instructions:
      'Speak with a slow, deep, mysterious tone. Build subtle tension with every word. ' +
      'Use deliberate pacing and dramatic pauses. Sound ominous and intriguing, ' +
      'like narrating a dark secret that is about to be revealed.',
  },
  business: {
    label: 'Business',
    icon: '💼',
    desc: 'Sebevědomý, přesvědčivý narrátor',
    instructions:
      'Speak with sharp, confident authority. Sound like a persuasive business narrator ' +
      'who commands attention. Clear, punchy delivery with strong emphasis on key points. ' +
      'Authoritative, credible, and impossible to doubt.',
  },
  documentary: {
    label: 'Dokument',
    icon: '🎬',
    desc: 'Klidný, autoritativní',
    instructions:
      'Speak like a professional documentary narrator. Calm, measured, authoritative. ' +
      'Clear enunciation with thoughtful pacing and natural pauses. Sound trustworthy, wise and intelligent.',
  },
  custom: {
    label: 'Vlastní',
    icon: '✏️',
    desc: 'Vlastní instrukce',
    instructions: '',
  },
};
