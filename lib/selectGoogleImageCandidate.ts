import type { Orientation } from '@/types';
import type { GoogleImageCandidate } from '@/lib/searchImages';
import { GEMINI_IMAGE_MODEL } from '@/lib/models';

export interface GoogleImageSelection {
  selectedIndex: number;
  reason: string;
}

export async function selectGoogleImageCandidate(
  candidates: GoogleImageCandidate[],
  segmentText: string,
  fullScript: string,
  orientation: Orientation,
): Promise<GoogleImageSelection> {
  const apiKey = process.env.GOOGLE_AI_API_KEY;
  if (!apiKey) throw new Error('GOOGLE_AI_API_KEY is not set');
  if (candidates.length === 0) throw new Error('No candidates to select from');

  const aspectHint = orientation === 'vertical'
    ? '9:16 vertical portrait video'
    : '16:9 horizontal landscape video';

  const systemPrompt = `## # Image selection system

You are a cinematic image selection director for viral short-form videos.

Your task is to select the SINGLE best image candidate for the current video segment.

The selected image should maximize:
- emotional impact
- narrative relevance
- cinematic quality
- viewer retention

Do NOT select images based only on literal keyword matching.

Choose the image that best supports the emotional and storytelling moment of the video.

You will receive:
- the full video script
- the current segment
- image candidates
- aspect ratio target

---

# SELECTION PRIORITIES

Prioritize, in order:

1. Emotional relevance to the current moment
2. Narrative relevance to the segment and full story
3. Cinematic and visually engaging composition
4. Strong visual clarity for fast short-form videos
5. Realistic, high-quality photographic appearance
6. Correct orientation and framing for ${aspectHint}

---

# VISUAL QUALITY RULES

Prefer images that:
- immediately communicate emotion or tension
- feel cinematic or documentary-like
- have strong composition
- look visually dynamic
- feel immersive
- imply motion, pressure, or atmosphere

Avoid:
- generic stock-photo feeling
- flat or emotionally empty visuals
- confusing compositions
- visually cluttered scenes
- repetitive portraits
- obvious AI artifacts
- poor crops

---

# NEVER SELECT

Do not select:
- memes
- thumbnails
- screenshots
- text-heavy images
- logos
- low-quality images
- large watermarks
- unrelated visuals
- visually confusing scenes
- images that would feel awkward or embarrassing in the final video

---

# IMPORTANT

The best image is NOT always the most literal image.

Prefer images that:
- strengthen storytelling
- enhance emotion
- increase retention
- feel visually memorable

---

# OUTPUT FORMAT

Return ONLY valid JSON:

{
  "selectedIndex": 0,
  "reason": "short reason"
} ##`;

  const candidateLines = candidates.map((candidate, index) => {
    const width = candidate.imageWidth ?? 'unknown';
    const height = candidate.imageHeight ?? 'unknown';
    return [
      `${index}.`,
      `url: ${candidate.imageUrl}`,
      `width: ${width}`,
      `height: ${height}`,
      candidate.title ? `title: ${candidate.title}` : null,
      candidate.source ? `source: ${candidate.source}` : null,
      candidate.link ? `page: ${candidate.link}` : null,
    ].filter(Boolean).join('\n');
  }).join('\n\n');

  const userContent = `Current segment text:
"${segmentText}"

Full video script:
"${fullScript}"

Project orientation:
${orientation} (${aspectHint})

Candidate image URLs:
${candidateLines}`;

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_IMAGE_MODEL}:generateContent?key=${apiKey}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      system_instruction: { parts: [{ text: systemPrompt }] },
      contents: [{ role: 'user', parts: [{ text: userContent }] }],
      generationConfig: {
        responseMimeType: 'application/json',
        temperature: 0.1,
      },
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Gemini image selection error ${res.status}: ${body.slice(0, 300)}`);
  }

  const data = (await res.json()) as {
    candidates?: { content?: { parts?: { text?: string }[] } }[];
  };
  const raw = data.candidates?.[0]?.content?.parts?.[0]?.text ?? '{}';
  const parsed = JSON.parse(raw) as Partial<GoogleImageSelection>;
  const selectedIndex = Number(parsed.selectedIndex);

  if (!Number.isInteger(selectedIndex) || selectedIndex < 0 || selectedIndex >= candidates.length) {
    throw new Error(`Gemini selected invalid candidate index: ${String(parsed.selectedIndex)}`);
  }

  return {
    selectedIndex,
    reason: typeof parsed.reason === 'string' ? parsed.reason : '',
  };
}

export async function rankGoogleImageCandidates(
  candidates: GoogleImageCandidate[],
  segmentText: string,
  fullScript: string,
  orientation: Orientation,
): Promise<GoogleImageCandidate[]> {
  try {
    const selection = await selectGoogleImageCandidate(candidates, segmentText, fullScript, orientation);
    const selected = candidates[selection.selectedIndex];
    if (!selected) return candidates;
    console.log(`[image selector] selected ${selection.selectedIndex}: ${selection.reason}`);
    return [
      selected,
      ...candidates.filter((_, index) => index !== selection.selectedIndex),
    ];
  } catch (err) {
    console.warn('[image selector] falling back to size order:', err);
    return candidates;
  }
}
