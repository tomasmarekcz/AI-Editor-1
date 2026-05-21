import type { SupabaseClient } from '@supabase/supabase-js';
import { requireAccountApi } from '@/lib/accounts';
import { generateOpenAIImage, OPENAI_IMAGE_MODEL } from '@/lib/generateWithOpenAIImage';
import { generateGeminiContent } from '@/lib/geminiApi';
import { GEMINI_CAPTION_MODEL } from '@/lib/models';
import { enforcePaidPlan } from '@/lib/planGuardrails';
import { costGeminiText, costOpenAIImage2Low, openAIImage2Usage, roundCost, type CostLine } from '@/lib/pricing';
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

const YOUTUBE_THUMBNAIL_MAX_BYTES = 2 * 1024 * 1024;

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
  const data = await generateGeminiContent<{
    candidates?: { content?: { parts?: { text?: string }[] } }[];
  }>(GEMINI_CAPTION_MODEL, {
    systemInstruction: {
      parts: [{
        text: `## # Thumbnail prompt generation system

You are a viral short-form thumbnail creative director.

Create ONE highly clickable vertical thumbnail concept for the video.

The thumbnail should:
- immediately attract attention
- create curiosity
- feel emotional, dramatic, or intense
- work well on TikTok, YouTube Shorts, and Reels
- look cinematic and visually clean

The thumbnail MUST include:
- a short bold text phrase inside the image
- maximum 2-5 words
- highly clickable and curiosity-driven
- matching the core topic of the video

Examples:
- "How He Survived"
- "The Biggest Scam"
- "Nobody Expected This"
- "Inside The Avalanche"
- "The Real Reason"
- "What Really Happened"

The image itself should:
- feel high-contrast
- visually simple
- emotionally strong
- easy to understand instantly
- focused on one clear subject or moment

Avoid:
- clutter
- small unreadable details
- logos
- UI
- watermarks
- poster layouts

Generate:
- the visual scene
- the thumbnail text
- cinematic lighting/composition
- strong emotional focus

Output ONLY the final image-generation prompt. ##`,
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

Visual prompt:
${project?.visual_style || 'High contrast cinematic short-form video thumbnail'}`,
      }],
    }],
    generationConfig: {
      temperature: 0.8,
      maxOutputTokens: 180,
    },
  });

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

Vertical 9:16 short-form video thumbnail, dramatic clickable composition, high contrast, crisp subject, strong lighting, expressive scene, one short bold readable text phrase inside the image, no logos, no watermark.`;

    const image = await generateOpenAIImage(finalPrompt, 'vertical');
    if (image.buffer.byteLength > YOUTUBE_THUMBNAIL_MAX_BYTES) {
      throw new Error('Generated thumbnail is larger than YouTube allows. Try a simpler prompt or upload a compressed JPEG.');
    }
    const assetClient = createStorageAdminClient() ?? auth.supabase;
    const extension = image.mimeType === 'image/jpeg' ? 'jpg' : 'png';
    const uploaded = await uploadBufferAsset({
      supabase: assetClient,
      userId: auth.user.id,
      projectId: video.project_id,
      videoId: video.id,
      folder: 'thumbnail',
      filename: `thumbnail-${Date.now()}.${extension}`,
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
        provider: 'openai',
        model: OPENAI_IMAGE_MODEL,
        step: 'thumbnail_generation',
        usage: openAIImage2Usage(1, 'vertical'),
        costUsd: costOpenAIImage2Low(1, 'vertical'),
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
