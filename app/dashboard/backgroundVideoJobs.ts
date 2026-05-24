'use client';

import { useSyncExternalStore } from 'react';
import type { ImageGenMode, SegmentData, VideoSettings } from '@/types';

export type BackgroundVideoJobPhase =
  | 'generating-images'
  | 'reviewing-images'
  | 'awaiting-approval'
  | 'queued'
  | 'rendering'
  | 'ready'
  | 'error';

export type BackgroundVideoJob = {
  videoId: string;
  projectId: string;
  projectName: string;
  title: string;
  phase: BackgroundVideoJobPhase;
  status: string;
  doneCount: number;
  totalCount: number;
  segments: SegmentData[];
  minimized: boolean;
  error?: string;
  updatedAt: number;
};

type StartImageJobInput = {
  videoId: string;
  projectId: string;
  projectName: string;
  title: string;
  segments: SegmentData[];
  settings: Pick<VideoSettings, 'imageSource' | 'orientation' | 'aiImageReview'>;
};

const MAX_BACKGROUND_VIDEO_JOBS = 5;
const listeners = new Set<() => void>();
const jobs = new Map<string, BackgroundVideoJob>();
const runningImageJobs = new Set<string>();
let cachedSnapshot: BackgroundVideoJob[] = [];

function rebuildSnapshot() {
  cachedSnapshot = [...jobs.values()].sort((a, b) => b.updatedAt - a.updatedAt);
}

function emit() {
  rebuildSnapshot();
  for (const listener of listeners) listener();
}

function snapshot() {
  return cachedSnapshot;
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function updateJob(videoId: string, patch: Partial<BackgroundVideoJob>) {
  const current = jobs.get(videoId);
  if (!current) return;
  jobs.set(videoId, { ...current, ...patch, updatedAt: Date.now() });
  emit();
}

async function readApiError(res: Response) {
  try {
    const data = await res.json() as { error?: string };
    return data.error ?? `HTTP ${res.status}`;
  } catch {
    return `HTTP ${res.status}`;
  }
}

function initialReviewSegments(segments: SegmentData[]) {
  return segments.map((segment) => (
    segment.localImagePath
      ? segment
      : { ...segment, reviewing: true } as SegmentData
  ));
}

export function useBackgroundVideoJobs() {
  return useSyncExternalStore(subscribe, snapshot, snapshot);
}

export function getBackgroundVideoJob(videoId: string) {
  return jobs.get(videoId) ?? null;
}

export function setBackgroundVideoJobMinimized(videoId: string, minimized: boolean) {
  updateJob(videoId, { minimized });
}

export function removeBackgroundVideoJob(videoId: string) {
  jobs.delete(videoId);
  emit();
}

export function setBackgroundVideoJobPhase(
  videoId: string,
  phase: BackgroundVideoJobPhase,
  status: string,
  patch: Partial<BackgroundVideoJob> = {},
) {
  updateJob(videoId, { phase, status, ...patch });
}

export function canStartBackgroundVideoJob(videoId?: string) {
  if (videoId && jobs.has(videoId)) return true;
  return jobs.size < MAX_BACKGROUND_VIDEO_JOBS;
}

export function startBackgroundImageJob(input: StartImageJobInput) {
  if (runningImageJobs.has(input.videoId)) return { ok: true as const, existing: true };
  if (!jobs.has(input.videoId) && jobs.size >= MAX_BACKGROUND_VIDEO_JOBS) {
    return { ok: false as const, error: `Maximum ${MAX_BACKGROUND_VIDEO_JOBS} background videos can run at once.` };
  }

  jobs.set(input.videoId, {
    videoId: input.videoId,
    projectId: input.projectId,
    projectName: input.projectName,
    title: input.title,
    phase: 'generating-images',
    status: 'Generují se obrázky',
    doneCount: input.segments.filter((segment) => segment.localImagePath).length,
    totalCount: input.segments.length,
    segments: initialReviewSegments(input.segments),
    minimized: false,
    updatedAt: Date.now(),
  });
  runningImageJobs.add(input.videoId);
  emit();

  void runImageJob(input);
  return { ok: true as const, existing: false };
}

async function runImageJob(input: StartImageJobInput) {
  try {
    const res = await fetch('/api/images', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        projectId: input.projectId,
        videoId: input.videoId,
        segments: input.segments,
        settings: input.settings,
      }),
    });
    if (!res.ok || !res.body) throw new Error(await readApiError(res));

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buf = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      const lines = buf.split('\n');
      buf = lines.pop() ?? '';

      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;
        const ev = JSON.parse(line.slice(6)) as Record<string, unknown>;
        handleImageEvent(input.videoId, ev);
      }
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    updateJob(input.videoId, {
      phase: 'error',
      status: 'Generování se zastavilo',
      error: message,
    });
  } finally {
    runningImageJobs.delete(input.videoId);
  }
}

