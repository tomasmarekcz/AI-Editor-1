import type { SupabaseClient } from '@supabase/supabase-js';
import { requireAccountApi } from '@/lib/accounts';
import { generateImagenImage } from '@/lib/generateWithImagen';
import { GEMINI_CAPTION_MODEL } from '@/lib/models';
import { enforcePaidPlan } from '@/lib/planGuardrails';
import { costGeminiText, PRICING, roundCost, type CostLine } from '@/lib/pricing';
import type { Project, SavedVideo } from '@/lib/projects/types';
import { enforceCostGuardrails } from '@/lib/safetyGuardrails';
import {
  createSignedUrl,
  createStorageAdminClient,
  uploadBufferAsset,
  VIDEO_ASSETS_BUCKET,
} from '@/lib/storage/videoAssets';
import { insertUsageEvents, summarizeCostLines } from '@/lib/usage/record';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

type GenerateThumbnailRequest = {
  prompt?: string;
};

async function generateThumbnailPrompt({
  video,
  project,
}: {
  video: Pick<SavedVideo, 'title' | 'original_script'>;
  project: Pick<Project, 'name' | 'niche' | 'visual_style'> | null;
}) {
  const apiKey = process.env.GOOGLE_AI_API_KEY;
  if (!apiKey) throw new Error('GOOGLE_AI_API_KEY is not set');

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_CAPTION_MODEL}:generateContent?key=${apiKey}`;

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      system_instruction: {
        parts: [{
          text: `You are a short-form video thumbnail creative director.
Create one concise image-generation prompt for a dramatic, clickable, high-contrast vertical thumbnail.
Avoid text, captions, logos, UI, watermarks, and words inside the image unless the user explicitly asks for text.
Output only the image prompt.`,
        }],
      },
      contents: [{
        role: 'user',
        parts: [{
          text: `Video title:
${video.title}

Original script:
${video.original_script || video.title}

Project:
${project?.name || 'Not available'}

Niche:
${project?.niche || 'Not available'}

Visual style:
${project?.visual_style || 'High contrast cinematic short-form video thumbnail'}`,
        }],
      }],
      generationConfig: {
        temperature: 0.8,
        maxOutputTokens: 180,
      },
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Gemini API error ${res.status}: ${body.slice(0, 300)}`);
  }

  const data = await res.json() as {
    candidates?: { content?: { parts?: { text?: string }[] } }[];
  };
  const prompt = data.candidates?.[0]?.content?.parts?.[0]?.text?.trim();
  if (!prompt) throw new Error('Gemini returned an empty thumbnail prompt');
  return prompt;
}

async function updateVideoCost({
  supabase,
  accountId,
  videoId,
}: {
  supabase: SupabaseClient;
  accountId: string;
  videoId: string;
}) {
  const { data: actualEvents } = await supabase
    .from('usage_events')
    .select('provider,model,step,usage,cost_usd')
    .eq('video_id', videoId)
    .eq('account_id', accountId)
    .eq('estimated', false);

  const allActualLines: CostLine[] = (actualEvents ?? []).map((event) => ({
    provider: String(event.provider),
    model: event.model ? String(event.model) : undefined,
    step: String(event.step),
    usage: (event.usage ?? {}) as Record<string, number | string | boolean>,
    costUsd: Number(event.cost_usd ?? 0),
  }));

  await supabase
    .from('videos')
    .update({
      actual_cost_usd: roundCost(allActualLines.reduce((sum, line) => sum + line.costUsd, 0)),
      cost_breakdown: { actual: summarizeCostLines(allActualLines) },
    })
    .eq('id', videoId)
    .eq('account_id', accountId);
}

