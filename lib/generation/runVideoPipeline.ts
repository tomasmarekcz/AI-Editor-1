import path from 'path';
import fs from 'fs';
import type { SupabaseClient } from '@supabase/supabase-js';
import { searchImageCandidateDetails } from '@/lib/searchImages';
import { downloadImage } from '@/lib/downloadImage';
import { rankGoogleImageCandidates } from '@/lib/selectGoogleImageCandidate';
import { generateImagePlans, type ImagePlan } from '@/lib/generateImagePlans';
import { generateWithOpenAIImage, OPENAI_IMAGE_MODEL } from '@/lib/generateWithOpenAIImage';
import { reviewImage } from '@/lib/reviewImage';
import { enhanceScriptForAudio } from '@/lib/enhanceScriptForAudio';
import { generateVoiceoverFull } from '@/lib/generateVoiceoverFull';
import { transcribeAudio } from '@/lib/transcribeAudio';
import { mapSTTToSegments } from '@/lib/mapSTTToSegments';
import { renderVideo } from '@/lib/renderVideo';
import {
  createSignedUrl,
  downloadAssetBlob,
  uploadBufferAsset,
  uploadLocalAsset,
  VIDEO_ASSETS_BUCKET,
} from '@/lib/storage/videoAssets';
import { costGeminiText, costOpenAIImage2Low, costOpenAIText, PRICING, openAIImage2Usage, roundCost, type CostLine } from '@/lib/pricing';
import { insertUsageEvents, summarizeCostLines } from '@/lib/usage/record';
import { generateEffects } from '@/lib/generateEffects';
import { logWorkerEvent } from '@/lib/worker/log';
import type { ImageGenMode, ImageSource, PipelineEvent, SegmentData, VideoEffect, VideoSettings } from '@/types';

type RunVideoPipelineInput = {
  supabase: SupabaseClient;
  userId: string;
  accountId: string;
  projectId: string;
  videoId: string;
  segments: SegmentData[];
  settings: VideoSettings;
  originalScript?: string;
  scriptGenerationCostLines?: CostLine[];
  onEvent?: (event: PipelineEvent) => void;
};

const MAX_IMAGE_REVIEW_ATTEMPTS = 3;

const publicLocalPathToAbsolute = (localPath: string): string => {
  const normalized = localPath.startsWith('/') ? localPath.slice(1) : localPath;
  return path.join(process.cwd(), 'public', normalized);
};

const localImageExists = (localImagePath: string | undefined): boolean => {
  if (!localImagePath) return false;
  try {
    const stat = fs.statSync(publicLocalPathToAbsolute(localImagePath));
    return stat.isFile() && stat.size > 1024;
  } catch {
    return false;
  }
};

async function downloadStorageImageToTmp(
  supabase: SupabaseClient,
  storagePath: string,
  videoId: string,
  index: number,
) {
  const blob = await downloadAssetBlob(supabase, storagePath);
  if (!blob) throw new Error(`Could not download ${storagePath}`);

  const ext = path.extname(storagePath).toLowerCase() || '.jpg';
  const dir = path.join(process.cwd(), 'public', 'tmp', 'images');
  fs.mkdirSync(dir, { recursive: true });
  const filename = `reused_${videoId}_${String(index + 1).padStart(2, '0')}${ext}`;
  const absPath = path.join(dir, filename);
  fs.writeFileSync(absPath, Buffer.from(await blob.arrayBuffer()));
  return `/tmp/images/${filename}`;
}

