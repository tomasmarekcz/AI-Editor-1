import path from 'path';
import type { SupabaseClient } from '@supabase/supabase-js';
import { searchImageCandidateDetails } from '@/lib/searchImages';
import { downloadImage } from '@/lib/downloadImage';
import { rankGoogleImageCandidates } from '@/lib/selectGoogleImageCandidate';
import { enhanceScriptForAudio } from '@/lib/enhanceScriptForAudio';
import { generateVoiceoverFull } from '@/lib/generateVoiceoverFull';
import { transcribeAudio } from '@/lib/transcribeAudio';
import { mapSTTToSegments } from '@/lib/mapSTTToSegments';
import { renderVideo } from '@/lib/renderVideo';
import { createSignedUrl, uploadBufferAsset, uploadLocalAsset, VIDEO_ASSETS_BUCKET } from '@/lib/storage/videoAssets';
import { costGeminiText, costOpenAIText, PRICING, roundCost, type CostLine } from '@/lib/pricing';
import { insertUsageEvents, summarizeCostLines } from '@/lib/usage/record';
import { generateEffects } from '@/lib/generateEffects';
import type { PipelineEvent, SegmentData, VideoEffect, VideoSettings } from '@/types';

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

  let processed: SegmentData[] = segments.map((segment) => ({ ...segment }));
  const actualCostLines: CostLine[] = (scriptGenerationCostLines ?? [])
    .filter((line) => line.step === 'script_generation')
    .slice(0, 1);
  const usage: Record<string, number> = {
    generatedImages: 0,
    regeneratedImages: 0,
    serperQueries: 0,
    googleImageSelections: 0,
    imagenImages: 0,
  };

  const parallelTasks: Promise<void>[] = [];
  const imagesAlreadyReady = processed.every((segment) => !!segment.localImagePath);

  if (settings.imageSource === 'google' && !imagesAlreadyReady) {
    await supabase
      .from('videos')
      .update({ status: 'generating_images', current_step: 'generating_images', updated_at: new Date().toISOString() })
      .eq('id', videoId);
    send({ type: 'step', step: 'images', message: 'Hledám obrázky na Google...', total: segments.length });
    parallelTasks.push(
      Promise.all(
        processed.map(async (seg, i) => {
          try {
            const candidates = await searchImageCandidateDetails(seg.keywords, 10);
            const ranked = await rankGoogleImageCandidates(
              candidates,
              seg.text,
              fullOriginalScript,
              settings.orientation,
            );
            usage.googleImageSelections += 1;
            const localImagePath = await downloadImage(ranked.map((candidate) => candidate.imageUrl), seg.id);
            usage.serperQueries += 1;
            processed[i] = { ...processed[i], localImagePath };
            send({ type: 'image_ready', index: i, imageUrl: localImagePath });
          } catch (err) {
            console.error(`[img ${i}]`, err);
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
  const effects = await effectsPromise;
  if (effects.length > 0) {
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
    .update({ current_step: 'audio_enhancement', updated_at: new Date().toISOString() })
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

  const providerLabel = settings.ttsProvider === 'gemini' ? 'Gemini TTS' : 'OpenAI TTS';
  await supabase
    .from('videos')
    .update({ status: 'generating_voice', current_step: 'generating_voice', updated_at: new Date().toISOString() })
    .eq('id', videoId);
  send({ type: 'step', step: 'tts', message: `Generuji voiceover (${providerLabel})...` });

  const { audioRelPath, audioAbsPath } = await generateVoiceoverFull(
    processed.map((s) => s.audioText ?? s.text),
    videoId,
    settings,
  );
  const audioDurationSeconds = processed.reduce((sum, segment) => sum + (segment.audioDuration ?? segment.duration ?? 0), 0);

  const audioAsset = await uploadLocalAsset({
    supabase,
    userId,
    projectId,
    videoId,
    folder: 'audio',
    localPath: audioAbsPath,
  });
  await supabase.from('video_assets').insert({
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
    metadata: { audioRelPath },
  });
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
  } else {
    const model = settings.voicePreset === 'custom' ? 'gpt-4o-mini-tts' : settings.hdQuality ? 'tts-1-hd' : 'tts-1';
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
    return [];
  });
  actualCostLines.push({
    provider: 'openai',
    model: 'whisper-1',
    step: 'transcription',
    usage: { audioSeconds: audioDurationSeconds, words: sttWords.length },
    costUsd: roundCost((audioDurationSeconds / 60) * PRICING.openai['whisper-1'].usdPerMinute),
  });

  mapSTTToSegments(sttWords, processed);

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
  await supabase.from('video_assets').insert({
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
  });

  await supabase
    .from('videos')
    .update({ status: 'rendering', current_step: 'rendering', segments: processed, updated_at: new Date().toISOString() })
    .eq('id', videoId);
  send({ type: 'step', step: 'rendering', message: 'Renderuji video...' });

  const videoUrl = await renderVideo(processed, videoId, settings, audioRelPath, (pct) => {
    send({ type: 'render_progress', progress: pct });
    void supabase
      .from('videos')
      .update({ render_progress: pct, updated_at: new Date().toISOString() })
      .eq('id', videoId);
  });

  await supabase
    .from('videos')
    .update({ status: 'uploading', current_step: 'uploading', updated_at: new Date().toISOString() })
    .eq('id', videoId);

  const imageAssetRows = [];
  for (const [index, seg] of processed.entries()) {
    if (!seg.localImagePath) continue;
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
      imageAssetRows.push({
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
        },
      });
      usage.generatedImages += 1;
      if (seg.imageGenMode === 'imagen') usage.imagenImages += 1;
    } catch (assetErr) {
      console.warn(`[asset image ${index}]`, assetErr);
    }
  }
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
  if (imageAssetRows.length > 0) {
    await supabase.from('video_assets').insert(imageAssetRows);
  }

  let thumbnailPath: string | null = null;
  const firstImage = processed.find((seg) => seg.localImagePath)?.localImagePath;
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
      await supabase.from('video_assets').insert({
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
      });
    } catch (thumbErr) {
      console.warn('[asset thumbnail]', thumbErr);
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
  await supabase.from('video_assets').insert({
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
  });

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
  const { data: allActualEvents } = await supabase
    .from('usage_events')
    .select('provider,model,step,usage,cost_usd')
    .eq('video_id', videoId)
    .eq('estimated', false);
  const allActualLines: CostLine[] = (allActualEvents ?? []).map((event) => ({
    provider: String(event.provider),
    model: event.model ? String(event.model) : undefined,
    step: String(event.step),
    usage: (event.usage ?? {}) as Record<string, number | string | boolean>,
    costUsd: Number(event.cost_usd ?? 0),
  }));
  const actualCostUsd = roundCost(allActualLines.reduce((sum, line) => sum + line.costUsd, 0));
  await supabase
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
    .eq('id', videoId);

  send({ type: 'done', videoUrl: finalSignedUrl ?? videoUrl, videoId });
}
