import path from 'path';
import fs from 'fs';
import { bundle } from '@remotion/bundler';
import { renderMedia, selectComposition } from '@remotion/renderer';
import type { SegmentData, VideoSettings, VideoInputProps } from '@/types';

type RenderBitrate = `${number}k` | `${number}K` | `${number}M`;
type X264Preset = 'ultrafast' | 'superfast' | 'veryfast' | 'faster' | 'fast' | 'medium' | 'slow' | 'slower' | 'veryslow' | 'placebo';

let cachedBundle: string | null = null;

const parsePositiveNumberEnv = (name: string, fallback: number): number => {
  const value = process.env[name];
  if (!value) return fallback;

  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};

const parseIntegerEnv = (name: string, fallback: number): number => {
  return Math.max(1, Math.round(parsePositiveNumberEnv(name, fallback)));
};

const insertBeforeOutput = (args: string[], values: string[]): string[] => {
  if (args.length === 0) return values;

  return [
    ...args.slice(0, -1),
    ...values,
    args[args.length - 1],
  ];
};

export async function renderVideo(
  segments: SegmentData[],
  jobId: string,
  settings: VideoSettings,
  audioRelPath: string,
  onProgress?: (pct: number) => void,
): Promise<string> {
  const outputDir = path.join(process.cwd(), 'public', 'tmp', 'videos');
  fs.mkdirSync(outputDir, { recursive: true });
  const outputPath = path.join(outputDir, `${jobId}.mp4`);

  if (!cachedBundle || !fs.existsSync(cachedBundle)) {
    cachedBundle = await bundle({
      entryPoint: path.join(process.cwd(), 'remotion', 'index.ts'),
      // Serve public/ so /fonts/TheBoldFont-Bold.ttf resolves during rendering
      publicDir: path.join(process.cwd(), 'public'),
      webpackOverride: (config) => ({
        ...config,
        resolve: {
          ...config.resolve,
          alias: { ...(config.resolve?.alias ?? {}), '@': process.cwd() },
        },
      }),
    });
  }

  const baseUrl = process.env.BASE_URL ?? 'http://localhost:3000';

  const resolvedSegments: SegmentData[] = segments.map((seg) => {
    // Local images are in public/tmp/images/ and served by Next.js over HTTP.
    // Verify the file actually exists and is non-empty before passing the URL
    // to Remotion — if it's missing/bad, fall back to the gradient background.
    let imageUrl: string | undefined;
    if (seg.localImagePath) {
      const absPath = path.join(process.cwd(), 'public', seg.localImagePath);
      if (fs.existsSync(absPath) && fs.statSync(absPath).size > 1024) {
        // Use the dedicated /api/image route — explicit content-type, always 200.
        // Avoids Next.js static-file quirks (wrong mime types, 404 race conditions).
        imageUrl = `${baseUrl}/api/image?path=${encodeURIComponent(seg.localImagePath)}`;
      }
      // Missing or tiny file → no imageUrl → Segment renders gradient background
    }
    // NOTE: we intentionally ignore seg.imageUrl (the raw Google URL) because
    // Google URLs often redirect, 403, or return HTML — unreliable in a headless renderer.

    return {
      ...seg,
      imageUrl,
      audioPath: seg.audioPath ? `${baseUrl}${seg.audioPath}` : undefined,
    };
  });

  const audioUrl = audioRelPath
    ? `${baseUrl}/api/audio?path=${encodeURIComponent(audioRelPath)}`
    : undefined;

  const inputProps: VideoInputProps = {
    segments: resolvedSegments,
    fps: 30,
    orientation: settings.orientation,
    subtitle: settings.subtitle,
    audioUrl,
  };

  const composition = await selectComposition({
    serveUrl: cachedBundle,
    id: 'VideoComposition',
    inputProps: inputProps as unknown as Record<string, unknown>,
  });

  const renderScale = parsePositiveNumberEnv('RENDER_SCALE', process.env.NODE_ENV === 'production' ? 0.6667 : 1);
  const renderConcurrency = parseIntegerEnv('RENDER_CONCURRENCY', process.env.NODE_ENV === 'production' ? 1 : 2);
  const ffmpegThreads = parseIntegerEnv('RENDER_FFMPEG_THREADS', process.env.NODE_ENV === 'production' ? 2 : 4);
  const videoBitrate = (process.env.RENDER_VIDEO_BITRATE ?? (process.env.NODE_ENV === 'production' ? '2500k' : '6M')) as RenderBitrate;
  const audioBitrate = (process.env.RENDER_AUDIO_BITRATE ?? (process.env.NODE_ENV === 'production' ? '128k' : '320k')) as RenderBitrate;
  const jpegQuality = parseIntegerEnv('RENDER_JPEG_QUALITY', process.env.NODE_ENV === 'production' ? 82 : 90);
  const x264Preset = (process.env.RENDER_X264_PRESET ?? (process.env.NODE_ENV === 'production' ? 'ultrafast' : 'veryfast')) as X264Preset;

  console.log('[render] starting remotion render', {
    jobId,
    durationInFrames: composition.durationInFrames,
    fps: composition.fps,
    width: composition.width,
    height: composition.height,
    outputWidth: Math.round(composition.width * renderScale),
    outputHeight: Math.round(composition.height * renderScale),
    renderScale,
    renderConcurrency,
    ffmpegThreads,
    videoBitrate,
    audioBitrate,
    jpegQuality,
    x264Preset,
  });

  await renderMedia({
    composition,
    serveUrl: cachedBundle,
    codec: 'h264',
    videoBitrate,
    audioBitrate,
    x264Preset,
    scale: renderScale,
    concurrency: renderConcurrency,
    disallowParallelEncoding: true,
    jpegQuality,
    offthreadVideoCacheSizeInBytes: 64 * 1024 * 1024,
    mediaCacheSizeInBytes: 64 * 1024 * 1024,
    ffmpegOverride: ({ type, args }) => (
      type === 'stitcher'
        ? insertBeforeOutput(args, ['-threads', String(ffmpegThreads)])
        : args
    ),
    outputLocation: outputPath,
    inputProps: inputProps as unknown as Record<string, unknown>,
    onProgress: ({ progress }) => onProgress?.(Math.round(progress * 100)),
  });

  console.log('[render] finished remotion render', { jobId, outputPath });

  return `/tmp/videos/${jobId}.mp4`;
}
