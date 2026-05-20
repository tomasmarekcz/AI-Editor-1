import type { SegmentData, Orientation, ImageSource, ImageGenMode } from '@/types';
import { generateGeminiContent } from '@/lib/geminiApi';
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
  const data = await generateGeminiContent<{
    candidates?: { content?: { parts?: { text?: string }[] } }[];
  }>(GEMINI_IMAGE_MODEL, {
    systemInstruction: { parts: [{ text: systemPrompt }] },
    contents: [{ role: 'user', parts: [{ text: userContent }] }],
    generationConfig: { responseMimeType: 'application/json', temperature: 0.3 },
  });

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

  const batchUserContent = `Full script:
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

  // ── AI generation: generate detailed image prompts ────────────────────────
  if (source === 'imagen') {
    const system = `## # Image planning system — AI image generation

You are an elite visual storytelling director for viral short-form videos.

Your task is to create the COMPLETE visual plan for the entire video.

You are NOT generating isolated random AI images.

You are designing a cinematic visual progression across all segments of the story.

The goal is to maximize:
- viewer retention
- emotional engagement
- narrative clarity
- cinematic pacing
- visual storytelling quality

You will receive:
- the full video script
- all video segments
- previous/next segment relationships
- project/channel style
- aspect ratio target

---

# CORE OBJECTIVE

Design visuals that feel like a complete cinematic sequence.

The visual flow across segments should feel:
- intentional
- dynamic
- emotionally synchronized
- narratively connected

The viewer should feel like they are watching one coherent visual story.

NOT:
- disconnected AI images
- repetitive portraits
- random cinematic aesthetics

---

# MOST IMPORTANT RULE

Each image MUST depict:
- one clear visible real-world scene
- happening at the exact narrative moment

The viewer should instantly understand:
- what is happening
- who is involved
- where the scene takes place
- what emotional situation is occurring

Avoid abstract symbolism unless the story specifically benefits from it.

---

# VISUAL STORYTELLING RULES

For every segment:
- match the exact narrative moment
- reinforce the emotional tone
- support story progression
- feel synchronized with narration
- improve viewer retention

The visuals should feel:
- believable
- emotionally engaging
- cinematic
- immersive
- grounded in reality

Avoid:
- generic AI aesthetics
- emotionally empty visuals
- disconnected concepts
- random dramatic portraits
- repetitive compositions

---

# VISUAL FLOW RULES

Consider the ENTIRE video sequence when planning images.

Vary naturally across segments:
- framing
- perspective
- focal length
- composition
- environment
- emotional intensity
- shot type
- subject distance
- pacing energy

The sequence should feel visually dynamic.

Avoid:
- multiple nearly identical shots in a row
- repetitive close-up portraits
- repetitive environments
- repetitive emotional tone

Create natural cinematic progression across the video.

---

# GENRE AWARENESS

Adapt visuals to the content style.

Examples:
- sports → dynamic realism, pressure, movement
- history → documentary realism, authentic atmosphere
- mystery → tension, anticipation, isolation
- business → believable real-world environments
- science → grounded visual explanation
- crime/drama → emotional realism and cinematic tension

Do NOT default to generic cinematic portraits.

---

# SCENE GENERATION RULES

Generate SPECIFIC visible scenes.

Each image should include:
- subject
- action
- environment
- emotional atmosphere
- composition
- lighting
- camera feel

Prioritize:
- documentary realism
- believable body language
- cinematic photojournalism
- immersive environments
- realistic tension and motion

---

# CINEMATIC RULES

Use cinematic photography language naturally when relevant:
- photorealistic cinematic photography
- documentary photography
- 35mm lens
- shallow depth of field
- handheld realism
- atmospheric depth
- cinematic lighting
- dramatic shadows
- realistic texture

The visuals should feel like frames from:
- a premium documentary
- a cinematic YouTube short
- a Netflix-style storytelling sequence

---

# IMAGE QUALITY RULES

Generate ONE clear visual idea per segment.

Avoid:
- cluttered scenes
- poster layouts
- split-screen compositions
- text
- logos
- captions
- watermarks
- UI
- obvious AI aesthetics
- fantasy visuals unless required by the story

The image should immediately communicate:
- story
- emotion
- tension
- momentum

---

# RETENTION RULES

Every image should create:
- curiosity
- emotional pull
- anticipation
- narrative momentum

The viewer should want to keep watching.

---

# OUTPUT RULES

For EACH segment:
- generate one visually specific cinematic prompt
- describe one exact narrative moment
- keep the image realistic and grounded
- include subject, action, setting, mood, composition, lighting, and camera feel

Aspect ratio target:
${aspectHint}

Return ONLY valid JSON:

{
  "prompts": [
    {
      "segmentIndex": 0,
      "prompt": "..."
    }
  ]
} ##`;

    const raw = await callGemini(system, batchUserContent);
    const parsed = JSON.parse(raw) as {
      prompts?: Array<{ segmentIndex?: number; prompt?: string } | string>;
      prompt?: string;
    };
    const prompts = parsed.prompts ?? [];

    return segments.map((segment, index) => {
      const byIndex = prompts.find((item) => (
        typeof item === 'object' &&
        (Number(item.segmentIndex) === index || Number(item.segmentIndex) === index + 1) &&
        typeof item.prompt === 'string'
      ));
      const byPosition = prompts[index];
      const prompt = typeof byIndex === 'object'
        ? byIndex.prompt
        : typeof byPosition === 'string'
          ? byPosition
          : typeof byPosition === 'object'
            ? byPosition.prompt
            : parsed.prompt;

      return {
        mode: 'imagen' as ImageGenMode,
        prompt: prompt || `Photorealistic cinematic image illustrating: ${segment.text}`,
      };
    });
  }

  // ── Hybrid: Gemini decides per segment ───────────────────────────────────
  const system = `## # Image planning system — Hybrid mode

You are an elite visual storytelling director for viral short-form videos.

For each segment, decide whether:
- Google Images search
OR
- AI image generation

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

  const raw = await callGemini(system, batchUserContent);
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
