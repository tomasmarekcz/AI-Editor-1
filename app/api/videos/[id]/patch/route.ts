import OpenAI from 'openai';
import { validatePatch, applyPatchToSettings, applyPatchToSegments, listAppliedFields } from '@/lib/patchSchema';
import { requireAccountApi } from '@/lib/accounts';
import { enforceCostGuardrails } from '@/lib/safetyGuardrails';
import { enforcePaidPlan } from '@/lib/planGuardrails';
import type { SegmentData, VideoSettings } from '@/types';
import type { VideoEditPatch } from '@/types/editor';

export const maxDuration = 60;
export const dynamic = 'force-dynamic';

// Change model to your preferred OpenAI model — e.g. gpt-4.1-nano, gpt-4o-mini
const AI_MODEL = 'gpt-4o-mini';

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const PATCH_JSON_SCHEMA = {
  type: 'object',
  properties: {
    captions: {
      type: 'object',
      properties: {
        fontSize:       { type: 'number',  description: 'Subtitle size scale 0.5–3.0 (default 1.0)' },
        positionY:      { type: 'number',  description: 'Bottom position 0–100, higher = higher on screen' },
        stylePreset:    { type: 'string',  enum: ['none', 'word-highlight', 'word-reveal', 'pop', 'fade-slide'] },
        highlightColor: { type: 'string',  description: '#rrggbb hex color for highlighted words' },
        color:          { type: 'string',  description: '#rrggbb hex color for normal subtitle text' },
        captionStrokeColor: { type: 'string', description: '#rrggbb hex color for subtitle outline stroke' },
        captionStrokeWidth: { type: 'number', description: 'Subtitle outline stroke width in pixels, 0–12. 0 disables outline.' },
        font:           { type: 'string',  enum: ['Bebas Neue', 'Impact', 'Montserrat', 'Anton', 'Poppins', 'Inter', 'Archivo Black', 'League Spartan', 'Raleway', 'Oswald', 'Roboto Condensed', 'TheBoldFont', 'Arial Black', 'Georgia', 'Verdana', 'Courier New'] },
        allCaps:        { type: 'boolean' },
        highlight:      { type: 'boolean', description: 'Highlight important words in subtitle' },
        chunkSize:      { type: 'integer', enum: [1, 2, 3], description: 'Words shown per subtitle line' },
      },
      additionalProperties: false,
    },
    effects: {
      type: 'object',
      properties: {
        enableEffects: { type: 'boolean', description: 'Master toggle for per-scene effects' },
        globalEffect:  { type: 'string',  enum: ['none', 'flash', 'zoom-burst', 'shake', 'glitch'], description: 'Apply this effect to ALL scenes' },
      },
      additionalProperties: false,
    },
    trim: {
      type: 'object',
      properties: {
        startSeconds: { type: 'number', description: 'Skip scenes ending before this second' },
        endSeconds:   { type: 'number', description: 'Skip scenes starting after this second' },
      },
      additionalProperties: false,
    },
    scenes: {
      type: 'object',
      description: 'Keys are scene indexes (0-based). Only include scenes that need changes.',
      additionalProperties: {
        type: 'object',
        properties: {
          remove:          { type: 'boolean', description: 'Hide this scene from the video' },
          effect:          { type: 'string',  enum: ['none', 'flash', 'zoom-burst', 'shake', 'glitch'] },
          newImagePrompt:  { type: 'string',  description: 'New image generation prompt for this scene (max 500 chars)' },
        },
        additionalProperties: false,
      },
    },
    visualMood: {
      type: 'string',
      description: 'Informational description of the visual mood change requested',
    },
  },
  additionalProperties: false,
} as const;

export async function POST(req: Request, { params }: { params: { id: string } }) {
  const auth = await requireAccountApi();
  if (!auth.ok) return auth.response;
  const { supabase, user, account } = auth;

  const plan = enforcePaidPlan(account, 'videos/patch');
  if (!plan.ok) return plan.response;

  const safety = await enforceCostGuardrails(supabase, 'videos/patch');
  if (!safety.ok) return safety.response!;

  const videoId = params.id;
  const { prompt } = (await req.json()) as { prompt: string };
  if (!prompt?.trim()) return Response.json({ error: 'prompt is required' }, { status: 400 });

  const { data: video } = await supabase
    .from('videos')
    .select('id,project_id,original_script,enhanced_script,settings,segments,edited_settings,edited_segments')
    .eq('id', videoId)
    .eq('account_id', account.id)
    .maybeSingle();

  if (!video) return Response.json({ error: 'Video not found' }, { status: 404 });

  const currentSettings = (video.edited_settings ?? video.settings) as Partial<VideoSettings>;
  const currentSegments = (video.edited_segments ?? video.segments) as SegmentData[];

  // Get next version number
  const { count } = await supabase
    .from('video_edits')
    .select('id', { count: 'exact', head: true })
    .eq('video_id', videoId);
  const versionNumber = (count ?? 0) + 1;

  // Build context for AI
  const sceneSummary = currentSegments.slice(0, 30).map((s, i) => ({
    index: i,
    text: s.text.slice(0, 120),
    effect: s.effect ?? 'none',
    imagePrompt: (s.imagePrompt ?? '').slice(0, 80),
    duration: Math.round((s.endTime ?? 0) - (s.startTime ?? 0)) || Math.round(s.duration ?? 3),
  }));

  const systemPrompt = `You are a video editing assistant. The user wants to modify their video.
You must return ONLY a JSON patch object describing the changes. Do NOT include any explanation or code.

RULES:
- Only include fields that actually change.
- For color values always use #rrggbb hex format.
- fontSize is a scale multiplier: 1.0 = default, 1.5 = bigger, 0.7 = smaller.
- positionY: 5 = very bottom, 50 = middle. Higher number = higher on screen.
- For scene indexes: use 0-based numbers as string keys in "scenes" object.
- If user asks to regenerate an image, set scenes[index].newImagePrompt to a descriptive English prompt.
- Respond in JSON only — no markdown, no explanation.`;

  const userMessage = `Current video settings:
${JSON.stringify(currentSettings, null, 2)}

Scenes (${sceneSummary.length} total):
${JSON.stringify(sceneSummary, null, 2)}

User edit request: "${prompt}"

Return a JSON patch with only the changes needed.`;

  const completion = await openai.chat.completions.create({
    model: AI_MODEL,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user',   content: userMessage },
    ],
    response_format: {
      type: 'json_schema',
      json_schema: {
        name: 'video_edit_patch',
        strict: false,
        schema: PATCH_JSON_SCHEMA,
      },
    },
    max_tokens: 1000,
    temperature: 0.3,
  });

  const rawPatch = JSON.parse(completion.choices[0].message.content ?? '{}') as unknown;
  const patch = validatePatch(rawPatch);
  const appliedFields = listAppliedFields(patch);

  if (appliedFields.length === 0) {
    return Response.json({ error: 'AI could not determine changes from that request. Try being more specific.' }, { status: 422 });
  }

  // Apply to current state
  const newSettings = applyPatchToSettings(currentSettings, patch);
  const newSegments = applyPatchToSegments(currentSegments, patch);

  // Save patch to history
  await supabase.from('video_edits').insert({
    video_id: videoId,
    user_id: user.id,
    version_number: versionNumber,
    patch,
    prompt,
    applied_fields: appliedFields,
  });

  // Update edited state
  await supabase
    .from('videos')
    .update({
      edited_settings: newSettings,
      edited_segments: newSegments,
    })
    .eq('id', videoId);

  return Response.json({ patch, appliedFields, editedSettings: newSettings, editedSegments: newSegments });
}
