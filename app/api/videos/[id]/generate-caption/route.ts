import { requireAccountApi } from '@/lib/accounts';
import { generateGeminiContent } from '@/lib/geminiApi';
import { GEMINI_CAPTION_MODEL } from '@/lib/models';
import { enforcePaidPlan } from '@/lib/planGuardrails';
import type { Project, SavedVideo } from '@/lib/projects/types';

export const dynamic = 'force-dynamic';
export const maxDuration = 30;

type CaptionRequest = {
  previousCaption?: string;
};

async function callGeminiCaption(systemPrompt: string, userPrompt: string) {
  const data = await generateGeminiContent<{
    candidates?: { content?: { parts?: { text?: string }[] } }[];
  }>(GEMINI_CAPTION_MODEL, {
    systemInstruction: { parts: [{ text: systemPrompt }] },
    contents: [{ role: 'user', parts: [{ text: userPrompt }] }],
    generationConfig: {
      temperature: 0.75,
      maxOutputTokens: 180,
    },
  });

  const caption = data.candidates?.[0]?.content?.parts?.[0]?.text?.trim();
  if (!caption) throw new Error('Gemini returned an empty caption');

  return caption;
}

export async function POST(req: Request, { params }: { params: { id: string } }) {
  try {
    const body = (await req.json().catch(() => ({}))) as CaptionRequest;

    const auth = await requireAccountApi();
    if (!auth.ok) return auth.response;
    const { supabase, account } = auth;

    const plan = enforcePaidPlan(account, 'videos/generate-caption');
    if (!plan.ok) return plan.response;

    const { data: video } = await supabase
      .from('videos')
      .select('id,account_id,project_id,original_script,title')
      .eq('id', params.id)
      .eq('account_id', account.id)
      .maybeSingle<Pick<SavedVideo, 'id' | 'account_id' | 'project_id' | 'original_script' | 'title'>>();

    if (!video) {
      return Response.json({ error: 'Video not found' }, { status: 404 });
    }

    const { data: project } = await supabase
      .from('projects')
      .select('id,name,niche')
      .eq('id', video.project_id)
      .eq('account_id', account.id)
      .maybeSingle<Pick<Project, 'id' | 'name' | 'niche'>>();

    const systemPrompt = `## # Caption generation system

You are an expert short-form social media caption writer for TikTok, Instagram Reels, and YouTube Shorts.

Write a short natural caption that:
- creates curiosity
- increases clicks/watch rate
- feels native to social media
- matches the emotional tone of the video

The caption should:
- be short and punchy
- include one curiosity-driven sentence
- avoid generic filler
- feel emotionally engaging or intriguing
- sound human and natural

Include EXACTLY 6 hashtags:
- mix broad hashtags like #fyp #viral #shorts
- plus niche hashtags related to the video topic

Do not over-explain the video.

Output ONLY the final caption. ##`;

    const previousCaption = body.previousCaption?.trim();
    const userPrompt = `Full original_script:
${video.original_script || video.title}

Project name:
${project?.name || 'Not available'}

Project niche:
${project?.niche || 'Not available'}${
      previousCaption
        ? `

Previous caption:
${previousCaption}

Create a different version. Do not make it too similar to the previous caption.`
        : ''
    }`;

    const caption = await callGeminiCaption(systemPrompt, userPrompt);

    return Response.json({
      caption,
      model: GEMINI_CAPTION_MODEL,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[videos/generate-caption]', message);
    return Response.json({ error: message }, { status: 500 });
  }
}
