import path from 'path';
import type { SupabaseClient } from '@supabase/supabase-js';
import { v4 as uuidv4 } from 'uuid';
import { brainstormVideoTopics } from '@/lib/brainstormVideoTopics';
import { generateGeminiContent } from '@/lib/geminiApi';
import { generateVideoScriptFromPrompt } from '@/lib/generateVideoScript';
import { segmentScript } from '@/lib/segmentScript';
import { estimateVideoCost, type CostLine } from '@/lib/pricing';
import { insertUsageEvents, summarizeCostLines } from '@/lib/usage/record';
import { mergeVideoSettings } from '@/lib/projects/defaults';
import { triggerWorkerJob } from '@/lib/worker/trigger';
import { createSupabaseAdminClient } from '@/lib/supabase/admin';
import { searchImageCandidateDetails } from '@/lib/searchImages';
import { downloadImage } from '@/lib/downloadImage';
import { generateWithOpenAIImage, OPENAI_IMAGE_MODEL } from '@/lib/generateWithOpenAIImage';
import { rankGoogleImageCandidates } from '@/lib/selectGoogleImageCandidate';
import {
  costGeminiText,
  costOpenAIImage2Low,
  openAIImage2Usage,
  PRICING,
  roundCost,
} from '@/lib/pricing';
import {
  createSignedUrl,
  createStorageAdminClient,
  deleteVideoStorageAssets,
  uploadLocalAsset,
  VIDEO_ASSETS_BUCKET,
} from '@/lib/storage/videoAssets';
import { GEMINI_CAPTION_MODEL } from '@/lib/models';
import { validatePatch, applyPatchToSettings, applyPatchToSegments, listAppliedFields } from '@/lib/patchSchema';
import type { Project, SavedVideo } from '@/lib/projects/types';
import type { ImageGenMode, Orientation, SegmentData, VideoSettings } from '@/types';
import type { VideoEditPatch } from '@/types/editor';

export type AutomationToolContext = {
  supabase: SupabaseClient;
  userId: string;
  accountId: string;
  agentApiKeyId?: string;
  agentScopes?: string[];
  allowedProjectIds?: string[] | null;
};

export type ToolResult<T> = T & {
  ok: true;
};

export type QueueRenderResult = ToolResult<{
  videoId: string;
  status: 'queued';
  workerTriggered: boolean;
  workerTriggerSkipped: boolean;
  workerMessage: string | null;
  estimate: ReturnType<typeof estimateVideoCost>;
}>;

type VideoRow = Pick<
  SavedVideo,
  'id' | 'account_id' | 'project_id' | 'title' | 'status' | 'original_script' | 'settings' | 'segments' |
  'edited_settings' | 'edited_segments' | 'final_video_path' | 'thumbnail_path' | 'render_progress' | 'error_message'
>;

function nowIso() {
  return new Date().toISOString();
}

function restrictedProjectIds(ctx: AutomationToolContext) {
  return ctx.allowedProjectIds && ctx.allowedProjectIds.length > 0 ? ctx.allowedProjectIds : null;
}

function cleanTitle(script: string, fallback = 'Untitled video') {
  return script.replace(/\s+/g, ' ').trim().slice(0, 90) || fallback;
}

async function requireProject(ctx: AutomationToolContext, projectId: string) {
  const { data: project, error } = await ctx.supabase
    .from('projects')
    .select('*')
    .eq('id', projectId)
    .eq('account_id', ctx.accountId)
    .maybeSingle<Project>();

  if (error) throw error;
  if (!project) throw new Error('Project not found.');
  return project;
}

async function requireVideo(ctx: AutomationToolContext, videoId: string) {
  const { data: video, error } = await ctx.supabase
    .from('videos')
    .select('id,account_id,project_id,title,status,original_script,settings,segments,edited_settings,edited_segments,final_video_path,thumbnail_path,render_progress,error_message')
    .eq('id', videoId)
    .eq('account_id', ctx.accountId)
    .maybeSingle<VideoRow>();

  if (error) throw error;
  if (!video) throw new Error('Video not found.');
  return video;
}

async function recentVideoTitles(ctx: AutomationToolContext, projectId: string, days = 60) {
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
  const { data, error } = await ctx.supabase
    .from('videos')
    .select('title,created_at')
    .eq('project_id', projectId)
    .eq('account_id', ctx.accountId)
    .gte('created_at', since)
    .order('created_at', { ascending: false })
    .limit(50);

  if (error) throw error;
  return (data ?? []).map((video) => String(video.title ?? '').trim()).filter(Boolean);
}

