import path from 'path';
import fs from 'fs';
import http from 'http';
import { bundle } from '@remotion/bundler';
import { renderMedia, selectComposition } from '@remotion/renderer';
import type { SegmentData, SubtitleSettings, VideoSettings, VideoInputProps } from '@/types';

type RenderBitrate = `${number}k` | `${number}K` | `${number}M`;
type X264Preset = 'ultrafast' | 'superfast' | 'veryfast' | 'faster' | 'fast' | 'medium' | 'slow' | 'slower' | 'veryslow' | 'placebo';

let cachedBundle: string | null = null;
let assetServerPromise: Promise<string> | null = null;

const DEFAULT_SUBTITLE: SubtitleSettings = {
  font: 'Arial Black',
  allCaps: false,
  highlight: true,
  chunkSize: 3,
  positionY: 10,
  color: '#ffffff',
  highlightColor: '#FFE400',
  sizeScale: 1,
  animation: 'none',
};

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

const publicRelPathToAbsPath = (relPath: string): string => {
  return path.join(process.cwd(), 'public', relPath.startsWith('/') ? relPath.slice(1) : relPath);
};

const mimeFromPath = (filePath: string): string => {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === '.png') return 'image/png';
  if (ext === '.webp') return 'image/webp';
  if (ext === '.gif') return 'image/gif';
  if (ext === '.mp3') return 'audio/mpeg';
  if (ext === '.aac') return 'audio/aac';
  if (ext === '.wav') return 'audio/wav';
  if (ext === '.m4a') return 'audio/mp4';
  if (ext === '.mp4') return 'video/mp4';
  return ext === '.jpg' || ext === '.jpeg' ? 'image/jpeg' : 'application/octet-stream';
};

const startAssetServer = async (): Promise<string> => {
  if (assetServerPromise) return assetServerPromise;

  assetServerPromise = new Promise((resolve, reject) => {
    const publicDir = path.join(process.cwd(), 'public');
    const server = http.createServer((req, res) => {
      try {
        const requestUrl = new URL(req.url ?? '/', 'http://127.0.0.1');
        const decodedPath = decodeURIComponent(requestUrl.pathname);
        const absPath = path.resolve(publicDir, decodedPath.replace(/^\/+/, ''));

        if (!absPath.startsWith(publicDir + path.sep)) {
          res.writeHead(403);
          res.end('Forbidden');
          return;
        }

        if (!fs.existsSync(absPath) || !fs.statSync(absPath).isFile()) {
          res.writeHead(404);
          res.end('Not found');
          return;
        }

        res.writeHead(200, {
          'Content-Type': mimeFromPath(absPath),
          'Cache-Control': 'no-store',
        });
        fs.createReadStream(absPath).pipe(res);
      } catch (err) {
        res.writeHead(500);
        res.end(err instanceof Error ? err.message : 'Internal error');
      }
    });

    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (!address || typeof address === 'string') {
        reject(new Error('Could not start local asset server.'));
        return;
      }
      const baseUrl = `http://127.0.0.1:${address.port}`;
      console.log('[render] local asset server started', { baseUrl });
      resolve(baseUrl);
    });
  });

  return assetServerPromise;
};

const normalizeSubtitle = (subtitle: VideoSettings['subtitle'] | undefined): SubtitleSettings => ({
  ...DEFAULT_SUBTITLE,
  ...(subtitle ?? {}),
  chunkSize: subtitle?.chunkSize ?? DEFAULT_SUBTITLE.chunkSize,
  positionY: typeof subtitle?.positionY === 'number' ? subtitle.positionY : DEFAULT_SUBTITLE.positionY,
  sizeScale: typeof subtitle?.sizeScale === 'number' && subtitle.sizeScale > 0 ? subtitle.sizeScale : DEFAULT_SUBTITLE.sizeScale,
});

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
  const localAssetBaseUrl = await startAssetServer();

  const resolvedSegments: SegmentData[] = segments.map((seg) => {
    let imageUrl: string | undefined;
    if (seg.localImagePath) {
      const absPath = publicRelPathToAbsPath(seg.localImagePath);
      if (fs.existsSync(absPath) && fs.statSync(absPath).size > 1024) {
        imageUrl = `${localAssetBaseUrl}${seg.localImagePath}`;
      } else if (seg.imageUrl?.startsWith('http')) {
        imageUrl = seg.imageUrl;
      }
    } else if (seg.imageUrl?.startsWith('http')) {
      imageUrl = seg.imageUrl;
    }

    return {
      ...seg,
      imageUrl,
      audioPath: seg.audioPath ? `${baseUrl}${seg.audioPath}` : undefined,
    };
  });

  let audioUrl: string | undefined;
  if (audioRelPath) {
    const audioAbsPath = publicRelPathToAbsPath(audioRelPath);
    audioUrl = fs.existsSync(audioAbsPath)
      ? `${localAssetBaseUrl}${audioRelPath}`
      : `${baseUrl}/api/audio?path=${encodeURIComponent(audioRelPath)}`;
  }

  const inputProps: VideoInputProps = {
    segments: resolvedSegments,
    fps: 30,
    orientation: settings.orientation,
    subtitle: normalizeSubtitle(settings.subtitle),
    audioUrl,
  };

  const composition = await selectComposition({
    serveUrl: cachedBundle,
    id: 'VideoComposition',
    inputProps: inputProps as unknown as Record<string, unknown>,
  });

  const renderScale = parsePositiveNumberEnv('RENDER_SCALE', process.env.NODE_ENV === 'production' ? 0.5 : 1);
  const renderConcurrency = parseIntegerEnv('RENDER_CONCURRENCY', process.env.NODE_ENV === 'production' ? 1 : 2);
  const ffmpegThreads = parseIntegerEnv('RENDER_FFMPEG_THREADS', process.env.NODE_ENV === 'production' ? 1 : 4);
  const videoBitrate = (process.env.RENDER_VIDEO_BITRATE ?? (process.env.NODE_ENV === 'production' ? '1800k' : '6M')) as RenderBitrate;
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
    segments: resolvedSegments.length,
    segmentsWithImages: resolvedSegments.filter((segment) => !!segment.imageUrl).length,
    segmentsWithWordTimings: resolvedSegments.filter((segment) => (segment.wordTimings?.length ?? 0) > 0).length,
    subtitlesEnabled: !!inputProps.subtitle,
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
    offthreadVideoCacheSizeInBytes: 16 * 1024 * 1024,
    mediaCacheSizeInBytes: 16 * 1024 * 1024,
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
