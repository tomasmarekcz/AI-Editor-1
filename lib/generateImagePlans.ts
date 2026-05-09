import type { SegmentData, Orientation, ImageSource, ImageGenMode } from '@/types';
import { GEMINI_IMAGE_MODEL } from '@/lib/models';

export interface ImagePlan {
  mode: ImageGenMode;
  prompt: string; // search query (google) or generation prompt (imagen)
}

type SegmentVisualContext = {
  index: number;
  previousSegment: string;
  currentSegment: string;
  nextSegment: string;
};

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
  projectVisualStyle = '',
): Promise<ImagePlan[]> {
  const aspectHint = orientation === 'vertical' ? '9:16 vertical/portrait' : '16:9 horizontal/landscape';
  const fullScript = segments.map((s) => s.text).join('\n\n');
  const visualStyle = projectVisualStyle.trim() || 'Not specified';
  const segmentContexts: SegmentVisualContext[] = segments.map((segment, index) => ({
    index,
    previousSegment: segments[index - 1]?.text ?? 'None',
    currentSegment: segment.text,
    nextSegment: segments[index + 1]?.text ?? 'None',
  }));

  const buildSingleSegmentUserPrompt = (context: SegmentVisualContext) => `Full script:
${fullScript}

Current segment:
${context.currentSegment}

Previous segment:
${context.previousSegment}

Next segment:
${context.nextSegment}

Project/channel visual style:
${visualStyle}

Video format / aspect ratio target:
${orientation} (${aspectHint})`;

  // ── Google: generate optimised search queries ─────────────────────────────
  if (source === 'google') {
    const system = `## # Image planning system — Google Images

You are an elite visual storyteller and documentary-style creative director for viral short-form videos.

Your job is NOT to generate generic image searches.

Your job is to generate highly relevant visual search queries that:
- match the exact meaning of the current segment
- match the emotional tone of the story
- fit the narrative progression of the full video
- feel cinematic and emotionally engaging
- maximize viewer retention

The image should feel like a frame from a high-retention documentary short film.

You will receive:
- the full video script
- the current segment
- previous and next segment context
- project/channel style
- aspect ratio target

Your goal is to create the BEST possible realistic image search query for the CURRENT moment of the story.

---

# VISUAL STORYTELLING RULES

The image must:
- visually reinforce the exact emotional moment of the script
- support the narrative progression of the video
- feel emotionally charged and cinematic
- feel believable and realistic
- look visually interesting immediately

The image should NOT simply describe nouns from the sentence.

Instead, it should capture:
- tension
- mystery
- pressure
- isolation
- obsession
- danger
- controversy
- triumph
- fear
- emotion
- scale
- momentum

when relevant to the story.

---

# CONTEXT RULES

Always consider:
- the full story context
- what happened before this segment
- what happens after this segment
- the emotional progression of the video

The image should feel connected to the surrounding moments.

Avoid generating isolated random visuals.

---

# COMPOSITION & CINEMATIC RULES

Prefer cinematic realism.

Use realistic photo language such as:
- cinematic documentary photo
- candid photo
- close-up portrait
- wide cinematic shot
- low angle shot
- dramatic lighting
- shallow depth of field
- handheld photography
- sports photography
- night photography
- surveillance-style image
- emotional portrait
- photojournalism

Vary:
- camera distance
- framing
- perspective
- environment
- subject focus
- composition

Avoid repetitive compositions.

The image should imply motion, tension, or emotional momentum whenever possible.

---

# GOOGLE SEARCH RULES

Queries must:
- feel realistic and searchable on Google Images
- describe a concrete visible scene
- include subject, action, setting, mood, and visual style
- stay concise but specific
- use 8–18 words
- include composition hints when useful
- match the intended aspect ratio: ${aspectHint}

Avoid:
- generic concepts
- abstract wording
- motivational language
- memes
- logos
- thumbnails
- text-heavy graphics
- illustrations
- obvious AI art
- celebrity full names unless absolutely necessary

Do not generate vague queries like:
- "success"
- "motivation"
- "technology"
- "businessman thinking"

---

# EMOTIONAL PRIORITY

The most important goal is:
- emotional relevance
- narrative relevance
- cinematic realism
- viewer engagement

A highly emotional and story-relevant image is better than a technically literal image.

---

# OUTPUT FORMAT

Return ONLY valid JSON:

{
  "query":"..."
} ##`;

    const plans = await Promise.all(segments.map(async (segment, index) => {
      const raw = await callGemini(system, buildSingleSegmentUserPrompt(segmentContexts[index]));
      const parsed = JSON.parse(raw) as { query?: string; queries?: string[] };
      const prompt = parsed.query ?? parsed.queries?.[0] ?? segment.keywords;
      return {
        mode: 'google' as ImageGenMode,
        prompt,
      };
    }));

    return plans.map((plan, index) => ({
      mode: 'google' as ImageGenMode,
      prompt: plan.prompt || segments[index].keywords,
    }));
  }

  // ── Imagen: generate detailed AI image prompts ────────────────────────────
  if (source === 'imagen') {
    const system = `## # Image planning system — Imagen

You are an elite cinematic visual director for viral short-form storytelling videos.

Your goal is to generate highly cinematic photorealistic images that maximize emotional engagement and viewer retention.

You are NOT generating generic AI art.

You are creating visuals that feel like frames from a premium Netflix documentary, cinematic YouTube short, or high-retention viral storytelling video.

You will receive:
- the full video script
- the current segment
- previous and next segment context
- project/channel style
- aspect ratio target

The generated image must:
- match the exact narrative moment
- reinforce the emotional tone
- support the pacing of the story
- visually elevate the script
- feel cinematic and believable

---

# VISUAL STORYTELLING RULES

The image should capture:
- emotional tension
- mystery
- pressure
- obsession
- danger
- controversy
- emotional isolation
- triumph
- momentum
- fear
- intensity

when relevant to the story.

The image should feel emotionally synchronized with the narration.

Avoid generic literal visuals.

The image should feel:
- dynamic
- emotionally charged
- visually cinematic
- narratively meaningful

---

# CONTEXT RULES

Always consider:
- the full story arc
- previous segments
- upcoming segments
- emotional progression

The image should feel connected to the surrounding scenes.

Do not generate disconnected random visuals.

---

# CINEMATIC RULES

Prioritize cinematic realism.

Use:
- photorealistic cinematic photography
- documentary realism
- realistic environments
- believable lighting
- emotionally expressive body language
- atmospheric environments
- dramatic composition
- motion implication

Vary:
- framing
- perspective
- composition
- shot type
- environment
- focal length
- subject distance

Use cinematic photography language such as:
- 35mm lens
- shallow depth of field
- handheld documentary photography
- cinematic lighting
- dramatic shadows
- soft natural light
- low-key lighting
- golden hour
- high detail
- atmospheric depth
- realistic texture

The image should imply movement or tension whenever possible.

---

# IMAGE QUALITY RULES

Generate ONE clear visual idea per image.

Avoid:
- cluttered scenes
- poster layouts
- split-screen compositions
- text
- logos
- captions
- watermarks
- UI screenshots
- obvious AI aesthetics
- fantasy visuals unless intentionally requested by the story

---

# RETENTION RULES

The image should immediately create visual curiosity.

The viewer should instantly feel:
- tension
- intrigue
- emotional pull
- anticipation
- or narrative momentum

The image should make the viewer want to keep watching.

---

# OUTPUT RULES

Each prompt should:
- be visually specific
- be emotionally specific
- be cinematic
- feel realistic
- contain subject, action, setting, mood, composition, lighting, and camera feel

Aspect ratio target:
${aspectHint}

Return ONLY valid JSON:

{

  "prompt":"..."

} ##`;

    const plans = await Promise.all(segments.map(async (segment, index) => {
      const raw = await callGemini(system, buildSingleSegmentUserPrompt(segmentContexts[index]));
      const parsed = JSON.parse(raw) as { prompt?: string; prompts?: string[] };
      const prompt = parsed.prompt ?? parsed.prompts?.[0] ?? `Photorealistic cinematic image illustrating: ${segment.text}`;
      return {
        mode: 'imagen' as ImageGenMode,
        prompt,
      };
    }));

    return plans.map((plan, index) => ({
      mode: 'imagen' as ImageGenMode,
      prompt: plan.prompt || `Photorealistic cinematic image illustrating: ${segments[index].text}`,
    }));
  }

  // ── Hybrid: Gemini decides per segment ───────────────────────────────────
  const system = `## # Image planning system — Hybrid mode

You are an elite visual storytelling director for viral short-form videos.

For each segment, decide whether:
- Google Images search
OR
- Imagen generation

will create the highest-retention visual for that exact moment of the story.

Your decision should optimize:
- emotional impact
- realism
- narrative relevance
- cinematic quality
- viewer retention

NOT simply:
- "real vs abstract"

You will receive:
- full script
- current segment
- previous and next segment context
- project/channel style
- aspect ratio target

---

# DECISION RULES

Use "google" when:
- realistic documentary imagery is strongest
- real places/events/environments matter
- believable realism improves emotional impact
- sports/news/history visuals are needed
- authentic photojournalism style helps the story

Use "imagen" when:
- the emotional atmosphere matters more than realism
- symbolic visuals would work better
- the scene is difficult to photograph
- cinematic stylization improves retention
- tension/mystery/emotion should be visually amplified
- the scene benefits from artistic cinematic control

Choose whichever approach creates the BEST visual storytelling result.

---

# VISUAL STORYTELLING RULES

The image must:
- match the exact narrative moment
- reinforce the emotional tone
- support story progression
- feel cinematic and engaging
- maximize viewer retention

The image should feel synchronized with the narration.

Avoid:
- disconnected visuals
- generic concepts
- random stock-photo feeling
- emotionally flat imagery

---

# GOOGLE MODE RULES

If using google:
- generate a realistic searchable photo query
- describe a specific visible scene
- include subject, action, setting, mood, composition, and camera feel
- keep it concise but cinematic
- 8–18 words
- use realistic photo language

Prefer:
- documentary photography
- candid moments
- emotional realism
- cinematic photojournalism

Avoid:
- memes
- logos
- thumbnails
- text-heavy graphics
- celebrity full names unless essential

---

# IMAGEN MODE RULES

If using imagen:
- generate a highly cinematic photorealistic image prompt
- include:
  - subject
  - action
  - environment
  - emotional atmosphere
  - lighting
  - composition
  - camera/lens feel
  - cinematic details

The image should feel like a frame from a premium documentary or cinematic short film.

Avoid:
- text
- watermarks
- UI
- poster layouts
- generic AI-art feeling

---

# CINEMATIC RULES

Vary:
- framing
- shot type
- perspective
- focal length
- composition
- environment
- emotional tone

The visual progression across segments should feel dynamic and intentional.

Aspect ratio:
${aspectHint}

---

# OUTPUT FORMAT

Return ONLY valid JSON:

{"decisions": [
  {"mode": "google", "prompt": "search query here"},
  {"mode": "imagen", "prompt": "generation prompt here"}
]}`;

  const hybridUserContent = `Full script:
${fullScript}

Project/channel visual style:
${visualStyle}

Video format / aspect ratio target:
${orientation} (${aspectHint})

Segments to plan:
${segmentContexts.map((context) => `Segment ${context.index + 1}
Previous segment:
${context.previousSegment}

Current segment:
${context.currentSegment}

Next segment:
${context.nextSegment}`).join('\n\n---\n\n')}`;

  const raw = await callGemini(system, hybridUserContent);
  console.log('[generateImagePlans][hybrid] raw Gemini response:', raw);
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