async function updateActualCost(ctx: AutomationToolContext, videoId: string) {
  const { data: actualEvents, error } = await ctx.supabase
    .from('usage_events')
    .select('provider,model,step,usage,cost_usd')
    .eq('video_id', videoId)
    .eq('account_id', ctx.accountId)
    .eq('estimated', false);

  if (error) throw error;

  const allActualLines: CostLine[] = (actualEvents ?? []).map((event) => ({
    provider: String(event.provider),
    model: event.model ? String(event.model) : undefined,
    step: String(event.step),
    usage: (event.usage ?? {}) as Record<string, number | string | boolean>,
    costUsd: Number(event.cost_usd ?? 0),
  }));

  const { error: updateError } = await ctx.supabase
    .from('videos')
    .update({
      actual_cost_usd: roundCost(allActualLines.reduce((sum, line) => sum + line.costUsd, 0)),
      cost_breakdown: { actual: summarizeCostLines(allActualLines) },
      updated_at: nowIso(),
    })
    .eq('id', videoId)
    .eq('account_id', ctx.accountId);

  if (updateError) throw updateError;
}

export async function listProjectsTool(ctx: AutomationToolContext) {
  let query = ctx.supabase
    .from('projects')
    .select('*')
    .eq('account_id', ctx.accountId)
    .order('updated_at', { ascending: false });

  const projectIds = restrictedProjectIds(ctx);
  if (projectIds) query = query.in('id', projectIds);

  const { data, error } = await query;
  if (error) throw error;
  return { ok: true, projects: (data ?? []) as Project[] };
}

export async function getProjectTool(ctx: AutomationToolContext, input: { projectId: string }) {
  return { ok: true, project: await requireProject(ctx, input.projectId) };
}

export async function updateProjectDefaultsTool(
  ctx: AutomationToolContext,
  input: {
    projectId: string;
    defaultSettings?: Partial<VideoSettings>;
    defaultProjectPrompt?: string;
    visualStyle?: string;
    voiceStyle?: string;
    captionStyle?: string;
  },
) {
  await requireProject(ctx, input.projectId);
  const update: Record<string, unknown> = { updated_at: nowIso() };
  if (input.defaultSettings) update.default_settings = mergeVideoSettings(input.defaultSettings);
  if (typeof input.defaultProjectPrompt === 'string') update.default_project_prompt = input.defaultProjectPrompt;
  if (typeof input.visualStyle === 'string') update.visual_style = input.visualStyle;
  if (typeof input.voiceStyle === 'string') update.voice_style = input.voiceStyle;
  if (typeof input.captionStyle === 'string') update.caption_style = input.captionStyle;

  const { data, error } = await ctx.supabase
    .from('projects')
    .update(update)
    .eq('id', input.projectId)
    .eq('account_id', ctx.accountId)
    .select('*')
    .single<Project>();

  if (error) throw error;
  return { ok: true, project: data };
}

export async function brainstormTopicsTool(
  ctx: AutomationToolContext,
  input: { projectId: string; rejectedTopics?: string[]; recentDays?: number },
) {
  const project = await requireProject(ctx, input.projectId);
  const topics = await brainstormVideoTopics({
    projectName: project.name,
    projectNiche: project.niche,
    projectLanguage: project.language,
    defaultProjectPrompt: project.default_project_prompt,
    recentVideoTitles: await recentVideoTitles(ctx, project.id, input.recentDays ?? 60),
    rejectedTopics: (input.rejectedTopics ?? []).map(String).filter(Boolean),
  });
  return { ok: true, topics };
}

export async function selectTopicTool(
  _ctx: AutomationToolContext,
  input: { topics: string[]; rejectedTopics?: string[] },
) {
  const rejected = new Set((input.rejectedTopics ?? []).map((topic) => topic.trim().toLowerCase()));
  const topic = input.topics
    .map((candidate) => candidate.trim())
    .find((candidate) => candidate && !rejected.has(candidate.toLowerCase()));

  if (!topic) throw new Error('No usable topic was found.');
  return { ok: true, topic };
}

export async function generateScriptTool(
  ctx: AutomationToolContext,
  input: { projectId: string; description: string; preferredLengthSeconds?: number },
) {
  const project = await requireProject(ctx, input.projectId);
  const length = Math.max(20, Math.min(60, Math.round(Number(input.preferredLengthSeconds) || 30)));
  const result = await generateVideoScriptFromPrompt({
    description: input.description.trim(),
    preferredLengthSeconds: length,
    project: {
      name: project.name,
      niche: project.niche,
      language: project.language,
      voiceStyle: project.voice_style,
      defaultProjectPrompt: project.default_project_prompt,
    },
  });
  return { ok: true, script: result.script, costLine: result.costLine };
}

