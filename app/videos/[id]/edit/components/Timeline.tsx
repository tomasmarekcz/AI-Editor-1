'use client';

import { useRef, useState } from 'react';
import type { SegmentData } from '@/types';

interface Props {
  segments: SegmentData[];
  imageUrlsByIndex: Record<number, string>;
  previewImageUrls: Record<number, string>;
  selectedIdx: number | null;
  onSelect: (idx: number) => void;
  zoomPxPerSec: number;
  onZoomChange: (px: number) => void;
}

const EFFECT_ICONS: Record<string, string> = {
  flash: '⚡',
  'zoom-burst': '🔍',
  shake: '💥',
  glitch: '📺',
};

const TRANSITION_ICONS: Record<string, string> = {
  cut: '✂',
  dissolve: '◌',
  fade: '',
};

export function Timeline({
  segments,
  imageUrlsByIndex,
  previewImageUrls,
  selectedIdx,
  onSelect,
  zoomPxPerSec,
  onZoomChange,
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [hoveredIdx, setHoveredIdx] = useState<number | null>(null);

  const totalDuration = segments.reduce((sum, s) => {
    const dur = s.endTime != null && s.startTime != null
      ? s.endTime - s.startTime
      : s.audioDuration ?? s.duration ?? 3;
    return sum + dur;
  }, 0);

  return (
    <div className="flex flex-col h-full select-none">
      {/* Toolbar */}
      <div className="flex-none flex items-center gap-3 px-3 py-1.5 border-b border-gray-800">
        <span className="text-[10px] font-black uppercase tracking-[0.2em] text-gray-500">
          Timeline
        </span>
        <span className="text-[10px] text-gray-600">
          {segments.length} scén · {totalDuration.toFixed(1)}s
        </span>
        <div className="ml-auto flex items-center gap-1">
          <button
            onClick={() => onZoomChange(Math.max(30, zoomPxPerSec - 15))}
            className="w-6 h-6 rounded border border-gray-700 text-gray-400 hover:border-gray-500 hover:text-white transition text-xs flex items-center justify-center"
          >−</button>
          <span className="text-[10px] text-gray-600 w-10 text-center">{zoomPxPerSec}px/s</span>
          <button
            onClick={() => onZoomChange(Math.min(200, zoomPxPerSec + 15))}
            className="w-6 h-6 rounded border border-gray-700 text-gray-400 hover:border-gray-500 hover:text-white transition text-xs flex items-center justify-center"
          >+</button>
        </div>
      </div>

      {/* Scrollable track */}
      <div
        ref={containerRef}
        className="flex-1 overflow-x-auto overflow-y-hidden flex items-center gap-0.5 px-3 py-2"
        style={{ scrollbarWidth: 'thin', scrollbarColor: '#374151 transparent' }}
      >
        {segments.map((seg, i) => {
          const segDur = seg.endTime != null && seg.startTime != null
            ? seg.endTime - seg.startTime
            : seg.audioDuration ?? seg.duration ?? 3;

          const blockWidth = Math.max(64, Math.round(segDur * zoomPxPerSec));
          const isSelected = selectedIdx === i;
          const isHovered = hoveredIdx === i;
          const isRemoved = (seg as SegmentData & { _removed?: boolean })._removed;
          const imgUrl = previewImageUrls[i] ?? imageUrlsByIndex[i] ?? seg.imageUrl;
          const effectIcon = seg.effect && seg.effect !== 'none' ? EFFECT_ICONS[seg.effect] : null;
          const transIcon = seg.transition ? TRANSITION_ICONS[seg.transition] : null;

          return (
            <div key={seg.id} className="relative flex-none flex items-center">
              {/* Scene block */}
              <button
                onClick={() => onSelect(i)}
                onMouseEnter={() => setHoveredIdx(i)}
                onMouseLeave={() => setHoveredIdx(null)}
                style={{ width: blockWidth }}
                className={[
                  'relative h-[90px] rounded-lg overflow-hidden border-2 transition-all duration-100 cursor-pointer flex-none',
                  isSelected
                    ? 'border-cyan-400 shadow-[0_0_12px_rgba(34,211,238,0.4)] scale-[1.02] z-10'
                    : isHovered
                      ? 'border-gray-500'
                      : 'border-gray-700',
                  isRemoved ? 'opacity-30 grayscale' : '',
                ].join(' ')}
              >
                {/* Thumbnail */}
                {imgUrl ? (
                  <img
                    src={imgUrl}
                    alt=""
                    className="absolute inset-0 w-full h-full object-cover"
                    draggable={false}
                  />
                ) : (
                  <div className="absolute inset-0 bg-gradient-to-br from-gray-900 to-gray-800" />
                )}

                {/* Dark overlay */}
                <div className="absolute inset-0 bg-gradient-to-t from-gray-950/80 via-transparent to-gray-950/30" />

                {/* Scene number */}
                <span className="absolute top-1 left-1.5 text-[10px] font-black text-white/90 leading-none">
                  {i + 1}
                </span>

                {/* Effect + KB badge */}
                {effectIcon && (
                  <span className="absolute top-1 right-1.5 text-[11px] leading-none">
                    {effectIcon}
                  </span>
                )}

                {/* Duration */}
                <span className="absolute bottom-1 right-1.5 text-[9px] font-bold text-white/70 leading-none">
                  {segDur.toFixed(1)}s
                </span>

                {/* Transition icon (left edge) */}
                {transIcon && (
                  <span className="absolute bottom-1 left-1.5 text-[9px] text-white/50">
                    {transIcon}
                  </span>
                )}

                {/* Selected indicator */}
                {isSelected && (
                  <div className="absolute inset-x-0 bottom-0 h-0.5 bg-cyan-400" />
                )}

                {/* Removed overlay */}
                {isRemoved && (
                  <div className="absolute inset-0 flex items-center justify-center">
                    <span className="text-[9px] font-bold text-red-400 uppercase tracking-wider rotate-[-8deg]">
                      Smazáno
                    </span>
                  </div>
                )}
              </button>

              {/* Gap indicator between scenes */}
              {i < segments.length - 1 && (
                <div className="flex-none w-0.5 h-8 bg-gray-800 mx-0.5 rounded-full" />
              )}
            </div>
          );
        })}

        {/* End padding */}
        <div className="flex-none w-8" />
      </div>
    </div>
  );
}
