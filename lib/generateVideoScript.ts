import OpenAI from 'openai';
import { OPENAI_SCRIPT_GENERATION_MODEL } from '@/lib/models';
import { costOpenAIModelText, estimateScriptGenerationCost, roundCost, type CostLine } from '@/lib/pricing';

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

export type ScriptProjectContext = {
  name: string;
  niche: string;
  language: string;
  voiceStyle: string;
  defaultProjectPrompt?: string;
  defaultVisualPrompt?: string;
};

export type GeneratedScriptResult = {
  script: string;
  costLine: CostLine;
};

export async function generateVideoScriptFromPrompt({
  description,
  preferredLengthSeconds,
  project,
}: {
  description: string;
  preferredLengthSeconds: number;
  project: ScriptProjectContext;
}): Promise<GeneratedScriptResult> {
  const systemPrompt = `You are an expert short-form video scriptwriter for TikTok, Instagram Reels, and YouTube Shorts.

Create high-retention scripts with:
- strong hook in the first 1-3 seconds
- clear story progression
- curiosity
- simple spoken language
- emotional tension
- useful or surprising payoff
- no filler
- suitable pacing for the preferred video length
- output only the final script, no notes`;

  const userPrompt = `User description of the video:
${description}

Preferred video length:
${preferredLengthSeconds} seconds

Project name:
${project.name}

Project niche:
${project.niche}

Project language:
${project.language}

Voice style:
${project.voiceStyle}

Default project prompt:
${project.defaultProjectPrompt || 'None'}

Default visual prompt:
${project.defaultVisualPrompt || 'None'}

Generate the script in the project language. Make it suitable for voiceover and short-form video.`;

  const fallbackEstimate = estimateScriptGenerationCost({
    description,
    preferredLengthSeconds,
    projectName: project.name,
    projectNiche: project.niche,
    projectLanguage: project.language,
    voiceStyle: project.voiceStyle,
    defaultProjectPrompt: project.defaultProjectPrompt,
    defaultVisualPrompt: project.defaultVisualPrompt,
  });

  const completion = await openai.chat.completions.create({
    model: OPENAI_SCRIPT_GENERATION_MODEL,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt },
    ],
    max_completion_tokens: Math.max(600, Math.ceil(preferredLengthSeconds * 18)),
  });

  const script = completion.choices[0]?.message?.content?.trim();
  if (!script) throw new Error('OpenAI returned an empty script');

  const inputTokens = completion.usage?.prompt_tokens ?? Number(fallbackEstimate.usage.estimatedInputTokens);
  const outputTokens = completion.usage?.completion_tokens ?? Number(fallbackEstimate.usage.estimatedOutputTokens);

  return {
    script,
    costLine: {
      provider: 'openai',
      model: OPENAI_SCRIPT_GENERATION_MODEL,
      step: 'script_generation',
      usage: {
        inputTokens,
        outputTokens,
        totalTokens: completion.usage?.total_tokens ?? inputTokens + outputTokens,
        preferredLengthSeconds,
      },
      costUsd: roundCost(costOpenAIModelText(OPENAI_SCRIPT_GENERATION_MODEL, inputTokens, outputTokens)),
    },
  };
}
