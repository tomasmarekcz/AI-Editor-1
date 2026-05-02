'use client';

import type { SegmentData } from '@/types';

interface Props {
  segments: Array<SegmentData & { _removed?: boolean }>;
  imageUrlsByIndex: Record<number, string>;
  selectedIdx: number | null;
  onSelect: (idx: number) => void;
}

export function SceneList({ segments, imageUrlsByIndex, selectedIdx, onSelect }: Props) {
  return (
    <div className="flex gap-2 overflow-x-auto pb-2">
      {segments.map((seg, i) => {
        const isRemoved = (seg as SegmentData & { _removed?: boolean })._removed;
        const isSelected = selectedIdx === i;
        const imgUrl = imageUrlsByIndex[i] ?? seg.imageUrl;
        const duration = seg.endTime != null && seg.startTime != null
          ? (seg.endTime - seg.startTime).toFixed(1)
          : (seg.duration ?? 3).toFixed(1);

        return (
          <button
            key={seg.id}
            onClick={() => onSelect(i)}
            className={[
              'group relative flex-shrink-0 w-28 rounded-lg border-2 transition-all duration-150 text-left overflow-hidden',
              isSelected
                ? 'border-cyan-400 shadow-lg shadow-cyan-400/20'
                : 'border-gray-700 hover:border-gray-500',
              isRemoved ? 'opacity-40' : '',
            ].join(' ')}
          >
            {/* Thumbnail */}
            <div className="aspect-video w-full bg-gray-900 overflow-hidden">
              {imgUrl ? (
                <img src={imgUrl} alt="" className="w-full h-full object-cover" />
              ) : (
                <div className="w-full h-full flex items-center justify-center">
                  <span className="text-gray-600 text-[10px]">No image</span>
                </div>
              )}
            </div>

            {/* Scene info */}
            <div className="px-1.5 py-1 bg-gray-950/80">
              <div className="flex items-center justify-between gap-1">
                <span className="text-[9px] font-bold text-gray-400">#{i + 1}</span>
                <span className="text-[9px] text-gray-500">{duration}s</span>
              </div>
              <p className="line-clamp-2 text-[9px] leading-tight text-gray-300 mt-0.5">
                {seg.text}
              </p>
              {seg.effect && seg.effect !== 'none' && (
                <span className="mt-0.5 inline-block rounded px-1 py-px text-[8px] font-bold uppercase bg-purple-500/20 text-purple-300">
                  {seg.effect}
                </span>
              )}
            </div>

            {/* Removed overlay */}
            {isRemoved && (
              <div className="absolute inset-0 flex items-center justify-center bg-gray-950/70">
                <span className="text-[10px] font-bold text-red-400 uppercase tracking-wider">Odstraněno</span>
              </div>
            )}
          </button>
        );
      })}
    </div>
  );
}
