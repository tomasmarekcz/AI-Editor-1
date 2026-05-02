import OpenAI from 'openai';
import { v4 as uuidv4 } from 'uuid';
import type { SegmentData } from '@/types';

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

interface RawSegment {
  text: string;
  duration: number;
  keywords: string;
  importantWords?: string[];
  subtitleChunks?: string[];
}

export async function segmentScript(
  script: string,
  targetChunkWords: number = 3,
  segmentDuration: 'auto' | number = 'auto',
): Promise<SegmentData[]> {
  const durationRule =
    segmentDuration === 'auto'
      ? '- Each segment: 4–6 seconds when read aloud (roughly 10–18 words)'
      : `- Each segment MUST be exactly ${segmentDuration} seconds when read aloud — adjust how many words you include per segment to match this pacing`;

  const completion = await openai.chat.completions.create({
    model: 'gpt-4o-mini',
    messages: [
      {
        role: 'system',
        content: `You are a video script editor. Split the script into short video segments and prepare linguistically correct subtitle chunks for each segment.

## Segmentation rules
${durationRule}
- Never cut mid-sentence — each segment must end at a natural pause or sentence boundary
- keywords: 3–5 English words for stock photo search
- importantWords: 2–4 most impactful words (in the original language) for subtitle highlight

## Subtitle chunking rules (subtitleChunks)
Split each segment's text into small display phrases for on-screen subtitles.
Target: ~${targetChunkWords} words per chunk, but ALWAYS prioritize linguistic correctness over hitting the exact count.

STRICT rules:
- NEVER split a proper name across chunks (e.g. "Jan Novák" must stay in one chunk)
- NEVER split a number + unit (e.g. "100 km", "5 minut")
- NEVER split a preposition from its noun phrase at the start (e.g. "ve Spojených státech" → keep together)
- NEVER break mid-idiom or mid-compound phrase
- Each chunk should feel like a natural breath/pause unit when spoken
- Punctuation stays with the word it follows

BAD:  ["Dnes budeme", "mluvit o", "počasí"]
GOOD: ["Dnes budeme mluvit", "o počasí"]

BAD:  ["Navštívíme", "New", "York"]
GOOD: ["Navštívíme New York"]

Return ONLY valid JSON:
{
  "segments": [
    {
      "text": "full segment text",
      "duration": 5,
      "keywords": "english search keywords",
      "importantWords": ["key", "words"],
      "subtitleChunks": ["first phrase", "second phrase", "third phrase"]
    }
  ]
}`,
      },
      { role: 'user', content: script },
    ],
    response_format: { type: 'json_object' },
    temperature: 0.2,
  });

  const content = completion.choices[0].message.content ?? '{"segments":[]}';
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    throw new Error('GPT returned invalid JSON');
  }

  let raw: RawSegment[] = [];
  if (Array.isArray(parsed)) {
    raw = parsed as RawSegment[];
  } else if (parsed && typeof parsed === 'object') {
    const obj = parsed as Record<string, unknown>;
    const key = Object.keys(obj).find((k) => Array.isArray(obj[k]));
    raw = key ? (obj[key] as RawSegment[]) : [];
  }

  if (raw.length === 0) throw new Error('GPT returned no segments');

  return raw.map((seg) => ({
    id: uuidv4(),
    text: String(seg.text ?? ''),
    duration: segmentDuration !== 'auto'
      ? segmentDuration
      : Math.max(3, Math.min(8, Number(seg.duration) || 5)),
    keywords: String(seg.keywords ?? 'nature landscape'),
    importantWords: Array.isArray(seg.importantWords) ? seg.importantWords.map(String) : [],
    subtitleChunks: Array.isArray(seg.subtitleChunks) && seg.subtitleChunks.length > 0
      ? seg.subtitleChunks.map(String)
      : undefined,
  }));
}
