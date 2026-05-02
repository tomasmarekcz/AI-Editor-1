'use client';

import { useEffect, useMemo, useState } from 'react';
import type { ComponentType } from 'react';
import type { PlayerRef } from '@remotion/player';
import type { VideoInputProps } from '@/types';

interface Props {
  inputProps: VideoInputProps;
}

type PlayerComponent = ComponentType<{
  component: ComponentType<VideoInputProps>;
  inputProps: Record<string, unknown>;
  durationInFrames: number;
  fps: number;
  compositionWidth: number;
  compositionHeight: number;
  style: React.CSSProperties;
  controls: boolean;
  loop: boolean;
  ref?: React.Ref<PlayerRef>;
}>;

type CompositionComponent = ComponentType<VideoInputProps>;

export function RemotionPreview({ inputProps }: Props) {
  const [Player, setPlayer] = useState<PlayerComponent | null>(null);
  const [VideoComposition, setVideoComposition] = useState<CompositionComponent | null>(null);
  const [error, setError] = useState('');

  const isVertical = inputProps.orientation === 'vertical';
  const compWidth = isVertical ? 1080 : 1920;
  const compHeight = isVertical ? 1920 : 1080;
  const fps = 30;

  const durationInFrames = useMemo(() => {
    const hasTimestamps = inputProps.segments.some((s) => s.endTime != null);
    const totalSeconds = hasTimestamps
      ? Math.max(1, ...inputProps.segments.map((s) => s.endTime ?? 0))
      : inputProps.segments.reduce((sum, s) => sum + (s.audioDuration ?? s.duration ?? 3), 0);
    return Math.max(30, Math.ceil(totalSeconds * fps));
  }, [inputProps.segments]);

  useEffect(() => {
    let mounted = true;
    setError('');

    Promise.all([
      import('@remotion/player'),
      import('@/remotion/VideoComposition'),
    ])
      .then(([playerMod, compositionMod]) => {
        if (!mounted) return;
        setPlayer(() => playerMod.Player as unknown as PlayerComponent);
        setVideoComposition(() => compositionMod.VideoComposition as CompositionComponent);
      })
      .catch((err) => {
        console.error('[RemotionPreview] Failed to load player:', err);
        if (mounted) {
          setError(err instanceof Error ? err.message : 'Preview failed to load.');
        }
      });

    return () => {
      mounted = false;
    };
  }, []);

  const aspectRatio = isVertical ? '9/16' : '16/9';

  return (
    <div
      style={{ aspectRatio, background: '#000', borderRadius: '0.5rem', overflow: 'hidden', position: 'relative' }}
      className="w-full"
    >
      {Player && VideoComposition ? (
        <Player
          component={VideoComposition}
          inputProps={inputProps as unknown as Record<string, unknown>}
          durationInFrames={durationInFrames}
          fps={fps}
          compositionWidth={compWidth}
          compositionHeight={compHeight}
          style={{ width: '100%', height: '100%', borderRadius: '0.5rem', overflow: 'hidden' }}
          controls
          loop
        />
      ) : (
        <div className="absolute inset-0 flex items-center justify-center p-4 text-center text-xs text-gray-500">
          {error ? (
            <span className="text-red-300">Náhled se nepodařilo načíst: {error}</span>
          ) : (
            'Načítám náhled…'
          )}
        </div>
      )}
    </div>
  );
}