export async function POST(req: Request, { params }: { params: { id: string } }) {
  try {
    const auth = await requireAccountApi();
    if (!auth.ok) return auth.response;

    const plan = enforcePaidPlan(auth.account, 'videos/thumbnail/generate');
    if (!plan.ok) return plan.response;

    const safety = await enforceCostGuardrails(auth.supabase, 'videos/thumbnail/generate');
    if (!safety.ok) return safety.response!;

    const body = (await req.json().catch(() => ({}))) as GenerateThumbnailRequest;
    const userPrompt = body.prompt?.trim();

    const { data: video } = await auth.supabase
      .from('videos')
      .select('id,user_id,account_id,project_id,title,original_script')
      .eq('id', params.id)
      .eq('account_id', auth.account.id)
      .maybeSingle<Pick<SavedVideo, 'id' | 'user_id' | 'account_id' | 'project_id' | 'title' | 'original_script'>>();

    if (!video) {
      return Response.json({ error: 'Video not found' }, { status: 404 });
    }

    const { data: project } = await auth.supabase
      .from('projects')
      .select('id,name,niche,visual_style')
      .eq('id', video.project_id)
      .eq('account_id', auth.account.id)
      .maybeSingle<Pick<Project, 'id' | 'name' | 'niche' | 'visual_style'>>();

    const prompt = userPrompt || await generateThumbnailPrompt({ video, project: project ?? null });
    const finalPrompt = `${prompt}

Vertical 9:16 short-form video thumbnail, dramatic clickable composition, high contrast, crisp subject, strong lighting, expressive scene, no text, no captions, no logos, no watermark.`;

    const image = await generateImagenImage(finalPrompt, 'vertical');
    const assetClient = createStorageAdminClient() ?? auth.supabase;
    const uploaded = await uploadBufferAsset({
      supabase: assetClient,
      userId: auth.user.id,
      projectId: video.project_id,
      videoId: video.id,
      folder: 'thumbnail',
      filename: `thumbnail-${Date.now()}.png`,
      buffer: image.buffer,
      contentType: image.mimeType,
    });

    const dbClient = createStorageAdminClient() ?? auth.supabase;
    const { error: assetError } = await dbClient.from('video_assets').insert({
      user_id: auth.user.id,
      account_id: auth.account.id,
      project_id: video.project_id,
      video_id: video.id,
      kind: 'thumbnail',
      storage_bucket: VIDEO_ASSETS_BUCKET,
      storage_path: uploaded.storagePath,
      mime_type: uploaded.mimeType,
      size_bytes: uploaded.sizeBytes,
      prompt: finalPrompt,
      source: 'ai',
      metadata: {
        requestedPrompt: userPrompt ?? null,
        generatedPrompt: userPrompt ? null : prompt,
      },
    });

    if (assetError) {
      return Response.json({ error: assetError.message }, { status: 500 });
    }

    const { error: updateError } = await auth.supabase
      .from('videos')
      .update({
        thumbnail_path: uploaded.storagePath,
        thumbnail_prompt: prompt,
        thumbnail_source: 'ai',
        thumbnail_updated_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq('id', video.id)
      .eq('account_id', auth.account.id);

    if (updateError) {
      return Response.json({ error: updateError.message }, { status: 500 });
    }

    const costLines: CostLine[] = [
      {
        provider: 'google',
        model: 'imagen-4.0-generate-001',
        step: 'thumbnail_generation',
        usage: { images: 1 },
        costUsd: roundCost(PRICING.google['imagen-4.0-generate-001'].usdPerImage),
      },
    ];
    if (!userPrompt) {
      costLines.unshift({
        provider: 'google',
        model: GEMINI_CAPTION_MODEL,
        step: 'thumbnail_prompt',
        usage: { estimatedInputTokens: 900, estimatedOutputTokens: 180 },
        costUsd: costGeminiText(900, 180),
      });
    }

    try {
      await insertUsageEvents({
        supabase: auth.supabase,
        userId: auth.user.id,
        accountId: auth.account.id,
        projectId: video.project_id,
        videoId: video.id,
        lines: costLines,
        estimated: false,
      });
      await updateVideoCost({ supabase: auth.supabase, accountId: auth.account.id, videoId: video.id });
    } catch (usageErr) {
      console.warn('[videos/thumbnail/generate] usage update failed', usageErr);
    }

    return Response.json({
      storagePath: uploaded.storagePath,
      thumbnailUrl: await createSignedUrl(assetClient, uploaded.storagePath),
      prompt,
      source: 'ai',
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[videos/thumbnail/generate]', message);
    return Response.json({ error: message }, { status: 500 });
  }
}
