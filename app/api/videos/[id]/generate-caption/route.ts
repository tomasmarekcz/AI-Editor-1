import { requireAccountApi } from '@/lib/accounts';
import { GEMINI_CAPTION_MODEL } from '@/lib/models';
import { enforcePaidPlan } from '@/lib/planGuardrails';
import type { Project, SavedVideo } from '@/lib/projects/types';

export const dynamic = 'force-dynamic';
export const maxDuration = 30;

type CaptionRequest = {
  previousCaption?: string;
};

async function callGeminiCaption(systemPrompt: string, userPrompt: string) {
  const apiKey = process.env.GOOGLE_AI_API_KEY;
  if (!apiKey) throw new Error('GOOGLE_AI_API_KEY is not set');

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_CAPTION_MODEL}:generateContent?key=${apiKey}`;

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      system_instruction: { parts: [{ text: systemPrompt }] },
      contents: [{ role: 'user', parts: [{ text: userPrompt }] }],
      generationConfig: {
        temperature: 0.75,
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

    const systemPrompt = `You are an expert short-form social media caption writer.
Create a short caption for a video that will be posted on Instagram Reels, YouTube Shorts, and TikTok.
The caption should:
- include one curiosity-driven sentence that makes people want to watch the video
- be short and natural
- include exactly 6 hashtags
- include a mix of broad hashtags like #fyp, #viral, #shorts and niche hashtags based on the video topic
- output only the final caption, no explanation`;

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
