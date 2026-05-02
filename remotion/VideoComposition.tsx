import React from 'react';
import { AbsoluteFill, Audio, Sequence, useVideoConfig } from 'remotion';
import { Segment } from './Segment';
import { FontLoader } from './FontLoader';
import type { VideoInputProps } from '@/types';

const toPositiveSeconds = (value: number | undefined, fallback = 1): number => (
  typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : fallback
);

export const calculateMetadata = ({ props }: { props: VideoInputProps }) => {
  const fps = 30;
  const isVertical = props.orientation === 'vertical';

  // New single-audio flow: total length = last segment's endTime
  const hasTimestamps = props.segments.some((s) => s.endTime != null);
  const totalSeconds = hasTimestamps
    ? Math.max(...props.segments.map((s) => toPositiveSeconds(s.endTime, 0)))
    : props.segments.reduce((sum, s) => sum + toPositiveSeconds(s.audioDuration ?? s.duration), 0);

  return {
    durationInFrames: Math.max(1, Math.ceil(totalSeconds * fps)),
    fps,
    width: isVertical ? 1080 : 1920,
    height: isVertical ? 1920 : 1080,
  };
};

export const VideoComposition: React.FC<VideoInputProps> = ({
  segments,
  subtitle,
  audioUrl,
}) => {
  const { fps } = useVideoConfig();

  // Whether we're using the new single-audio flow
  const hasGlobalAudio = !!audioUrl;
  const hasTimestamps  = segments.some((s) => s.startTime != null);

  let accumulatedFrame = 0;

  return (
    <AbsoluteFill style={{ backgroundColor: '#000' }}>
      <FontLoader />

      {/* Single voiceover audio track — plays from frame 0 through entire video */}
      {hasGlobalAudio && <Audio src={audioUrl} />}

      {segments.map((segment, i) => {
        let from: number;
        let durationInFrames: number;

        if (hasGlobalAudio && hasTimestamps && segment.startTime != null) {
          // New flow: position each segment by its real audio timestamps
          const startSec   = Math.max(
            0,
            typeof segment.startTime === 'number' && Number.isFinite(segment.startTime) ? segment.startTime : 0,
          );
          from             = Math.round(startSec * fps);
          const fallbackEnd = startSec + toPositiveSeconds(segment.audioDuration ?? segment.duration);
          const rawEndSec   = typeof segment.endTime === 'number' && Number.isFinite(segment.endTime)
            ? segment.endTime
            : fallbackEnd;
          const segDurSec   = toPositiveSeconds(rawEndSec - startSec);
          durationInFrames = Math.max(1, Math.ceil(segDurSec * fps));
        } else {
          // Legacy per-segment-audio flow
          from             = accumulatedFrame;
          const segDurSec  = toPositiveSeconds(segment.audioDuration ?? segment.duration);
          durationInFrames = Math.max(1, Math.ceil(segDurSec * fps));
          accumulatedFrame += durationInFrames;
        }

        return (
          <Sequence key={segment.id} from={from} durationInFrames={durationInFrames}>
            <Segment
              segment={segment}
              durationInFrames={durationInFrames}
              index={i}
              subtitle={subtitle}
            />
          </Sequence>
        );
      })}
    </AbsoluteFill>
  );
};