export async function segmentScriptTool(
  _ctx: AutomationToolContext,
  input: { script: string; chunkSize?: number; segmentDuration?: 'auto' | number },
) {
  const segments = await segmentScript(input.script, input.chunkSize ?? 3, input.segmentDuration ?? 'auto');
  return { ok: true, segments };
}

export async function createVideoRecordTool(
  ctx: AutomationToolContext,
  input: {
    projectId: string;
    script: string;
    settings?: Partial<VideoSettings>;
    title?: string;
    scriptGenerationCostLines?: CostLine[];
  },
) {
  const project = await requireProject(ctx, input.projectId);
  const settings = mergeVideoSettings(input.settings ?? project.default_settings);
  const safeScriptLines = (input.scriptGenerationCostLines ?? [])
    .filter((line) => line.step === 'script_generation')
    .slice(0, 1);
  const estimate = estimateVideoCost(input.script, settings, safeScriptLines);

  const { data: video, error } = await ctx.supabase
    .from('videos')
    .insert({
      user_id: ctx.userId,
      account_id: ctx.accountId,
      project_id: project.id,
      title: input.title?.trim() || cleanTitle(input.script),
      status: 'generating',
      current_step: 'script_saved',
      original_script: input.script,
      settings,
      estimated_cost_usd: estimate.totalUsd,
      estimated_usage: estimate.usage,
      cost_breakdown: { estimated: summarizeCostLines(estimate.lines) },
    })
    .select('id')
    .single<{ id: string }>();

  if (error || !video) throw error ?? new Error('Could not create video.');

  await insertUsageEvents({
    supabase: ctx.supabase,
    userId: ctx.userId,
    accountId: ctx.accountId,
    projectId: project.id,
    videoId: video.id,
    lines: estimate.lines,
    estimated: true,
  });

  return { ok: true, videoId: video.id, estimate };
}

export async function queueRenderTool(
  ctx: AutomationToolContext,
  input: {
    projectId: string;
    segments: SegmentData[];
    settings?: Partial<VideoSettings>;
    originalScript?: string;
    videoId?: string;
    scriptGenerationCostLines?: CostLine[];
    triggerWorker?: boolean;
  },
): Promise<QueueRenderResult> {
  if (!input.segments.length) throw new Error('segments are required.');
  const project = await requireProject(ctx, input.projectId);
  const settings = mergeVideoSettings(input.settings ?? project.default_settings);
  const script = input.originalScript ?? input.segments.map((segment) => segment.text).join('\n\n');
  const safeScriptLines = (input.scriptGenerationCostLines ?? [])
    .filter((line) => line.step === 'script_generation')
    .slice(0, 1);
  const estimate = estimateVideoCost(script, settings, safeScriptLines);
  const queuedAt = nowIso();
  let videoId = input.videoId;
  let createdNewVideo = false;

  if (videoId) {
    const existing = await requireVideo(ctx, videoId);
    if (existing.project_id !== project.id) throw new Error('Video does not belong to this project.');
  }

  if (!videoId) {
    const { data: video, error } = await ctx.supabase
      .from('videos')
      .insert({
        user_id: ctx.userId,
        account_id: ctx.accountId,
        project_id: project.id,
        title: cleanTitle(script),
        status: 'queued',
        current_step: 'queued',
        queued_at: queuedAt,
        original_script: script,
        settings,
        segments: input.segments,
        render_progress: 0,
        estimated_cost_usd: estimate.totalUsd,
        estimated_usage: estimate.usage,
        cost_breakdown: { estimated: summarizeCostLines(estimate.lines) },
      })
      .select('id')
      .single<{ id: string }>();

    if (error || !video) throw error ?? new Error('Could not create queued video.');
    videoId = video.id;
    createdNewVideo = true;
  } else {
    const { error } = await ctx.supabase
      .from('videos')
      .update({
        title: cleanTitle(script),
        status: 'queued',
        current_step: 'queued',
        queued_at: queuedAt,
        processing_started_at: null,
        locked_at: null,
        worker_id: null,
        last_worker_error: null,
        original_script: script,
        settings,
        segments: input.segments,
        render_progress: 0,
        error_message: null,
        estimated_cost_usd: estimate.totalUsd,
        estimated_usage: estimate.usage,
        cost_breakdown: { estimated: summarizeCostLines(estimate.lines) },
        updated_at: queuedAt,
      })
      .eq('id', videoId)
      .eq('account_id', ctx.accountId);

    if (error) throw error;
  }

  if (createdNewVideo) {
    await insertUsageEvents({
      supabase: ctx.supabase,
      userId: ctx.userId,
      accountId: ctx.accountId,
      projectId: project.id,
      videoId,
      lines: estimate.lines,
      estimated: true,
    });
  }

  const worker = input.triggerWorker === false
    ? { ok: false, skipped: true, message: 'Worker trigger skipped by caller.' }
    : await triggerWorkerJob(videoId);

  if (!worker.ok) {
    await ctx.supabase
      .from('videos')
      .update({ last_worker_error: worker.message, updated_at: nowIso() })
      .eq('id', videoId)
      .eq('account_id', ctx.accountId);
  }

  return {
    ok: true,
    videoId,
    status: 'queued',
    workerTriggered: worker.ok,
    workerTriggerSkipped: worker.skipped,
    workerMessage: worker.message,
    estimate,
  };
}

