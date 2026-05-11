import fs from 'fs';
import path from 'path';
import type { ImageGenMode } from '@/types';

const GEMINI_MODEL = 'gemini-2.5-flash-lite';

export interface ReviewResult {
  approved: boolean;
  newPrompt?: string;
  reason?: string;
}

// ── Upload image to Gemini Files API ─────────────────────────────────────────
async function uploadToFilesAPI(
  localImagePath: string,
): Promise<{ uri: string; mimeType: string }> {
  const apiKey = process.env.GOOGLE_AI_API_KEY;
  if (!apiKey) throw new Error('GOOGLE_AI_API_KEY is not set');

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

  // ── Step 1: Start resumable upload ──────────────────────────────────────
  const initRes = await fetch(
    `https://generativelanguage.googleapis.com/upload/v1beta/files?key=${apiKey}`,
    {
      method: 'POST',
      headers: {
        'X-Goog-Upload-Protocol': 'resumable',
        'X-Goog-Upload-Command': 'start',
        'X-Goog-Upload-Header-Content-Length': String(buffer.length),
        'X-Goog-Upload-Header-Content-Type': mimeType,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ file: { display_name: path.basename(absPath) } }),
    },
  );

  if (!initRes.ok) {
    const body = await initRes.text();
    throw new Error(`Files API init failed ${initRes.status}: ${body.slice(0, 200)}`);
  }

  const uploadUrl = initRes.headers.get('x-goog-upload-url');
  if (!uploadUrl) throw new Error('Files API: no upload URL in response headers');

  // ── Step 2: Upload binary data ───────────────────────────────────────────
  const uploadRes = await fetch(uploadUrl, {
    method: 'POST',
    headers: {
      'X-Goog-Upload-Command': 'upload, finalize',
      'X-Goog-Upload-Offset': '0',
      'Content-Type': mimeType,
    },
    body: buffer,
  });

  if (!uploadRes.ok) {
    const body = await uploadRes.text();
    throw new Error(`Files API upload failed ${uploadRes.status}: ${body.slice(0, 200)}`);
  }

  const data = (await uploadRes.json()) as {
    file?: { uri?: string; mimeType?: string };
  };

  const uri = data.file?.uri;
  if (!uri) throw new Error('Files API: no file URI in response');

  return { uri, mimeType: data.file?.mimeType ?? mimeType };
}

// ── Main reviewer ─────────────────────────────────────────────────────────────
export async function reviewImage(
  localImagePath: string,
  segmentText: string,
  fullScript: string,
  mode: ImageGenMode,
  currentPrompt: string,
): Promise<ReviewResult> {
  const apiKey = process.env.GOOGLE_AI_API_KEY;
  if (!apiKey) throw new Error('GOOGLE_AI_API_KEY is not set');

  // Upload the image to Gemini Files API
  const { uri, mimeType } = await uploadToFilesAPI(localImagePath);

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

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${apiKey}`;

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      system_instruction: { parts: [{ text: systemPrompt }] },
      contents: [
        {
          role: 'user',
          parts: [
            { fileData: { fileUri: uri, mimeType } },
            { text: userContent },
          ],
        },
      ],
      generationConfig: {
        responseMimeType: 'application/json',
        temperature: 0.1,
      },
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Gemini review error ${res.status}: ${body.slice(0, 300)}`);
  }

  const data = (await res.json()) as {
    candidates?: { content?: { parts?: { text?: string }[] } }[];
  };

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