function handleImageEvent(videoId: string, ev: Record<string, unknown>) {
  const job = jobs.get(videoId);
  if (!job) return;

  if (ev.type === 'step') {
    updateJob(videoId, {
      phase: 'generating-images',
      status: typeof ev.message === 'string' ? ev.message : 'Generují se obrázky',
    });
    return;
  }

  if (ev.type === 'reviewing') {
    const index = Number(ev.index);
    updateJob(videoId, {
      phase: 'reviewing-images',
      status: 'Probíhá AI Image Review',
      segments: job.segments.map((segment, i) => (
        i === index ? { ...segment, reviewing: true } as SegmentData : segment
      )),
    });
    return;
  }

  if (ev.type === 'image_ready') {
    const index = Number(ev.index);
    const nextSegments = job.segments.map((segment, i) => (
      i === index
        ? {
            ...segment,
            localImagePath: String(ev.imageUrl ?? ''),
            imagePrompt: typeof ev.prompt === 'string' ? ev.prompt : segment.imagePrompt,
            imageGenMode: (ev.mode === 'google' || ev.mode === 'imagen' ? ev.mode : segment.imageGenMode) as ImageGenMode | undefined,
            imageFallbackReason: typeof ev.fallbackReason === 'string' ? ev.fallbackReason : segment.imageFallbackReason,
            attempts: typeof ev.attempts === 'number' ? ev.attempts : undefined,
            reviewing: false,
          } as SegmentData
        : segment
    ));
    updateJob(videoId, {
      phase: 'generating-images',
      status: 'Generují se obrázky',
      doneCount: nextSegments.filter((segment) => segment.localImagePath).length,
      segments: nextSegments,
    });
    return;
  }

  if (ev.type === 'image_failed') {
    const index = Number(ev.index);
    updateJob(videoId, {
      segments: job.segments.map((segment, i) => (
        i === index
          ? {
              ...segment,
              imagePrompt: typeof ev.prompt === 'string' ? ev.prompt : segment.imagePrompt,
              imageGenMode: (ev.mode === 'google' || ev.mode === 'imagen' ? ev.mode : segment.imageGenMode) as ImageGenMode | undefined,
              imageError: typeof ev.error === 'string' ? ev.error : undefined,
              reviewing: false,
            } as SegmentData
          : segment
      )),
    });
    return;
  }

  if (ev.type === 'done') {
    const serverSegments = Array.isArray(ev.segments) ? ev.segments as SegmentData[] : job.segments;
    updateJob(videoId, {
      phase: 'awaiting-approval',
      status: 'Čeká na schválení',
      doneCount: serverSegments.filter((segment) => segment.localImagePath).length,
      totalCount: serverSegments.length,
      segments: serverSegments,
    });
    return;
  }

  if (ev.type === 'error') {
    updateJob(videoId, {
      phase: 'error',
      status: 'Generování se zastavilo',
      error: typeof ev.message === 'string' ? ev.message : 'Unknown image generation error',
    });
  }
}
