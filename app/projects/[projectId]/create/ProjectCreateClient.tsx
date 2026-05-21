'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { estimateScriptGenerationCost, formatUsd, type CostLine } from '@/lib/pricing';
import { mergeVideoSettings } from '@/lib/projects/defaults';
import type { Project, ProjectCreateVideoItem } from '@/lib/projects/types';

type GenerateScriptResponse = {
  script?: string;
  costLine?: CostLine;
  error?: string;
};

type BrainstormResponse = {
  topics?: string[];
  error?: string;
};

function formatDuration(sec: number | null): string {
  if (!sec) return '-';
  const m = Math.floor(sec / 60);
  const s = Math.round(sec % 60);
  return m > 0 ? `${m}m ${s}s` : `${s}s`;
}

async function readApiError(res: Response) {
  try {
    const data = await res.json() as { error?: string };
    return data.error ?? `HTTP ${res.status}`;
  } catch {
    return `HTTP ${res.status}`;
  }
}

export function ProjectCreateClient({
  project,
  videos,
}: {
  project: Project;
  videos: ProjectCreateVideoItem[];
}) {
  const router = useRouter();
  const [script, setScript] = useState('');
  const [description, setDescription] = useState('');
  const [preferredLengthSeconds, setPreferredLengthSeconds] = useState(30);
  const [isGenerating, setIsGenerating] = useState(false);
  const [isBrainstorming, setIsBrainstorming] = useState(false);
  const [topics, setTopics] = useState<string[]>([]);
  const [rejectedTopics, setRejectedTopics] = useState<string[]>([]);
  const [topicError, setTopicError] = useState('');
  const [error, setError] = useState('');

  const scriptEstimate = useMemo(() => estimateScriptGenerationCost({
    description,
    preferredLengthSeconds,
    projectName: project.name,
    projectNiche: project.niche,
    projectLanguage: project.language,
    voiceStyle: project.voice_style,
    defaultProjectPrompt: project.default_project_prompt,
  }), [
    description,
    preferredLengthSeconds,
    project.name,
    project.niche,
    project.language,
    project.voice_style,
    project.default_project_prompt,
  ]);

  async function openDashboardWithScript(nextScript: string, scriptGenerationCostLines: CostLine[] = []) {
    const cleanScript = nextScript.trim();
    if (!cleanScript) return;
    setIsGenerating(true);
    setError('');

    try {
      const res = await fetch('/api/videos/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          projectId: project.id,
          script: cleanScript,
          settings: mergeVideoSettings(project.default_settings),
          scriptGenerationCostLines,
        }),
      });
      const data = await res.json() as { videoId?: string; error?: string };
      if (!res.ok || data.error || !data.videoId) {
        throw new Error(data.error ?? await readApiError(res));
      }
      router.push(`/dashboard?project=${project.id}&resumeVideo=${data.videoId}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsGenerating(false);
    }
  }

  async function generateFromPrompt(promptOverride?: string) {
    const prompt = (promptOverride ?? description).trim();
    if (!prompt || isGenerating) return;
    setIsGenerating(true);
    setError('');

    try {
      const res = await fetch(`/api/projects/${project.id}/generate-script`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          description: prompt,
          preferredLengthSeconds,
        }),
      });
      const data = await res.json() as GenerateScriptResponse;
      if (!res.ok || data.error || !data.script) {
        throw new Error(data.error ?? await readApiError(res));
      }

      await openDashboardWithScript(data.script, data.costLine ? [data.costLine] : [scriptEstimate]);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsGenerating(false);
    }
  }

  async function brainstormTopics(regenerate = false) {
    if (isBrainstorming) return;
    setIsBrainstorming(true);
    setTopicError('');
    const blockedTopics = regenerate ? [...rejectedTopics, ...topics] : rejectedTopics;

    try {
      const res = await fetch(`/api/projects/${project.id}/brainstorm-topics`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rejectedTopics: blockedTopics }),
      });
      const data = await res.json() as BrainstormResponse;
      if (!res.ok || data.error || !data.topics?.length) {
        throw new Error(data.error ?? await readApiError(res));
      }
      if (regenerate && topics.length > 0) {
        setRejectedTopics(blockedTopics);
      }
      setTopics(data.topics);
    } catch (err) {
      setTopicError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsBrainstorming(false);
    }
  }

  return (
    <main className="px-4 py-8">
      <div className="mx-auto max-w-7xl">
        <section className="mb-8 max-w-3xl">
          <h1 className="text-4xl font-black tracking-normal text-white">
            Start a new video
          </h1>
          <p className="mt-3 text-sm leading-6 text-gray-400">
            Choose whether you already have a script or want the app to draft one from your idea.
          </p>
        </section>

        <section className="grid gap-5 lg:grid-cols-2">
          <article className="flex min-h-[460px] flex-col rounded-lg border border-gray-800 bg-gray-900/80 p-5">
            <div>
              <p className="text-xs font-black uppercase tracking-[0.22em] text-cyan-300">
                Generate Video From Script
              </p>
              <h2 className="mt-2 text-2xl font-black tracking-normal text-white">
                Paste your finished script
              </h2>
            </div>

            <textarea
              value={script}
              onChange={(event) => setScript(event.target.value)}
              placeholder="Place your script here"
              className="mt-5 min-h-64 flex-1 resize-none rounded-lg border border-gray-700 bg-gray-950 px-4 py-3 text-sm leading-6 text-white outline-none transition placeholder:text-gray-600 focus:border-cyan-400"
            />

            <div className="mt-3">
              <button
                onClick={() => brainstormTopics(false)}
                disabled={isBrainstorming || isGenerating}
                className="rounded-lg border border-purple-700 bg-purple-500/10 px-3 py-2 text-xs font-bold uppercase tracking-[0.14em] text-purple-200 transition hover:border-purple-400 hover:bg-purple-500/20 disabled:cursor-not-allowed disabled:border-gray-800 disabled:text-gray-600"
              >
                {isBrainstorming ? 'Brainstorming...' : 'Brainstorm video idea with AI'}
              </button>
            </div>

            {(topics.length > 0 || topicError) && (
              <div className="mt-4 rounded-lg border border-gray-800 bg-gray-950 p-3">
                <div className="flex items-center justify-between gap-3">
                  <p className="text-xs font-bold uppercase tracking-[0.18em] text-purple-300">
                    Topic ideas
                  </p>
                  {topics.length > 0 && (
                    <button
                      onClick={() => brainstormTopics(true)}
                      disabled={isBrainstorming || isGenerating}
                      className="text-[11px] font-bold text-gray-500 transition hover:text-purple-200 disabled:text-gray-700"
                    >
                      Regenerate new topics
                    </button>
                  )}
                </div>
                {topicError && (
                  <p className="mt-2 rounded-lg border border-red-900 bg-red-950/40 px-3 py-2 text-xs text-red-200">
                    {topicError}
                  </p>
                )}
                {topics.length > 0 && (
                  <div className="mt-3 grid gap-2">
                    {topics.map((topic, index) => (
                      <button
                        key={`${topic}-${index}`}
                        onClick={() => {
                          setDescription(topic);
                          void generateFromPrompt(topic);
                        }}
                        disabled={isGenerating}
                        className="rounded-lg border border-gray-800 bg-gray-900 px-3 py-2 text-left text-xs leading-5 text-gray-300 transition hover:border-purple-500 hover:bg-purple-950/50 hover:text-white disabled:cursor-not-allowed disabled:opacity-60"
                      >
                        {topic}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}

            <button
              onClick={() => void openDashboardWithScript(script)}
              disabled={!script.trim() || isGenerating}
              className="mt-5 rounded-lg bg-cyan-400 px-5 py-3 text-sm font-black uppercase tracking-[0.16em] text-gray-950 transition hover:bg-cyan-300 disabled:cursor-not-allowed disabled:bg-gray-800 disabled:text-gray-600"
            >
              {isGenerating ? 'Opening...' : 'Generate Video From Script'}
            </button>
          </article>

          <article className="flex min-h-[460px] flex-col rounded-lg border border-gray-800 bg-gray-900/80 p-5">
            <div>
              <p className="text-xs font-black uppercase tracking-[0.22em] text-purple-300">
                Generate Video From Prompt
              </p>
              <h2 className="mt-2 text-2xl font-black tracking-normal text-white">
                Turn an idea into a script
              </h2>
            </div>

            <textarea
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              placeholder="Describe what your video should be about"
              className="mt-5 min-h-44 resize-none rounded-lg border border-gray-700 bg-gray-950 px-4 py-3 text-sm leading-6 text-white outline-none transition placeholder:text-gray-600 focus:border-purple-400"
            />

            <div className="mt-5 rounded-lg border border-gray-800 bg-gray-950 px-4 py-3">
              <div className="flex items-center justify-between gap-4">
                <label htmlFor="preferred-length" className="text-xs font-bold uppercase tracking-[0.18em] text-gray-500">
                  Preferred length
                </label>
                <span className="text-sm font-black text-white">{preferredLengthSeconds}s</span>
              </div>
              <input
                id="preferred-length"
                type="range"
                min={20}
                max={60}
                step={5}
                value={preferredLengthSeconds}
                onChange={(event) => setPreferredLengthSeconds(Number(event.target.value))}
                className="mt-3 w-full accent-purple-500"
              />
              <div className="mt-2 flex justify-between text-[11px] text-gray-600">
                <span>20s</span>
                <span>60s</span>
              </div>
            </div>

            <div className="mt-4 rounded-lg border border-purple-900/60 bg-purple-950/20 px-4 py-3">
              <p className="text-xs font-bold uppercase tracking-[0.18em] text-purple-300">
                Estimated script cost
              </p>
              <p className="mt-1 text-2xl font-black text-purple-100">
                {formatUsd(scriptEstimate.costUsd)}
              </p>
            </div>

            {error && (
              <p className="mt-4 rounded-lg border border-red-800 bg-red-950/50 px-3 py-2 text-sm text-red-200">
                {error}
              </p>
            )}

            <button
              onClick={() => generateFromPrompt()}
              disabled={!description.trim() || isGenerating}
              className="mt-auto rounded-lg bg-purple-500 px-5 py-3 text-sm font-black uppercase tracking-[0.16em] text-white transition hover:bg-purple-400 disabled:cursor-not-allowed disabled:bg-gray-800 disabled:text-gray-600"
            >
              {isGenerating ? 'Generating script...' : 'Generate Video From Prompt'}
            </button>
          </article>
        </section>

        <section className="mt-10">
          <div className="mb-3 flex items-center justify-between gap-3">
            <div>
              <p className="text-xs font-black uppercase tracking-[0.22em] text-gray-500">
                Previous Videos
              </p>
              <h2 className="mt-1 text-xl font-black text-white">Project history</h2>
            </div>
            <Link
              href={`/videos?project=${project.id}`}
              className="rounded-lg border border-gray-700 px-3 py-2 text-xs font-bold uppercase tracking-[0.14em] text-gray-300 transition hover:border-cyan-400 hover:text-cyan-200"
            >
              View all
            </Link>
          </div>

          {videos.length === 0 ? (
            <div className="rounded-lg border border-gray-800 bg-gray-900/60 p-6 text-sm text-gray-500">
              No videos yet for this project.
            </div>
          ) : (
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
              {videos.map((video) => (
                <article key={video.id} className="overflow-hidden rounded-lg border border-gray-800 bg-gray-900/70">
                  <div className="relative aspect-video bg-gray-950">
                    {video.thumbnailUrl ? (
                      <img src={video.thumbnailUrl} alt="" className="h-full w-full object-cover" />
                    ) : (
                      <div className="flex h-full items-center justify-center text-xs text-gray-700">
                        {video.status}
                      </div>
                    )}
                    <span className={`absolute right-2 top-2 rounded px-2 py-0.5 text-[10px] font-bold uppercase ${
                      video.status === 'done'
                        ? 'bg-emerald-500/15 text-emerald-300'
                        : video.status === 'failed'
                          ? 'bg-red-500/15 text-red-300'
                          : 'bg-cyan-500/15 text-cyan-300'
                    }`}>
                      {video.status}
                    </span>
                    {video.status !== 'done' && video.status !== 'failed' && (
                      <div className="absolute inset-x-0 bottom-0 h-1 bg-gray-800">
                        <div className="h-full bg-cyan-400" style={{ width: `${video.render_progress}%` }} />
                      </div>
                    )}
                  </div>
                  <div className="p-3">
                    <h3 className="line-clamp-2 text-sm font-bold leading-snug text-white">{video.title}</h3>
                    <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-gray-500">
                      <span>{new Date(video.created_at).toLocaleDateString('cs-CZ')}</span>
                      <span>{formatDuration(video.duration_seconds)}</span>
                      {(video.actual_cost_usd ?? video.estimated_cost_usd) != null && (
                        <span>{formatUsd(video.actual_cost_usd ?? video.estimated_cost_usd)}</span>
                      )}
                    </div>
                    {video.error_message && (
                      <p className="mt-2 line-clamp-2 text-[10px] text-red-300">{video.error_message}</p>
                    )}
                    <div className="mt-3 flex flex-wrap gap-2">
                      <Link
                        href={`/videos/${video.id}`}
                        className="min-w-[76px] flex-1 rounded-lg border border-gray-700 px-3 py-2 text-center text-xs font-bold text-gray-300 transition hover:border-cyan-400 hover:text-cyan-200"
                      >
                        Detail
                      </Link>
                      {video.status === 'done' && (
                        <>
                          <Link
                            href={`/videos/${video.id}/publish`}
                            className="min-w-[132px] flex-1 rounded-lg border border-purple-800 bg-purple-500/10 px-3 py-2 text-center text-xs font-bold text-purple-200 transition hover:border-purple-500 hover:bg-purple-500/20"
                          >
                            Schedule Publishing
                          </Link>
                          <Link
                            href={`/videos/${video.id}/edit`}
                            className="min-w-[76px] flex-1 rounded-lg border border-cyan-800 bg-cyan-600/10 px-3 py-2 text-center text-xs font-bold text-cyan-300 transition hover:border-cyan-500 hover:bg-cyan-500/20"
                          >
                            Edit
                          </Link>
                        </>
                      )}
                      {video.status !== 'done' && (
                        <Link
                          href={`/dashboard?project=${project.id}&resumeVideo=${video.id}`}
                          className="min-w-[76px] flex-1 rounded-lg border border-amber-700 bg-amber-500/10 px-3 py-2 text-center text-xs font-bold text-amber-200 transition hover:border-amber-400 hover:bg-amber-500/20"
                        >
                          Navázat
                        </Link>
                      )}
                    </div>
                  </div>
                </article>
              ))}
            </div>
          )}
        </section>
      </div>
    </main>
  );
}
