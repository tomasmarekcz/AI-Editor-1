import OpenAI from 'openai';
import type { ChatCompletion } from 'openai/resources/chat/completions';
import { OPENAI_TOPIC_BRAINSTORM_MODEL } from '@/lib/models';

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

function parseTopicsResponse(raw: string): string[] {
  const content = raw.trim();
  if (!content) {
    throw new Error('OpenAI returned an empty topic response');
  }

  let jsonText = content;
  if (!jsonText.startsWith('{')) {
    const start = jsonText.indexOf('{');
    const end = jsonText.lastIndexOf('}');
    if (start >= 0 && end > start) {
      jsonText = jsonText.slice(start, end + 1);
    }
  }

  let parsed: { topics?: unknown[] };
  try {
    parsed = JSON.parse(jsonText) as { topics?: unknown[] };
  } catch (err) {
    console.error('[brainstorm-topics] invalid JSON response:', content.slice(0, 500));
    throw new Error(`OpenAI returned invalid topic JSON: ${err instanceof Error ? err.message : String(err)}`);
  }

  return (parsed.topics ?? [])
    .map((topic) => String(topic).trim())
    .filter(Boolean)
    .slice(0, 5);
}

async function callTopicModel(systemPrompt: string, userPrompt: string, maxTokens: number) {
  const completion = await openai.chat.completions.create({
    model: OPENAI_TOPIC_BRAINSTORM_MODEL,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt },
    ],
    response_format: { type: 'json_object' },
    reasoning_effort: 'low',
    max_completion_tokens: maxTokens,
  } as Parameters<typeof openai.chat.completions.create>[0]) as ChatCompletion;

  const finishReason = completion.choices[0]?.finish_reason;
  if (finishReason === 'length') {
    console.warn('[brainstorm-topics] response hit max_completion_tokens');
  }
  if (finishReason && finishReason !== 'stop') {
    console.warn(`[brainstorm-topics] finish_reason=${finishReason}`);
  }
  return completion.choices[0]?.message?.content ?? '';
}

export async function brainstormVideoTopics({
  projectName,
  projectNiche,
  projectLanguage,
  defaultProjectPrompt,
  recentScripts,
  rejectedTopics,
}: {
  projectName: string;
  projectNiche: string;
  projectLanguage: string;
  defaultProjectPrompt?: string;
  recentScripts: string[];
  rejectedTopics?: string[];
}): Promise<string[]> {
  const systemPrompt = `You are a viral short-form video strategist for TikTok, Instagram Reels, and YouTube Shorts.

Generate exactly 5 fresh video topic ideas.

Rules:
- Each topic must be 1-2 sentences.
- Each topic should describe what the video could be about, not write the full script.
- Make the ideas high-curiosity, emotional, useful, surprising, or contrarian.
- Do not repeat the same topic, angle, fact pattern, or story from previous videos.
- Do not use any rejected topic.
- Return ONLY valid JSON: {"topics": ["topic 1", "topic 2", "topic 3", "topic 4", "topic 5"]}`;

  const previousScripts = recentScripts.length > 0
    ? recentScripts.map((script, index) => `Previous video ${index + 1}:\n${script}`).join('\n\n---\n\n')
    : 'No previous videos in the last 60 days.';

  const rejected = rejectedTopics?.length
    ? rejectedTopics.map((topic, index) => `${index + 1}. ${topic}`).join('\n')
    : 'None';

  const userPrompt = `Project name:
${projectName}

Project niche:
${projectNiche}

Project language:
${projectLanguage}

Default project prompt:
${defaultProjectPrompt || 'None'}

Previous video scripts from the last 60 days:
${previousScripts}

Rejected topics that must not be reused:
${rejected}

Generate the 5 topic ideas in the project language.`;

  let topics: string[] = [];
  try {
    topics = parseTopicsResponse(await callTopicModel(systemPrompt, userPrompt, 4096));
  } catch (err) {
    console.warn('[brainstorm-topics] first attempt failed, retrying with compact prompt:', err);
    const compactUserPrompt = `Project: ${projectName}
Niche: ${projectNiche}
Language: ${projectLanguage}
Default prompt: ${defaultProjectPrompt || 'None'}
Avoid previous/rejected topics based on this context:
${[previousScripts, rejected].join('\n\n').slice(0, 6000)}

Return exactly 5 new viral short-form video topic ideas as JSON: {"topics":["..."]}`;
    topics = parseTopicsResponse(await callTopicModel(systemPrompt, compactUserPrompt, 8192));
  }

  if (topics.length === 0) throw new Error('OpenAI returned no topic ideas');
  return topics;
}