export async function createVideoFromPromptTool(
  ctx: AutomationToolContext,
  input: {
    projectId: string;
    description: string;
    preferredLengthSeconds?: number;
    settings?: Partial<VideoSettings>;
    triggerWorker?: boolean;
  },
) {
  const scriptResult = await generateScriptTool(ctx, input);
  const settings = mergeVideoSettings(input.settings ?? (await requireProject(ctx, input.projectId)).default_settings);
  const segments = await segmentScript(
    scriptResult.script,
    settings.subtitle.chunkSize,
    settings.segmentDuration,
  );
  const queued = await queueRenderTool(ctx, {
    projectId: input.projectId,
    originalScript: scriptResult.script,
    settings,
    segments,
    scriptGenerationCostLines: [scriptResult.costLine],
    triggerWorker: input.triggerWorker,
  });

  return {
    ...queued,
    topic: input.description,
    script: scriptResult.script,
    costLine: scriptResult.costLine,
    segments,
  };
}

export async function createVideoFromScriptTool(
  ctx: AutomationToolContext,
  input: {
    projectId: string;
    script: string;
    settings?: Partial<VideoSettings>;
    triggerWorker?: boolean;
    scriptGenerationCostLines?: CostLine[];
  },
) {
  const project = await requireProject(ctx, input.projectId);
  const settings = mergeVideoSettings(input.settings ?? project.default_settings);
  const segments = await segmentScript(input.script, settings.subtitle.chunkSize, settings.segmentDuration);
  const queued = await queueRenderTool(ctx, {
    projectId: project.id,
    originalScript: input.script,
    settings,
    segments,
    scriptGenerationCostLines: input.scriptGenerationCostLines,
    triggerWorker: input.triggerWorker,
  });
  return { ...queued, segments };
}

export async function listVideosTool(
  ctx: AutomationToolContext,
  input: { projectId?: string; limit?: number; status?: string } = {},
) {
  let query = ctx.supabase
    .from('videos')
    .select('id,title,status,project_id,created_at,completed_at,render_progress,final_video_path,thumbnail_path,error_message,estimated_cost_usd,actual_cost_usd')
    .eq('account_id', ctx.accountId)
    .order('created_at', { ascending: false })
    .limit(Math.max(1, Math.min(100, input.limit ?? 30)));

  if (input.projectId) query = query.eq('project_id', input.projectId);
  const projectIds = restrictedProjectIds(ctx);
  if (!input.projectId && projectIds) query = query.in('project_id', projectIds);
  if (input.status) query = query.eq('status', input.status);

  const { data, error } = await query;
  if (error) throw error;
  return { ok: true, videos: data ?? [] };
}

export async function getVideoTool(ctx: AutomationToolContext, input: { videoId: string; signedUrls?: boolean }) {
  const video = await requireVideo(ctx, input.videoId);
  const finalVideoUrl = input.signedUrls && video.final_video_path
    ? await createSignedUrl(ctx.supabase, video.final_video_path)
    : null;
  const thumbnailUrl = input.signedUrls && video.thumbnail_path
    ? await createSignedUrl(ctx.supabase, video.thumbnail_path)
    : null;

  return { ok: true, video, finalVideoUrl, thumbnailUrl };
}

export async function getVideoStatusTool(ctx: AutomationToolContext, input: { videoId: string }) {
  const video = await requireVideo(ctx, input.videoId);
  return {
    ok: true,
    videoId: video.id,
    status: video.status,
    renderProgress: video.render_progress,
    errorMessage: video.error_message,
    finalVideoPath: video.final_video_path,
    thumbnailPath: video.thumbnail_path,
  };
}