export async function runVideoPipeline({
  supabase,
  userId,
  accountId,
  projectId,
  videoId,
  segments,
  settings,
  originalScript,
  scriptGenerationCostLines,
  onEvent,
}: RunVideoPipelineInput) {
  if (!segments.length) throw new Error('Video job has no segments to process.');

  const send = (event: PipelineEvent) => onEvent?.(event);
  const fullOriginalScript = originalScript ?? segments.map((segment) => segment.text).join('\n\n');

  const logPipeline = (event: string, message?: string, metadata?: Record<string, unknown>, level: 'debug' | 'info' | 'warn' | 'error' = 'info') =>
    logWorkerEvent({
      supabase,
      videoId,
      accountId,
      projectId,
      source: 'pipeline',
      event,
      level,
      message,
      metadata,
    });

  const requireDbWrite = async <T>(
    label: string,
    query: PromiseLike<{ data?: T | null; error: unknown }>,
  ) => {
    const result = await query;
    if (result.error) {
      const message = result.error instanceof Error
        ? result.error.message
        : typeof result.error === 'object' && result.error && 'message' in result.error
          ? String((result.error as { message?: unknown }).message)
          : String(result.error);
      await logPipeline('db_write_failed', label, { label, error: result.error }, 'error');
      throw new Error(`${label}: ${message}`);
    }
    return result;
  };

  await logPipeline('start', 'Pipeline started.', {
    segments: segments.length,
    imageSource: settings.imageSource,
    ttsProvider: settings.ttsProvider,
    openaiVoice: settings.voice,
    openaiPreset: settings.voicePreset,
    openaiSpeed: settings.speed,
    openaiHdQuality: settings.hdQuality,
    geminiVoice: settings.geminiVoice,
    geminiPreset: settings.geminiPreset,
    elevenLabsPreset: settings.elevenLabsPreset,
    elevenLabsCustomVoiceIdSet: Boolean(settings.elevenLabsCustomVoiceId),
    orientation: settings.orientation,
  });

  await supabase
    .from('videos')
    .update({
      status: 'processing',
      current_step: 'video_created',
      render_progress: 0,
      error_message: null,
      updated_at: new Date().toISOString(),
    })
    .eq('id', videoId);

  send({ type: 'step', step: 'video_created', message: 'Ukládám video do historie...' });

  let processed: SegmentData[] = segments.map((segment) => (
    segment.localImagePath && !localImageExists(segment.localImagePath)
      ? { ...segment, localImagePath: undefined, imageUrl: undefined }
      : { ...segment }
  ));
  const newlyCreatedImageIndexes = new Set<number>();
  const restoredImageIndexes = new Set<number>();
  const savedImageIndexes = new Set<number>();
  const usage: Record<string, number> = {
    generatedImages: 0,
    regeneratedImages: 0,
    imageReviews: 0,
    serperQueries: 0,
    googleImageSelections: 0,
    imagenImages: 0,
  };

  const saveImageCheckpoint = async (index: number, seg: SegmentData) => {
    if (restoredImageIndexes.has(index) || savedImageIndexes.has(index)) return;
    if (!seg.localImagePath || !localImageExists(seg.localImagePath)) return;

    try {
      const imageAsset = await uploadLocalAsset({
        supabase,
        userId,
        projectId,
        videoId,
        folder: 'images',
        localPath: seg.localImagePath,
        filename: `${String(index + 1).padStart(2, '0')}-${path.basename(seg.localImagePath)}`,
      });
      await requireDbWrite('Image asset checkpoint DB upsert failed', supabase.from('video_assets').upsert({
        user_id: userId,
        account_id: accountId,
        project_id: projectId,
        video_id: videoId,
        kind: seg.localImagePath.includes('-upload.') ? 'uploaded_image' : 'image',
        segment_id: seg.id,
        segment_index: index,
        storage_bucket: VIDEO_ASSETS_BUCKET,
        storage_path: imageAsset.storagePath,
        mime_type: imageAsset.mimeType,
        size_bytes: imageAsset.sizeBytes,
        prompt: seg.imagePrompt ?? null,
        source: seg.imageGenMode ?? settings.imageSource,
        metadata: {
          text: seg.text,
          keywords: seg.keywords,
          localImagePath: seg.localImagePath,
          fallbackReason: seg.imageFallbackReason,
          checkpoint: 'image_ready',
        },
      }, { onConflict: 'video_id,kind,storage_path' }));
      savedImageIndexes.add(index);
      if (newlyCreatedImageIndexes.has(index) && seg.imageGenMode === 'imagen') {
        usage.generatedImages += 1;
      }
      await logPipeline('image_checkpoint_saved', `Image ${index} saved to storage checkpoint.`, {
        index,
        storagePath: imageAsset.storagePath,
        source: seg.imageGenMode ?? settings.imageSource,
      });
    } catch (assetErr) {
      console.warn(`[asset image checkpoint ${index}]`, assetErr);
      await logPipeline('asset_image_checkpoint_failed', `Image ${index} checkpoint upload failed.`, { index, assetErr }, 'warn');
    }
  };

  const existingImageAssets = await supabase
    .from('video_assets')
    .select('segment_index,segment_id,storage_path,prompt,source,metadata')
    .eq('video_id', videoId)
    .eq('account_id', accountId)
    .in('kind', ['image', 'uploaded_image'])
    .order('created_at', { ascending: false });

  if (existingImageAssets.error) {
    await logPipeline('existing_images_lookup_failed', 'Could not look up existing image assets; may regenerate missing images.', {
      error: existingImageAssets.error,
    }, 'warn');
  } else {
    const usedIndexes = new Set<number>();
    for (const asset of existingImageAssets.data ?? []) {
      const index = typeof asset.segment_index === 'number'
        ? asset.segment_index
        : processed.findIndex((segment) => asset.segment_id && segment.id === asset.segment_id);
      if (index < 0 || index >= processed.length || usedIndexes.has(index) || localImageExists(processed[index].localImagePath)) {
        continue;
      }

      try {
        const localImagePath = await downloadStorageImageToTmp(supabase, String(asset.storage_path), videoId, index);
        processed[index] = {
          ...processed[index],
          localImagePath,
          imageUrl: localImagePath,
          imagePrompt: processed[index].imagePrompt ?? (asset.prompt ? String(asset.prompt) : undefined),
          imageGenMode: processed[index].imageGenMode ?? (asset.source === 'imagen' ? 'imagen' : asset.source === 'google' ? 'google' : undefined),
          imageFallbackReason: processed[index].imageFallbackReason ?? ((
            typeof asset.metadata === 'object' && asset.metadata && 'fallbackReason' in asset.metadata
              ? String((asset.metadata as { fallbackReason?: unknown }).fallbackReason ?? '')
              : undefined
          ) || undefined),
        };
        usedIndexes.add(index);
        restoredImageIndexes.add(index);
      } catch (err) {
        await logPipeline('existing_image_restore_failed', `Could not restore image ${index} from storage; it may be regenerated.`, {
          index,
          storagePath: asset.storage_path,
          err,
        }, 'warn');
      }
    }

    if (usedIndexes.size > 0) {
      await logPipeline('existing_images_restored', 'Reused existing image assets from Supabase Storage.', {
        restoredImages: usedIndexes.size,
        totalSegments: processed.length,
      });
    }
  }

  const actualCostLines: CostLine[] = (scriptGenerationCostLines ?? [])
    .filter((line) => line.step === 'script_generation')
    .slice(0, 1);
  let projectVisualStyle = '';
  try {
    const { data: project } = await supabase
      .from('projects')
      .select('visual_style,default_visual_prompt')
      .eq('id', projectId)
      .eq('account_id', accountId)
      .maybeSingle<{ visual_style: string | null; default_visual_prompt: string | null }>();

    projectVisualStyle = [
      project?.visual_style,
      project?.default_visual_prompt ? `Default visual prompt: ${project.default_visual_prompt}` : '',
    ].filter(Boolean).join('\n');
  } catch (err) {
    await logPipeline('project_visual_style_lookup_failed', 'Could not load project visual style for image planning.', { err }, 'warn');
  }

  const parallelTasks: Promise<void>[] = [];
  const imagesAlreadyReady = processed.every((segment) => localImageExists(segment.localImagePath));

  if (settings.imageSource !== 'upload' && !imagesAlreadyReady) {
    const imageSource = settings.imageSource as Exclude<ImageSource, 'upload'>;
    await logPipeline('images_start', 'Starting image generation/search.', {
      segments: segments.length,
      imageSource,
    });
    await supabase
      .from('videos')
      .update({ status: 'generating_images', current_step: 'generating_images', updated_at: new Date().toISOString() })
      .eq('id', videoId);
    send({ type: 'step', step: 'images', message: 'Připravuji obrázky...', total: segments.length });

    let plans: ImagePlan[];
    try {
      plans = await generateImagePlans(processed, imageSource, settings.orientation, projectVisualStyle);
      const inputTokens = Math.ceil((processed.map((s) => s.text).join('\n').length * (imageSource === 'hybrid' ? 1 : processed.length)) / 4) + 2000;
      const outputTokens = Math.ceil(JSON.stringify(plans).length / 4);
      actualCostLines.push({
        provider: 'google',
        model: 'gemini-2.5-flash-lite',
        step: 'image_planning',
        usage: { estimatedInputTokens: inputTokens, estimatedOutputTokens: outputTokens, segments: processed.length },
        costUsd: costGeminiText(inputTokens, outputTokens),
      });
    } catch (err) {
      await logPipeline('image_planning_failed', 'Image planning failed; using fallback prompts.', { err }, 'warn');
      const fallbackMode: ImageGenMode = imageSource === 'imagen' ? 'imagen' : 'google';
      plans = processed.map((segment) => ({
        mode: fallbackMode,
        prompt: fallbackMode === 'imagen'
          ? `Photorealistic cinematic documentary still, ${segment.text}, realistic environment, emotional atmosphere, dramatic composition, natural lighting, no text, no logos`
          : segment.keywords || segment.text.slice(0, 100),
      }));
    }

    parallelTasks.push(
      Promise.all(
        processed.map(async (seg, i) => {
          if (localImageExists(seg.localImagePath)) {
            send({
              type: 'image_ready',
              index: i,
              imageUrl: seg.localImagePath ?? '',
              prompt: seg.imagePrompt,
              mode: seg.imageGenMode,
              fallbackReason: seg.imageFallbackReason,
            });
            await logPipeline('image_reused', `Image ${i} already ready; keeping existing asset.`, {
              index: i,
              localImagePath: seg.localImagePath,
              imageGenMode: seg.imageGenMode,
            });
            return;
          }

          const plan = plans[i] ?? {
            mode: imageSource === 'imagen' ? 'imagen' : 'google',
            prompt: imageSource === 'imagen'
              ? `Photorealistic cinematic documentary still, ${seg.text}, realistic environment, emotional atmosphere, dramatic composition, natural lighting, no text, no logos`
              : seg.keywords || seg.text.slice(0, 100),
          };
          let localImagePath: string | undefined;
          let usedMode: ImageGenMode = plan.mode;
          let currentPrompt = plan.prompt;
          let fallbackReason: string | undefined;
          let approved = false;
          let attempt = 0;

          try {
            while (attempt < MAX_IMAGE_REVIEW_ATTEMPTS && !approved) {
              if (usedMode === 'google') {
                const candidates = await searchImageCandidateDetails(currentPrompt, 10);
                usage.serperQueries += 1;
                const ranked = await rankGoogleImageCandidates(
                  candidates,
                  seg.text,
                  fullOriginalScript,
                  settings.orientation,
                );
                usage.googleImageSelections += 1;
                localImagePath = await downloadImage(ranked.map((candidate) => candidate.imageUrl), seg.id);
              } else {
                try {
                  localImagePath = await generateWithOpenAIImage(currentPrompt, seg.id, settings.orientation);
                  usage.imagenImages += 1;
                } catch (aiImageErr) {
                  if (imageSource !== 'hybrid') throw aiImageErr;

                  await logPipeline('ai_image_failed_google_fallback', `AI image generation failed for segment ${i}; using Google fallback.`, {
                    index: i,
                    aiImageErr,
                  }, 'warn');
                  usedMode = 'google';
                  currentPrompt = seg.keywords || seg.text.slice(0, 80);
                  fallbackReason = 'AI generation failed; Google fallback was used.';
                  const candidates = await searchImageCandidateDetails(currentPrompt, 10);
                  usage.serperQueries += 1;
                  const ranked = await rankGoogleImageCandidates(
                    candidates,
                    seg.text,
                    fullOriginalScript,
                    settings.orientation,
                  );
                  usage.googleImageSelections += 1;
                  localImagePath = await downloadImage(ranked.map((candidate) => candidate.imageUrl), seg.id);
                }
              }

              if (!localImagePath) {
                attempt += 1;
                continue;
              }

              try {
                usage.imageReviews += 1;
                const review = await reviewImage(
                  localImagePath,
                  seg.text,
                  fullOriginalScript,
                  usedMode,
                  currentPrompt,
                );

                if (review.approved) {
                  approved = true;
                } else {
                  currentPrompt = review.newPrompt || currentPrompt;
                  attempt += 1;
                }
              } catch (reviewErr) {
                await logPipeline('image_review_failed', `Image review failed for segment ${i}; accepting image.`, {
                  index: i,
                  reviewErr,
                }, 'warn');
                approved = true;
              }
            }

            processed[i] = {
              ...processed[i],
              localImagePath,
              imagePrompt: currentPrompt,
              imageGenMode: usedMode,
              imageFallbackReason: fallbackReason,
            };
            if (localImagePath) newlyCreatedImageIndexes.add(i);
            send({ type: 'image_ready', index: i, imageUrl: localImagePath ?? '', prompt: currentPrompt, mode: usedMode, attempts: attempt + 1, fallbackReason });
            await logPipeline('image_ready', `Image ${i} ready.`, {
              index: i,
              mode: usedMode,
              fallbackReason,
              hasLocalImagePath: !!localImagePath,
              attempts: attempt + 1,
            });
            await saveImageCheckpoint(i, processed[i]);
          } catch (err) {
            console.error(`[img ${i}]`, err);
            processed[i] = {
              ...processed[i],
              imagePrompt: currentPrompt,
              imageGenMode: usedMode,
              imageFallbackReason: fallbackReason,
            };
            send({ type: 'image_failed', index: i, prompt: currentPrompt, mode: usedMode, error: err instanceof Error ? err.message : String(err) });
            await logPipeline('image_failed', `Image ${i} failed.`, { index: i, mode: usedMode, currentPrompt, err }, 'warn');
          }
        }),
      ).then(() => {}),
    );
  } else {
    send({ type: 'step', step: 'images', message: 'Obrázky připraveny.' });
  }

  let effectsPromise: Promise<VideoEffect[]> = Promise.resolve([]);
  if (settings.enableEffects) {
    effectsPromise = generateEffects(segments).catch(() => [] as VideoEffect[]);
  }

  await Promise.all(parallelTasks);
  await Promise.all(processed.map((seg, index) => saveImageCheckpoint(index, seg)));
  if (savedImageIndexes.size > 0 || restoredImageIndexes.size > 0) {
    await requireDbWrite('Image checkpoint video update failed', supabase
      .from('videos')
      .update({
        current_step: 'images_saved',
        segments: processed,
        usage,
        generated_images_count: usage.generatedImages,
        updated_at: new Date().toISOString(),
      })
      .eq('id', videoId));
    await logPipeline('images_saved', 'Image checkpoints are saved.', {
      savedImages: savedImageIndexes.size,
      restoredImages: restoredImageIndexes.size,
      totalSegments: processed.length,
    });
  }
  const effects = await effectsPromise;
  if (effects.length > 0) {
    await logPipeline('effects_ready', 'Effects generated.', { effects });
    processed = processed.map((seg, i) => ({ ...seg, effect: effects[i] ?? 'none' }));
    send({ type: 'effects_ready', effects });
    const inputTokens = Math.ceil(JSON.stringify(segments.map((s) => s.text)).length / 4) + 500;
    const outputTokens = effects.length * 8;
    actualCostLines.push({
      provider: 'openai',
      model: 'gpt-4o-mini',
      step: 'effects',
      usage: { estimatedInputTokens: inputTokens, estimatedOutputTokens: outputTokens, effects: effects.length },
      costUsd: costOpenAIText(inputTokens, outputTokens),
    });
  }

  await supabase
    .from('videos')
    .update({ current_step: 'audio_enhancement', segments: processed, updated_at: new Date().toISOString() })
    .eq('id', videoId);
  send({ type: 'step', step: 'enhance', message: 'Upravuji scénář pro zvuk...' });

  try {
    const enhanced = await enhanceScriptForAudio(processed.map((s) => s.text));
    processed = processed.map((seg, i) => ({ ...seg, audioText: enhanced[i] ?? seg.text }));
    await supabase
      .from('videos')
      .update({
        enhanced_script: processed.map((s) => s.audioText ?? s.text).join('\n\n'),
        segments: processed,
        updated_at: new Date().toISOString(),
      })
      .eq('id', videoId);
  } catch (err) {
    console.error('[enhance]', err);
    await logPipeline('audio_enhancement_failed', 'Audio enhancement failed; continuing with original text.', { err }, 'warn');
  }
  const enhancedInputTokens = Math.ceil(processed.map((s) => s.text).join('\n').length / 4) + 600;
  const enhancedOutputTokens = Math.ceil(processed.map((s) => s.audioText ?? s.text).join('\n').length / 4);
  actualCostLines.push({
    provider: 'google',
    model: 'gemini-2.5-flash-lite',
    step: 'audio_enhancement',
    usage: { estimatedInputTokens: enhancedInputTokens, estimatedOutputTokens: enhancedOutputTokens },
    costUsd: costGeminiText(enhancedInputTokens, enhancedOutputTokens),
  });

  const providerLabel =
    settings.ttsProvider === 'gemini'
      ? 'Gemini TTS'
      : settings.ttsProvider === 'elevenlabs'
        ? 'ElevenLabs'
        : 'OpenAI TTS';
  await supabase
    .from('videos')
    .update({ status: 'generating_voice', current_step: 'generating_voice', updated_at: new Date().toISOString() })
    .eq('id', videoId);
  send({ type: 'step', step: 'tts', message: `Generuji voiceover (${providerLabel})...` });

  const { audioRelPath, audioAbsPath, duration: measuredAudioDurationSeconds } = await generateVoiceoverFull(
    processed.map((s) => s.audioText ?? s.text),
    videoId,
    settings,
  );
  const audioDurationSeconds = measuredAudioDurationSeconds;
  await logPipeline('voice_ready', 'Voiceover generated.', {
    audioRelPath,
    audioDurationSeconds,
    ttsProvider: settings.ttsProvider,
    voice:
      settings.ttsProvider === 'gemini'
        ? settings.geminiVoice
        : settings.ttsProvider === 'elevenlabs'
          ? settings.elevenLabsPreset
          : settings.voice,
    preset:
      settings.ttsProvider === 'gemini'
        ? settings.geminiPreset
        : settings.ttsProvider === 'elevenlabs'
          ? settings.elevenLabsPreset
          : settings.voicePreset,
  });

  const audioAsset = await uploadLocalAsset({
    supabase,
    userId,
    projectId,
    videoId,
    folder: 'audio',
    localPath: audioAbsPath,
  });
  await requireDbWrite('Audio asset DB insert failed', supabase.from('video_assets').insert({
    user_id: userId,
    account_id: accountId,
    project_id: projectId,
    video_id: videoId,
    kind: 'audio',
    storage_bucket: VIDEO_ASSETS_BUCKET,
    storage_path: audioAsset.storagePath,
    mime_type: audioAsset.mimeType,
    size_bytes: audioAsset.sizeBytes,
    source: settings.ttsProvider,
    metadata: {
      audioRelPath,
      provider: settings.ttsProvider,
      openaiVoice: settings.voice,
      openaiPreset: settings.voicePreset,
      openaiSpeed: settings.speed,
      openaiHdQuality: settings.hdQuality,
      geminiVoice: settings.geminiVoice,
      geminiPreset: settings.geminiPreset,
      elevenLabsPreset: settings.elevenLabsPreset,
      elevenLabsCustomVoiceId: settings.elevenLabsCustomVoiceId ? '[set]' : '',
    },
  }));
  await requireDbWrite('Audio checkpoint video update failed', supabase
    .from('videos')
    .update({
      current_step: 'audio_saved',
      tts_duration_seconds: audioDurationSeconds,
      updated_at: new Date().toISOString(),
    })
    .eq('id', videoId));
  const ttsText = processed.map((s) => s.audioText ?? s.text).join('\n\n');
  const ttsMinutes = Math.max(1 / 60, audioDurationSeconds / 60);
  if (settings.ttsProvider === 'gemini') {
    actualCostLines.push({
      provider: 'google',
      model: 'gemini-2.5-flash-preview-tts',
      step: 'tts',
      usage: { characters: ttsText.length, audioSeconds: audioDurationSeconds },
      costUsd: roundCost(ttsMinutes * PRICING.google['gemini-2.5-flash-preview-tts'].estimatedUsdPerMinute),
    });
  } else if (settings.ttsProvider === 'elevenlabs') {
    actualCostLines.push({
      provider: 'elevenlabs',
      model: 'eleven_multilingual_v2',
      step: 'tts',
      usage: { characters: ttsText.length, audioSeconds: audioDurationSeconds },
      costUsd: roundCost((ttsText.length / 1_000) * PRICING.elevenlabs.eleven_multilingual_v2.usdPer1KCharacters),
    });
  } else {
    const hasInstructions = settings.voicePreset === 'custom'
      ? settings.customInstructions.trim().length > 0
      : true;
    const model = settings.hdQuality ? 'tts-1-hd' : hasInstructions ? 'gpt-4o-mini-tts' : 'tts-1';
    const costUsd = model === 'gpt-4o-mini-tts'
      ? ttsMinutes * PRICING.openai['gpt-4o-mini-tts'].estimatedUsdPerMinute
      : (ttsText.length / 1_000_000) * PRICING.openai[model].usdPer1MCharacters;
    actualCostLines.push({
      provider: 'openai',
      model,
      step: 'tts',
      usage: { characters: ttsText.length, audioSeconds: audioDurationSeconds },
      costUsd: roundCost(costUsd),
    });
  }

  processed.forEach((_, i) => send({ type: 'audio_ready', index: i }));

  await supabase
    .from('videos')
    .update({ status: 'transcribing', current_step: 'transcribing', updated_at: new Date().toISOString() })
    .eq('id', videoId);
  send({ type: 'step', step: 'transcribe', message: 'Transkribuji audio (Whisper)...' });

  const sttWords = await transcribeAudio(audioAbsPath).catch((err) => {
    console.error('[transcribe]', err);
    void logPipeline('transcription_failed', 'Transcription failed; continuing without word timings.', { err }, 'warn');
    return [];
  });
  await logPipeline('transcription_ready', 'Transcription step finished.', { words: sttWords.length });
  actualCostLines.push({
    provider: 'openai',
    model: 'whisper-1',
    step: 'transcription',
    usage: { audioSeconds: audioDurationSeconds, words: sttWords.length },
    costUsd: roundCost((audioDurationSeconds / 60) * PRICING.openai['whisper-1'].usdPerMinute),
  });

  mapSTTToSegments(sttWords, processed, audioDurationSeconds);

  const subtitlesJson = {
    segments: processed,
    wordTimings: sttWords,
    subtitle: settings.subtitle,
  };
  const subtitlesAsset = await uploadBufferAsset({
    supabase,
    userId,
    projectId,
    videoId,
    folder: 'subtitles',
    filename: 'subtitles.json',
    buffer: Buffer.from(JSON.stringify(subtitlesJson, null, 2), 'utf8'),
    contentType: 'application/json',
  });
  await requireDbWrite('Subtitles asset DB insert failed', supabase.from('video_assets').insert({
    user_id: userId,
    account_id: accountId,
    project_id: projectId,
    video_id: videoId,
    kind: 'subtitles',
    storage_bucket: VIDEO_ASSETS_BUCKET,
    storage_path: subtitlesAsset.storagePath,
    mime_type: subtitlesAsset.mimeType,
    size_bytes: subtitlesAsset.sizeBytes,
    metadata: { format: 'segments-json' },
  }));
  await requireDbWrite('Subtitles checkpoint video update failed', supabase
    .from('videos')
    .update({
      current_step: 'subtitles_saved',
      segments: processed,
      transcription_duration_seconds: audioDurationSeconds,
      updated_at: new Date().toISOString(),
    })
    .eq('id', videoId));

  await supabase
    .from('videos')
    .update({ status: 'rendering', current_step: 'rendering', segments: processed, updated_at: new Date().toISOString() })
    .eq('id', videoId);
  send({ type: 'step', step: 'rendering', message: 'Renderuji video...' });

  let videoUrl: string;
  try {
    videoUrl = await renderVideo(processed, videoId, settings, audioRelPath, (pct) => {
      send({ type: 'render_progress', progress: pct });
      void supabase
        .from('videos')
        .update({ render_progress: pct, updated_at: new Date().toISOString() })
        .eq('id', videoId);
    });
  } catch (renderErr) {
    const message = renderErr instanceof Error ? renderErr.message : String(renderErr);
    await logPipeline('render_failed', 'Remotion render failed.', { message, renderErr }, 'error');
    await supabase
      .from('videos')
      .update({
        status: 'failed',
        current_step: 'failed',
        error_message: message,
        last_worker_error: message,
        locked_at: null,
        updated_at: new Date().toISOString(),
      })
      .eq('id', videoId);
    throw renderErr;
  }
  await logPipeline('render_ready', 'Remotion render finished.', { videoUrl });

  await supabase
    .from('videos')
    .update({ status: 'uploading', current_step: 'uploading', updated_at: new Date().toISOString() })
    .eq('id', videoId);

  if (usage.serperQueries > 0) {
    actualCostLines.push({
      provider: 'serper',
      step: 'image_search',
      usage: { queries: usage.serperQueries },
      costUsd: roundCost(usage.serperQueries * PRICING.serper.imagesSearchUsdPerQuery),
    });
  }
  if (usage.googleImageSelections > 0) {
    actualCostLines.push({
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
    actualCostLines.push({
      provider: 'openai',
      model: OPENAI_IMAGE_MODEL,
      step: 'image_generation',
      usage: openAIImage2Usage(usage.imagenImages, settings.orientation),
      costUsd: costOpenAIImage2Low(usage.imagenImages, settings.orientation),
    });
  }
  if (usage.imageReviews > 0) {
    actualCostLines.push({
      provider: 'google',
      model: 'gemini-2.5-flash-lite',
      step: 'image_review',
      usage: {
        estimatedReviews: usage.imageReviews,
        estimatedInputTokens: usage.imageReviews * 450,
        estimatedOutputTokens: usage.imageReviews * 50,
      },
      costUsd: costGeminiText(usage.imageReviews * 450, usage.imageReviews * 50),
    });
  }
  let thumbnailPath: string | null = null;
  const firstImage = processed.find((seg) => localImageExists(seg.localImagePath))?.localImagePath;
  if (firstImage) {
    try {
      const thumbAsset = await uploadLocalAsset({
        supabase,
        userId,
        projectId,
        videoId,
        folder: 'thumbnail',
        localPath: firstImage,
        filename: `thumbnail${path.extname(firstImage) || '.jpg'}`,
      });
      thumbnailPath = thumbAsset.storagePath;
      await requireDbWrite('Thumbnail asset DB insert failed', supabase.from('video_assets').insert({
        user_id: userId,
        account_id: accountId,
        project_id: projectId,
        video_id: videoId,
        kind: 'thumbnail',
        storage_bucket: VIDEO_ASSETS_BUCKET,
        storage_path: thumbAsset.storagePath,
        mime_type: thumbAsset.mimeType,
        size_bytes: thumbAsset.sizeBytes,
        source: 'first_image',
        metadata: {},
      }));
    } catch (thumbErr) {
      console.warn('[asset thumbnail]', thumbErr);
      await logPipeline('thumbnail_failed', 'Thumbnail upload failed.', { thumbErr }, 'warn');
    }
  }

  const finalAsset = await uploadLocalAsset({
    supabase,
    userId,
    projectId,
    videoId,
    folder: 'final',
    localPath: videoUrl,
    filename: 'final.mp4',
  });
  await logPipeline('final_uploaded', 'Final video uploaded.', {
    storagePath: finalAsset.storagePath,
    sizeBytes: finalAsset.sizeBytes,
    mimeType: finalAsset.mimeType,
  });
  await requireDbWrite('Final video asset DB insert failed', supabase.from('video_assets').insert({
    user_id: userId,
    account_id: accountId,
    project_id: projectId,
    video_id: videoId,
    kind: 'final_video',
    storage_bucket: VIDEO_ASSETS_BUCKET,
    storage_path: finalAsset.storagePath,
    mime_type: finalAsset.mimeType,
    size_bytes: finalAsset.sizeBytes,
    metadata: { localVideoUrl: videoUrl },
  }));
  await requireDbWrite('Final upload checkpoint video update failed', supabase
    .from('videos')
    .update({
      current_step: 'final_uploaded',
      final_video_path: finalAsset.storagePath,
      final_video_mime_type: finalAsset.mimeType,
      final_video_size_bytes: finalAsset.sizeBytes,
      thumbnail_path: thumbnailPath,
      updated_at: new Date().toISOString(),
    })
    .eq('id', videoId));

  const finalSignedUrl = await createSignedUrl(supabase, finalAsset.storagePath);
  const durationSeconds = processed.reduce((sum, seg) => sum + (seg.audioDuration ?? seg.duration ?? 0), 0);
  await insertUsageEvents({
    supabase,
    userId,
    accountId,
    projectId,
    videoId,
    lines: actualCostLines,
    estimated: false,
  });
  const { data: allActualEvents } = await requireDbWrite('Actual usage events DB select failed', supabase
    .from('usage_events')
    .select('provider,model,step,usage,cost_usd')
    .eq('video_id', videoId)
    .eq('estimated', false));
  const allActualLines: CostLine[] = (allActualEvents ?? []).map((event) => ({
    provider: String(event.provider),
    model: event.model ? String(event.model) : undefined,
    step: String(event.step),
    usage: (event.usage ?? {}) as Record<string, number | string | boolean>,
    costUsd: Number(event.cost_usd ?? 0),
  }));
  const actualCostUsd = roundCost(allActualLines.reduce((sum, line) => sum + line.costUsd, 0));
  const { data: finalVideoRow } = await requireDbWrite('Final video DB update failed', supabase
    .from('videos')
    .update({
      status: 'done',
      current_step: 'done',
      locked_at: null,
      render_progress: 100,
      enhanced_script: processed.map((s) => s.audioText ?? s.text).join('\n\n'),
      segments: processed,
      duration_seconds: durationSeconds,
      final_video_path: finalAsset.storagePath,
      final_video_mime_type: finalAsset.mimeType,
      final_video_size_bytes: finalAsset.sizeBytes,
      thumbnail_path: thumbnailPath,
      actual_cost_usd: actualCostUsd,
      cost_breakdown: { actual: summarizeCostLines(allActualLines) },
      usage,
      generated_images_count: usage.generatedImages,
      regenerated_images_count: usage.regeneratedImages,
      serper_queries_count: usage.serperQueries,
      tts_duration_seconds: audioDurationSeconds,
      transcription_duration_seconds: audioDurationSeconds,
      completed_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq('id', videoId)
    .select('id,status,current_step,final_video_path,thumbnail_path,final_video_size_bytes,completed_at')
    .single());

  await logPipeline('done', 'Pipeline completed.', {
    durationSeconds,
    actualCostUsd,
    finalVideoPath: finalAsset.storagePath,
    finalVideoRow,
  });

  send({ type: 'done', videoUrl: finalSignedUrl ?? videoUrl, videoId });
}
