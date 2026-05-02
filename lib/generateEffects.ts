import OpenAI from 'openai';
import type { VideoEffect, SegmentData } from '@/types';

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const EFFECT_DESC: Record<VideoEffect, string> = {
  none: 'No effect - calm, neutral segment',
  flash: 'White flash at start - shocking fact, key reveal, climactic moment',
  'zoom-burst': 'Dramatic sudden zoom - powerful statement, peak intensity',
  shake: 'Camera shake - urgency, chaos, high energy, action',
  glitch: 'Digital glitch - tech theme, plot twist, dramatic surprise',
};

export async function generateEffects(segments: SegmentData[]): Promise<VideoEffect[]> {
  const completion = await openai.chat.completions.create({
    model: 'gpt-4o-mini',
    messages: [
      {
        role: 'system',
        content: `You are a video editor assigning visual effects to video segments to maximize impact.

Available effects:
${Object.entries(EFFECT_DESC).map(([k, v]) => `- "${k}": ${v}`).join('\n')}

Rules:
- Use effects SPARINGLY - maximum 40% of segments get a non-none effect
- Reserve strong effects (zoom-burst, shake, glitch) for only the most powerful moments
- flash works well for statistics, key names, or shocking revelations
- Most segments should be "none"
- Never assign the same effect to 3+ consecutive segments
- Return ONLY valid JSON: {"effects": ["none", "flash", ...]} - exactly one effect per segment, in order`,
      },
      {
        role: 'user',
        content: segments
          .map((s, i) => `${i + 1}. "${s.text}"`)
          .join('\n'),
      },
    ],
    response_format: { type: 'json_object' },
    temperature: 0.4,
  });

  const content = completion.choices[0].message.content ?? '{"effects":[]}';
  const parsed = JSON.parse(content) as { effects?: unknown[] };
  const raw = parsed.effects ?? [];
  const valid: Set<VideoEffect> = new Set(['none', 'flash', 'zoom-burst', 'shake', 'glitch']);

  return segments.map((_, i) => {
    const value = raw[i];
    return typeof value === 'string' && valid.has(value as VideoEffect)
      ? (value as VideoEffect)
      : 'none';
  });
}