export async function listVideoAssetsTool(ctx: AutomationToolContext, input: { videoId: string; signedUrls?: boolean }) {
  await requireVideo(ctx, input.videoId);
  const { data, error } = await ctx.supabase
    .from('video_assets')
    .select('*')
    .eq('video_id', input.videoId)
    .eq('account_id', ctx.accountId)
    .order('created_at', { ascending: false });

  if (error) throw error;
  const assets = await Promise.all((data ?? []).map(async (asset) => ({
    ...asset,
    signedUrl: input.signedUrls && asset.storage_path
      ? await createSignedUrl(ctx.supabase, String(asset.storage_path))
      : null,
  })));
  return { ok: true, assets };
}

export async function listWorkerLogsTool(ctx: AutomationToolContext, input: { videoId: string; limit?: number }) {
  await requireVideo(ctx, input.videoId);
  const { data, error } = await ctx.supabase
    .from('worker_logs')
    .select('*')
    .eq('video_id', input.videoId)
    .eq('account_id', ctx.accountId)
    .order('created_at', { ascending: false })
    .limit(Math.max(1, Math.min(200, input.limit ?? 50)));

  if (error) throw error;
  return { ok: true, logs: data ?? [] };
}

export async function generateCaptionTool(
  ctx: AutomationToolContext,
  input: { videoId: string; previousCaption?: string },
) {
  const video = await requireVideo(ctx, input.videoId);
  const project = await requireProject(ctx, video.project_id);
  const previousCaption = input.previousCaption?.trim();

  const data = await generateGeminiContent<{
    candidates?: { content?: { parts?: { text?: string }[] } }[];
  }>(GEMINI_CAPTION_MODEL, {
    systemInstruction: {
      parts: [{
        text: `## # Caption generation system

You are an expert short-form social media caption writer for TikTok, Instagram Reels, and YouTube Shorts.

Write a short natural caption that creates curiosity, increases clicks/watch rate, feels native to social media, and matches the emotional tone of the video.

The caption should be short and punchy, include one curiosity-driven sentence, avoid generic filler, and sound human.

Include EXACTLY 6 hashtags, mixing broad hashtags like #fyp #viral #shorts with niche hashtags related to the video topic.

Output ONLY the final caption. ##`,
      }],
    },
    contents: [{
      role: 'user',
      parts: [{
        text: `Full original_script:
${video.original_script || video.title}

Project name:
${project.name}

Project niche:
${project.niche}${
          previousCaption
            ? `

Previous caption:
${previousCaption}

Create a different version. Do not make it too similar to the previous caption.`
            : ''
        }`,
      }],
    }],
    generationConfig: {
      temperature: 0.75,
      maxOutputTokens: 180,
    },
  });

  const caption = data.candidates?.[0]?.content?.parts?.[0]?.text?.trim();
  if (!caption) throw new Error('Gemini returned an empty caption.');
  return { ok: true, caption, model: GEMINI_CAPTION_MODEL };
}

export async function setThumbnailFromAssetTool(
  ctx: AutomationToolContext,
  input: { videoId: string; storagePath: string; source?: 'default' | 'ai' | 'uploaded'; prompt?: string | null },
) {
  await requireVideo(ctx, input.videoId);
  const { data: asset, error: assetError } = await ctx.supabase
    .from('video_assets')
    .select('storage_path,kind')
    .eq('video_id', input.videoId)
    .eq('account_id', ctx.accountId)
    .eq('storage_path', input.storagePath)
    .maybeSingle<{ storage_path: string; kind: string }>();

  if (assetError) throw assetError;
  if (!asset) throw new Error('Thumbnail asset was not found for this video.');

  const { error } = await ctx.supabase
    .from('videos')
    .update({
      thumbnail_path: input.storagePath,
      thumbnail_prompt: input.prompt ?? null,
      thumbnail_source: input.source ?? (asset.kind === 'thumbnail' ? 'uploaded' : 'default'),
      thumbnail_updated_at: nowIso(),
      updated_at: nowIso(),
    })
    .eq('id', input.videoId)
    .eq('account_id', ctx.accountId);

  if (error) throw error;
  return {
    ok: true,
    storagePath: input.storagePath,
    thumbnailUrl: await createSignedUrl(ctx.supabase, input.storagePath),
  };
}

