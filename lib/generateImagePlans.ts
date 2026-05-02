import type { SegmentData, Orientation, ImageSource, ImageGenMode } from '@/types';
import { GEMINI_IMAGE_MODEL } from '@/lib/models';

export interface ImagePlan {
  mode: ImageGenMode;
  prompt: string; // search query (google) or generation prompt (imagen)
}

async function callGemini(systemPrompt: string, userContent: string): Promise<string> {
  const apiKey = process.env.GOOGLE_AI_API_KEY;
  if (!apiKey) throw new Error('GOOGLE_AI_API_KEY is not set');

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_IMAGE_MODEL}:generateContent?key=${apiKey}`;

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      system_instruction: { parts: [{ text: systemPrompt }] },
      contents: [{ role: 'user', parts: [{ text: userContent }] }],
      generationConfig: { responseMimeType: 'application/json', temperature: 0.3 },
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Gemini API error ${res.status}: ${body.slice(0, 300)}`);
  }

  const data = await res.json() as {
    candidates?: { content?: { parts?: { text?: string }[] } }[];
  };

  return data.candidates?.[0]?.content?.parts?.[0]?.text ?? '{}';
}

// ─────────────────────────────────────────────────────────────────────────────

export async function generateImagePlans(
  segments: SegmentData[],
  source: Exclude<ImageSource, 'upload'>,
  orientation: Orientation,
): Promise<ImagePlan[]> {
  const aspectHint = orientation === 'vertical' ? '9:16 vertical/portrait' : '16:9 horizontal/landscape';
  const segList = segments.map((s, i) => `${i + 1}. "${s.text}"`).join('\n');

  // ── Google: generate optimised search queries ─────────────────────────────
  if (source === 'google') {
    const system = `You are a visual researcher for short-form social media videos. For each video segment below, generate a precise Google Images search query that describes the exact realistic photo scene needed.

Rules:
- Describe a concrete visual scene: subject, action, setting, mood, lighting, and camera/photo style.
- Make the query realistic and searchable on Google Images, not poetic or abstract.
- Prefer natural photo language such as "candid photo", "cinematic photo", "close up", "wide shot", "low angle", "golden hour", "night street", "office desk", "portrait".
- Include the intended composition for ${aspectHint}; use "vertical portrait photo" or "horizontal landscape photo" when helpful.
- Avoid generic queries like "success", "business", "motivation", "technology", "person thinking".
- Avoid memes, logos, thumbnails, text-heavy graphics, illustrations, and celebrity full names.
- Keep each query concise but specific: 8–16 words.
- Return ONLY valid JSON: {"queries": ["query1", "query2", ...]}`;

    const raw = await callGemini(system, segList);
    const parsed = JSON.parse(raw) as { queries?: string[] };
    const queries = parsed.queries ?? [];

    return segments.map((s, i) => ({
      mode: 'google' as ImageGenMode,
      prompt: queries[i] ?? s.keywords,
    }));
  }

  // ── Imagen: generate detailed AI image prompts ────────────────────────────
  if (source === 'imagen') {
    const system = `You are a creative director generating Imagen 4 prompts for short-form social media videos.

For each video segment, write a detailed visual prompt that produces one clear, realistic, cinematic image.

Rules:
- Describe subject, action, setting, mood, lighting, composition, lens/camera feel, and background details.
- Translate abstract ideas into a visible scene with people, objects, places, gestures, or atmosphere.
- Use realistic photographic language: "photorealistic", "cinematic photography", "35mm lens", "shallow depth of field", "soft natural light", "golden hour", "high detail".
- Aspect ratio target: ${aspectHint}
- Avoid text, logos, UI screenshots, watermarks, captions, and poster-like layouts.
- Each prompt: 1–3 sentences, concrete and visually specific.
- Return ONLY valid JSON: {"prompts": ["prompt1", "prompt2", ...]}`;

    const raw = await callGemini(system, segList);
    const parsed = JSON.parse(raw) as { prompts?: string[] };
    const prompts = parsed.prompts ?? [];

    return segments.map((s, i) => ({
      mode: 'imagen' as ImageGenMode,
      prompt: prompts[i] ?? `Photorealistic cinematic image illustrating: ${s.text}`,
    }));
  }

  // ── Hybrid: Gemini decides per segment ───────────────────────────────────
  const system = `You are a creative director for short-form social media videos. For each segment, decide the best image approach and generate the appropriate Google Images query or Imagen 4 prompt.

Use "google" for: real people, real places, historical events, news topics, physical products
Use "imagen" for: abstract concepts, emotions, metaphors, futuristic/sci-fi, artistic scenes, anything hard to photograph

Aspect ratio: ${aspectHint}

For google:
- Write a realistic, searchable photo query describing the exact visual scene, subject, setting, mood, lighting, camera style, and aspect/composition.
- Keep it concise but specific: 8–16 words.
- Avoid generic concepts, memes, logos, thumbnails, text-heavy graphics, and celebrity full names.

For imagen:
- Write a detailed photorealistic cinematic prompt with subject, action, setting, mood, lighting, composition, lens/camera feel, and background details.
- Translate abstract ideas into a visible scene.
- Avoid text, logos, UI screenshots, watermarks, captions, and poster-like layouts.

Return ONLY valid JSON:
{"decisions": [
  {"mode": "google", "prompt": "search query here"},
  {"mode": "imagen", "prompt": "generation prompt here"}
]}`;

  const raw = await callGemini(system, segList);
  const parsed = JSON.parse(raw) as { decisions?: { mode: string; prompt: string }[] };
  const decisions = parsed.decisions ?? [];

  return segments.map((s, i) => {
    const d = decisions[i];
    const mode: ImageGenMode = d?.mode === 'imagen' ? 'imagen' : 'google';
    return {
      mode,
      prompt: d?.prompt ?? s.keywords,
    };
  });
}
