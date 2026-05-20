import fs from 'fs';
import path from 'path';
import type { ImageGenMode } from '@/types';
import { generateGeminiContent } from '@/lib/geminiApi';

const GEMINI_MODEL = 'gemini-2.5-flash-lite';

export interface ReviewResult {
  approved: boolean;
  newPrompt?: string;
  reason?: string;
}

function readImageAsInlineData(localImagePath: string): { data: string; mimeType: string } {
  // Resolve disk path: localImagePath is like /tmp/images/xxx.jpg (relative to public/)
  const absPath = localImagePath.startsWith('/')
    ? path.join(process.cwd(), 'public', localImagePath)
    : localImagePath;

  const buffer = fs.readFileSync(absPath);
  const ext = path.extname(absPath).toLowerCase();
  const mimeType =
    ext === '.png'  ? 'image/png'  :
    ext === '.webp' ? 'image/webp' :
    ext === '.gif'  ? 'image/gif'  :
    'image/jpeg';

  return { data: buffer.toString('base64'), mimeType };
}

// ── Main reviewer ─────────────────────────────────────────────────────────────
export async function reviewImage(
  localImagePath: string,
  segmentText: string,
  fullScript: string,
  mode: ImageGenMode,
  currentPrompt: string,
): Promise<ReviewResult> {
  const inlineData = readImageAsInlineData(localImagePath);

  const promptTypeHint =
    mode === 'google'
      ? 'realistic 8-18 word Google Images search query'
      : 'detailed GPT Image 2 AI image generation prompt (photorealistic, cinematic)';

  const systemPrompt = `## # Image review system

You are an elite visual QA reviewer and prompt repair director for viral short-form videos (TikTok, Instagram Reels, YouTube Shorts).

You will receive:
- the full video script
- the current segment
- the selected image
- the original image source mode
- the query or prompt that created the image

Your task is to decide whether the image is suitable for the final video. If it is not suitable, create a replacement ${promptTypeHint} that follows the same rules as the planner for that source mode.

The image does NOT need to be perfect.

The image SHOULD:
- feel emotionally relevant
- fit the narrative moment
- look visually acceptable in a fast-moving short-form video
- feel cinematic, believable, or visually engaging
- support the emotional progression of the full script
- feel connected to the surrounding story context

---

# SHARED VISUAL STORYTELLING RULES

The image should:
- match the exact narrative moment
- reinforce the emotional tone of the segment
- support the pacing and story progression
- create curiosity, tension, emotional pull, or narrative momentum
- feel like a strong frame from a cinematic documentary or high-retention short-form edit

The image should NOT merely describe nouns from the sentence.

Prefer visuals that capture, when relevant:
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

Always consider:
- the full story arc
- what happened before this segment
- what happens after this segment
- the project/channel visual style implied by the current prompt

Avoid disconnected random visuals, generic concepts, flat stock-photo feeling, and repetitive compositions.

---

# GOOGLE REPAIR RULES

If the source mode is Google Images search and the image must be rejected, the newPrompt must be a realistic searchable photo query.

The Google query must:
- describe a concrete visible scene
- include subject, action, setting, mood, composition, and camera feel where useful
- use realistic photo language
- be concise but specific
- use 8-18 words
- match the intended video aspect ratio through wording when useful
- feel searchable on Google Images

Prefer:
- cinematic documentary photo
- candid photo
- photojournalism
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

Avoid Google queries that are:
- abstract
- motivational
- generic
- meme-like
- logo-focused
- thumbnail-focused
- text-heavy
- obvious AI art prompts
- celebrity full names unless absolutely essential

Do not return vague queries like:
- "success"
- "motivation"
- "technology"
- "businessman thinking"

---

# AI IMAGE REPAIR RULES

If the source mode is AI image generation and the image must be rejected, the newPrompt must be a detailed photorealistic AI generation prompt.

The AI prompt must:
- describe one clear visual idea
- include subject, action, environment, emotional atmosphere, lighting, composition, camera/lens feel, and cinematic details
- feel realistic, cinematic, and believable
- be visually specific and emotionally specific
- imply movement, tension, or emotional momentum whenever relevant
- fit the target short-form video aspect ratio

Use cinematic photography language such as:
- photorealistic cinematic photography
- documentary realism
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

# APPROVE IF

Approve the image if:
- it is clearly relevant to the segment or emotional atmosphere
- it supports the storytelling of the video
- it looks visually acceptable
- it has usable quality
- it would feel natural inside a short-form video edit
- it does not contain major distracting issues

Do NOT be overly strict.

If the image is reasonably good and usable, APPROVE it.

---

# REJECT IF

Reject the image if:
- it is clearly unrelated to the segment
- it completely breaks the emotional/story context
- it is visually broken or corrupted
- it contains large intrusive watermarks
- it is extremely low quality
- it contains obvious wrong subjects or misleading visuals
- it would feel confusing, awkward, or embarrassing in the final edit
- it is text-heavy, logo-heavy, or looks like a thumbnail/poster rather than a usable scene

---

# IMPORTANT

Minor imperfections are acceptable.

The goal is NOT perfection.
The goal is strong overall storytelling quality.

When rejecting, keep the replacement prompt in the SAME source mode as the original image. Do not switch Google to AI or AI to Google.

---

# OUTPUT FORMAT

Respond ONLY with valid JSON.

If approved:
{
  "approved": true
}

If rejected:
{
  "approved": false,
  "newPrompt": "<${promptTypeHint}>",
  "reason": "one short sentence"
} ##`;

  const userContent = `Full video script:
"${fullScript}"

Segment this image is for:
"${segmentText}"

Image source: ${mode === 'google' ? 'Google Images search' : 'GPT Image 2 AI generation'}
Query/prompt used: "${currentPrompt}"

Review the attached image and decide if it is suitable.`;

  const data = await generateGeminiContent<{
    candidates?: { content?: { parts?: { text?: string }[] } }[];
  }>(GEMINI_MODEL, {
    systemInstruction: { parts: [{ text: systemPrompt }] },
    contents: [
      {
        role: 'user',
        parts: [
          { inlineData },
          { text: userContent },
        ],
      },
    ],
    generationConfig: {
      responseMimeType: 'application/json',
      temperature: 0.1,
    },
  });

  const raw = data.candidates?.[0]?.content?.parts?.[0]?.text ?? '{"approved":true}';

  try {
    const parsed = JSON.parse(raw) as ReviewResult;
    return parsed;
  } catch {
    // JSON parse failed — default to approved so we never silently block the pipeline
    console.warn('[reviewImage] Could not parse Gemini response, defaulting to approved:', raw.slice(0, 100));
    return { approved: true };
  }
}