export async function saveVideoEditTool(
  ctx: AutomationToolContext,
  input: { videoId: string; editedSettings: Partial<VideoSettings>; editedSegments: SegmentData[] },
) {
  await requireVideo(ctx, input.videoId);
  const { error } = await ctx.supabase
    .from('videos')
    .update({
      edited_settings: input.editedSettings,
      edited_segments: input.editedSegments,
      updated_at: nowIso(),
    })
    .eq('id', input.videoId)
    .eq('account_id', ctx.accountId);

  if (error) throw error;
  return { ok: true };
}

export async function applyVideoPatchTool(
  ctx: AutomationToolContext,
  input: { videoId: string; patch: VideoEditPatch; prompt?: string },
) {
  const video = await requireVideo(ctx, input.videoId);
  const currentSettings = (video.edited_settings ?? video.settings) as Partial<VideoSettings>;
  const currentSegments = (video.edited_segments ?? video.segments) as SegmentData[];
  const patch = validatePatch(input.patch);
  const appliedFields = listAppliedFields(patch);
  if (appliedFields.length === 0) throw new Error('Patch contains no applicable changes.');

  const editedSettings = applyPatchToSettings(currentSettings, patch);
  const editedSegments = applyPatchToSegments(currentSegments, patch);

  const { count } = await ctx.supabase
    .from('video_edits')
    .select('id', { count: 'exact', head: true })
    .eq('video_id', input.videoId);

  await ctx.supabase.from('video_edits').insert({
    video_id: input.videoId,
    user_id: ctx.userId,
    version_number: (count ?? 0) + 1,
    patch,
    prompt: input.prompt ?? 'Applied by automation tool',
    applied_fields: appliedFields,
  });

  await saveVideoEditTool(ctx, { videoId: input.videoId, editedSettings, editedSegments });
  return { ok: true, patch, appliedFields, editedSettings, editedSegments };
}

export async function regenerateSceneImageTool(
  ctx: AutomationToolContext,
  input: {
    videoId: string;
    segmentIndex: number;
    prompt: string;
    mode: ImageGenMode;
    orientation?: Orientation;
  },
) {
  const video = await requireVideo(ctx, input.videoId);
  const segments = ((video.edited_segments ?? video.segments) as SegmentData[]).map((segment) => ({ ...segment }));
  const segment = segments[input.segmentIndex];
  if (!segment) throw new Error('Segment not found.');

  const orientation = input.orientation ?? ((video.edited_settings ?? video.settings) as Partial<VideoSettings>)?.orientation ?? 'vertical';
  const fileId = `${segment.id}_agent_${uuidv4()}`;
  const usage = { serperQueries: 0, googleImageSelections: 0, imagenImages: 0 };
  let localImagePath: string;

  if (input.mode === 'google') {
    const fullScript = segments.map((candidate) => candidate.text).join(' ');
    const candidates = await searchImageCandidateDetails(input.prompt, 10);
    usage.serperQueries += 1;
    const ranked = await rankGoogleImageCandidates(candidates, segment.text, fullScript, orientation);
    usage.googleImageSelections += 1;
    localImagePath = await downloadImage(ranked.map((candidate) => candidate.imageUrl), fileId);
  } else {
    localImagePath = await generateWithOpenAIImage(input.prompt, fileId, orientation);
    usage.imagenImages += 1;
  }

  const assetClient = createStorageAdminClient() ?? ctx.supabase;
  const imageAsset = await uploadLocalAsset({
    supabase: assetClient,
    userId: ctx.userId,
    projectId: video.project_id,
    videoId: video.id,
    folder: 'images',
    localPath: localImagePath,
    filename: `${String(input.segmentIndex + 1).padStart(2, '0')}-${segment.id}-agent-${Date.now()}${path.extname(localImagePath) || '.jpg'}`,
  });

  const dbClient = createStorageAdminClient() ?? ctx.supabase;
  await dbClient.from('video_assets').insert({
    user_id: ctx.userId,
    account_id: ctx.accountId,
    project_id: video.project_id,
    video_id: video.id,
    kind: 'image',
    segment_id: segment.id,
    segment_index: input.segmentIndex,
    storage_bucket: VIDEO_ASSETS_BUCKET,
    storage_provider: imageAsset.storageProvider,
    storage_path: imageAsset.storagePath,
    mime_type: imageAsset.mimeType,
    size_bytes: imageAsset.sizeBytes,
    prompt: input.prompt,
    source: input.mode,
    metadata: { localImagePath, generatedDuring: 'automation_tool' },
  });

  segments[input.segmentIndex] = {
    ...segment,
    localImagePath,
    imagePrompt: input.prompt,
    imageGenMode: input.mode,
  };
  await saveVideoEditTool(ctx, {
    videoId: video.id,
    editedSettings: (video.edited_settings ?? video.settings) as Partial<VideoSettings>,
    editedSegments: segments,
  });

  const costLines: CostLine[] = [];
  if (usage.serperQueries > 0) {
    costLines.push({
      provider: 'serper',
      step: 'image_search',
      usage: { queries: usage.serperQueries },
      costUsd: roundCost(usage.serperQueries * PRICING.serper.imagesSearchUsdPerQuery),
    });
  }
  if (usage.googleImageSelections > 0) {
    costLines.push({
      provider: 'google',
      model: 'gemini-2.5-flash-lite',
      step: 'image_selection',
      usage: {
        estimatedSelections: usage.googleImageSelections,
        estimatedInputTokens: usage.googleImageSelections * 900,
        estimatedOutputTokens: usage.googleImageSelections * 40,
      },
      costUsd: costGeminiText(usage.googleImageSelections * 900, usage.googleImageSelections * 40),
    });
  }
  if (usage.imagenImages > 0) {
    costLines.push({
      provider: 'openai',
      model: OPENAI_IMAGE_MODEL,
      step: 'image_generation',
      usage: openAIImage2Usage(usage.imagenImages, orientation),
      costUsd: costOpenAIImage2Low(usage.imagenImages, orientation),
    });
  }
  await insertUsageEvents({
    supabase: ctx.supabase,
    userId: ctx.userId,
    accountId: ctx.accountId,
    projectId: video.project_id,
    videoId: video.id,
    lines: costLines,
    estimated: false,
  });
  if (costLines.length > 0) await updateActualCost(ctx, video.id);

  return { ok: true, localImagePath, storagePath: imageAsset.storagePath, segment: segments[input.segmentIndex] };
}

