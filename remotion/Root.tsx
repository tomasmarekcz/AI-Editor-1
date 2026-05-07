import React from 'react';
import { Composition } from 'remotion';
import { VideoComposition, calculateMetadata } from './VideoComposition';
import type { VideoInputProps } from '@/types';

const DEFAULT_SUBTITLE: VideoInputProps['subtitle'] = {
  font: 'Arial Black',
  allCaps: false,
  highlight: true,
  chunkSize: 3,
  positionY: 10,
  color: '#ffffff',
  highlightColor: '#FFE400',
  captionStrokeColor: '#000000',
  captionStrokeWidth: 0,
  sizeScale: 1.0,
  animation: 'none',
};

const VideoCompositionForRemotion = VideoComposition as unknown as React.FC<Record<string, unknown>>;
const calculateMetadataForRemotion = calculateMetadata as unknown as (options: {
  props: Record<string, unknown>;
}) => ReturnType<typeof calculateMetadata>;

export const RemotionRoot: React.FC = () => {
  return (
    <Composition
      id="VideoComposition"
      component={VideoCompositionForRemotion}
      fps={30}
      width={1920}
      height={1080}
      defaultProps={
        {
          segments: [],
          fps: 30,
          orientation: 'horizontal',
          subtitle: DEFAULT_SUBTITLE,
        } as VideoInputProps
      }
      calculateMetadata={calculateMetadataForRemotion}
    />
  );
};
