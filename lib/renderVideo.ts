import path from 'path';
import fs from 'fs';
import { bundle } from '@remotion/bundler';
import { renderMedia, selectComposition } from '@remotion/renderer';
import type { SegmentData, VideoSettings, VideoInputProps } from '@/types';

let cachedBundle: string | null = null;

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

  const audioUrl = audioRelPath ? `${baseUrl}${audioRelPath}` : undefined;

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

  await renderMedia({
    composition,
    serveUrl: cachedBundle,
    codec: 'h264',
    videoBitrate: '6M',
    outputLocation: outputPath,
    inputProps: inputProps as unknown as Record<string, unknown>,
    onProgress: ({ progress }) => onProgress?.(Math.round(progress * 100)),
  });

  return `/tmp/videos/${jobId}.mp4`;
}