export async function retryRenderTool(ctx: AutomationToolContext, input: { videoId: string; triggerWorker?: boolean }) {
  const video = await requireVideo(ctx, input.videoId);
  const retryableStatuses = new Set(['queued', 'failed', 'done']);
  if (!retryableStatuses.has(video.status)) {
    throw new Error(`Video status "${video.status}" cannot be retried yet.`);
  }

  const queuedAt = nowIso();
  const { error } = await ctx.supabase
    .from('videos')
    .update({
      status: 'queued',
      current_step: 'queued',
      queued_at: queuedAt,
      processing_started_at: null,
      locked_at: null,
      worker_id: null,
      last_worker_error: null,
      error_message: null,
      completed_at: null,
      render_progress: 0,
      updated_at: queuedAt,
    })
    .eq('id', video.id)
    .eq('account_id', ctx.accountId);

  if (error) throw error;

  const worker = input.triggerWorker === false
    ? { ok: false, skipped: true, message: 'Worker trigger skipped by caller.' }
    : await triggerWorkerJob(video.id);

  return {
    ok: true,
    videoId: video.id,
    status: 'queued' as const,
    workerTriggered: worker.ok,
    workerTriggerSkipped: worker.skipped,
    workerMessage: worker.message,
  };
}

export async function scheduleYouTubePublishTool(
  ctx: AutomationToolContext,
  input: {
    videoId: string;
    scheduledFor: string;
    caption?: string;
    title?: string;
    description?: string;
    timezone?: string;
    thumbnailStoragePath?: string | null;
    privacyStatus?: 'private' | 'unlisted' | 'public';
    scheduledPostId?: string;
  },
) {
  const video = await requireVideo(ctx, input.videoId);
  if (!video.final_video_path) throw new Error('Final MP4 is not available yet.');

  const scheduledFor = new Date(input.scheduledFor);
  if (Number.isNaN(scheduledFor.getTime())) throw new Error('A valid scheduledFor date is required.');

  const { data: connection, error: connectionError } = await ctx.supabase
    .from('social_connections')
    .select('id,status')
    .eq('account_id', ctx.accountId)
    .eq('project_id', video.project_id)
    .eq('platform', 'youtube')
    .eq('status', 'connected')
    .maybeSingle<{ id: string; status: string }>();

  if (connectionError) throw connectionError;
  if (!connection) throw new Error('YouTube is not connected for this project.');

  const row = {
    caption: input.caption?.trim() ?? '',
    title: input.title?.trim() || video.title || 'Untitled video',
    description: input.description ?? input.caption ?? '',
    privacy_status: input.privacyStatus ?? 'public',
    scheduled_for: scheduledFor.toISOString(),
    timezone: input.timezone ?? null,
    video_storage_path: video.final_video_path,
    thumbnail_storage_path: input.thumbnailStoragePath || video.thumbnail_path || null,
    error_message: null,
    error_details: {},
    updated_at: nowIso(),
  };

  if (input.scheduledPostId) {
    const { data, error } = await ctx.supabase
      .from('scheduled_posts')
      .update(row)
      .eq('id', input.scheduledPostId)
      .eq('video_id', video.id)
      .eq('account_id', ctx.accountId)
      .eq('platform', 'youtube')
      .eq('status', 'scheduled')
      .select('*')
      .maybeSingle();
    if (error) throw error;
    if (!data) throw new Error('Scheduled post was not found or can no longer be edited.');
    return { ok: true, scheduledPost: data };
  }

  const { data, error } = await ctx.supabase
    .from('scheduled_posts')
    .insert({
      account_id: ctx.accountId,
      project_id: video.project_id,
      video_id: video.id,
      connection_id: connection.id,
      created_by: ctx.userId,
      platform: 'youtube',
      status: 'scheduled',
      ...row,
    })
    .select('*')
    .single();

  if (error) throw error;
  return { ok: true, scheduledPost: data };
}

