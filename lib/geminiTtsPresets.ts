export type GeminiTTSPreset =
  | 'hype'
  | 'storyteller'
  | 'mystery'
  | 'business'
  | 'documentary'
  | 'custom';

export interface GeminiTTSPresetDef {
  label: string;
  icon: string;
  desc: string;
  prompt: string;
}

export const GEMINI_TTS_PRESETS: Record<GeminiTTSPreset, GeminiTTSPresetDef> = {
  hype: {
    label: 'Hype',
    icon: '🔥',
    desc: 'Ultra-rychlý, výbušný — Instagram Reels',
    prompt: `You are an ultra-high-energy social media hype creator making viral short-form content.
Speak with explosive energy from the very first word, but do not rush.
Every syllable lands clearly. Zero hesitation, zero filler.
Build intensity throughout — start fired up, end unstoppable.
Short punchy rhythm with clean articulation. Sound like you cannot be ignored.`,
  },
  storyteller: {
    label: 'Storyteller',
    icon: '🎯',
    desc: 'Napínavý vypravěč — silné hooks',
    prompt: `You are a viral TikTok storyteller who hooks audiences in the first second.
Fast exciting intro that grabs attention immediately.
Build suspense and tension with every sentence.
Slow down dramatically before reveals — let the silence work.
Sound genuinely astonished, like you cannot believe what happened.
End with a gut-punch that makes people want to share immediately.`,
  },
  mystery: {
    label: 'Mystery',
    icon: '🌑',
    desc: 'Pomalý, temný, napínavý',
    prompt: `You are a dark, mysterious narrator revealing forbidden knowledge.
Speak slowly — almost a whisper at times, then rise to full voice.
Let deliberate silences breathe between thoughts.
Sound like you are leaking dangerous information.
Subtle creeping tension that never fully resolves.
Deep and deliberate. Every word chosen carefully.`,
  },
  business: {
    label: 'Business',
    icon: '💼',
    desc: 'Sebevědomý, přesvědčivý narrátor',
    prompt: `You are a sharp authoritative business narrator commanding full attention.
Confident and direct — no filler, no fluff.
Punch key insights with deliberate weight and emphasis.
Crisp fast delivery between points. Measured pauses before the important ones.
Sound like someone who has generated real results and expects to be believed.`,
  },
  documentary: {
    label: 'Dokument',
    icon: '🎬',
    desc: 'Klidný, autoritativní',
    prompt: `You are a professional documentary narrator with decades of experience.
Calm, measured, and deeply credible voice.
Clear enunciation with thoughtful natural pauses.
Let the weight of each fact land before moving to the next.
Sound wise, authoritative, and completely trustworthy.
Unhurried but never boring — every word matters.`,
  },
  custom: {
    label: 'Vlastní',
    icon: '✏️',
    desc: 'Vlastní prompt pro hlas',
    prompt: '',
  },
};

export type GeminiTTSVoice =
  | 'Puck'
  | 'Charon'
  | 'Fenrir'
  | 'Orus'
  | 'Iapetus'
  | 'Algenib'
  | 'Rasalgethi'
  | 'Schedar'
  | 'Achird'
  | 'Sadaltager';

export const GEMINI_TTS_VOICES: { id: GeminiTTSVoice; label: string; desc: string }[] = [
  { id: 'Puck',       label: 'Puck',       desc: 'Upbeat creator voice' },
  { id: 'Charon',     label: 'Charon',     desc: 'Informativní dokumentární tón' },
  { id: 'Fenrir',     label: 'Fenrir',     desc: 'Excitable, energický' },
  { id: 'Orus',       label: 'Orus',       desc: 'Firm, autoritativní' },
  { id: 'Iapetus',    label: 'Iapetus',    desc: 'Clear, čistý voiceover' },
  { id: 'Algenib',    label: 'Algenib',    desc: 'Gravelly, dramatický' },
  { id: 'Rasalgethi', label: 'Rasalgethi', desc: 'Informative storytelling' },
  { id: 'Schedar',    label: 'Schedar',    desc: 'Even, stabilní narrace' },
  { id: 'Achird',     label: 'Achird',     desc: 'Friendly, přístupný tón' },
  { id: 'Sadaltager', label: 'Sadaltager', desc: 'Knowledgeable explainer' },
];

export const FEATURED_GEMINI_TTS_VOICES: GeminiTTSVoice[] = ['Puck', 'Charon'];

export const GEMINI_TTS_PRESET_ORDER: GeminiTTSPreset[] = [
  'hype', 'storyteller', 'mystery', 'business', 'documentary', 'custom',
];