export async function listScheduledPostsTool(
  ctx: AutomationToolContext,
  input: { projectId?: string; videoId?: string; status?: string; limit?: number } = {},
) {
  let query = ctx.supabase
    .from('scheduled_posts')
    .select('*')
    .eq('account_id', ctx.accountId)
    .order('scheduled_for', { ascending: false })
    .limit(Math.max(1, Math.min(100, input.limit ?? 30)));

  if (input.projectId) query = query.eq('project_id', input.projectId);
  const projectIds = restrictedProjectIds(ctx);
  if (!input.projectId && projectIds) query = query.in('project_id', projectIds);
  if (input.videoId) query = query.eq('video_id', input.videoId);
  if (input.status) query = query.eq('status', input.status);

  const { data, error } = await query;
  if (error) throw error;
  return { ok: true, scheduledPosts: data ?? [] };
}

export async function cancelScheduledPostTool(ctx: AutomationToolContext, input: { scheduledPostId: string }) {
  const { data, error } = await ctx.supabase
    .from('scheduled_posts')
    .update({ status: 'cancelled', locked_at: null, updated_at: nowIso() })
    .eq('id', input.scheduledPostId)
    .eq('account_id', ctx.accountId)
    .in('status', ['draft', 'scheduled', 'failed'])
    .select('*')
    .maybeSingle();

  if (error) throw error;
  if (!data) throw new Error('Scheduled post was not found or can no longer be cancelled.');
  return { ok: true, scheduledPost: data };
}

export async function deleteVideoTool(ctx: AutomationToolContext, input: { videoId: string }) {
  const db = createSupabaseAdminClient() ?? ctx.supabase;
  const { data: video, error: videoError } = await db
    .from('videos')
    .select('id,user_id,account_id,project_id,status,current_step')
    .eq('id', input.videoId)
    .eq('account_id', ctx.accountId)
    .maybeSingle<{
      id: string;
      user_id: string;
      account_id: string;
      project_id: string;
      status: string;
      current_step: string | null;
    }>();

  if (videoError) throw videoError;
  if (!video) throw new Error('Video not found.');

  await db
    .from('videos')
    .update({ current_step: 'deleting', locked_at: null, updated_at: nowIso() })
    .eq('id', video.id)
    .eq('account_id', ctx.accountId);

  const { data: assets, error: assetsError } = await db
    .from('video_assets')
    .select('storage_path')
    .eq('video_id', video.id)
    .eq('account_id', ctx.accountId);

  if (assetsError) throw assetsError;

  const storageResult = await deleteVideoStorageAssets({
    supabase: db,
    userId: video.user_id,
    projectId: video.project_id,
    videoId: video.id,
    storagePaths: (assets ?? []).map((asset) => String(asset.storage_path ?? '')).filter(Boolean),
  });

  const tables = ['social_post_analytics', 'scheduled_posts', 'usage_events', 'video_assets'];
  for (const table of tables) {
    const { error } = await db.from(table).delete().eq('video_id', video.id).eq('account_id', ctx.accountId);
    if (error) throw new Error(`Could not delete ${table}: ${error.message}`);
  }

  const { error: deleteError } = await db
    .from('videos')
    .delete()
    .eq('id', video.id)
    .eq('account_id', ctx.accountId);

  if (deleteError) throw deleteError;
  return { ok: true, videoId: video.id, deletedStoragePaths: storageResult.deletedPaths };
}
