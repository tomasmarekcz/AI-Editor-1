import type { VideoEffect, SubtitleAnimation, SubtitleFont, VideoSettings, SegmentData } from '@/types';

export type { VideoSettings, SegmentData };

// ── Patch schema ───────────────────────────────────────────────────────────

export interface CaptionPatch {
  fontSize?: number;          // subtitle.sizeScale  0.5–3.0
  positionY?: number;         // subtitle.positionY  0–100
  stylePreset?: SubtitleAnimation;
  highlightColor?: string;    // #rrggbb
  color?: string;             // #rrggbb
  font?: SubtitleFont;
  allCaps?: boolean;
  highlight?: boolean;
  chunkSize?: 1 | 2 | 3;
}

export interface EffectsPatch {
  enableEffects?: boolean;
  globalEffect?: VideoEffect; // applied to all scenes that don't have an explicit override
}

export interface TrimPatch {
  startSeconds?: number;  // scene-level: skip segments ending before this
  endSeconds?: number;    // scene-level: skip segments starting after this
}

export interface ScenePatch {
  remove?: boolean;
  effect?: VideoEffect;
  kbPreset?: 0 | 1 | 2 | 3 | 4;
  transition?: 'fade' | 'cut' | 'dissolve';
  newImagePrompt?: string;  // triggers image regen on next re-render
}

export interface VideoEditPatch {
  captions?: CaptionPatch;
  effects?: EffectsPatch;
  trim?: TrimPatch;
  scenes?: Record<number, ScenePatch>; // segment index → patch
  visualMood?: string;                 // informational hint for AI, not applied directly
}

// ── DB row ─────────────────────────────────────────────────────────────────

export type VideoEdit = {
  id: string;
  video_id: string;
  user_id: string;
  version_number: number;
  patch: VideoEditPatch;
  prompt: string | null;
  applied_fields: string[];
  created_at: string;
};

// ── Editor state helpers ───────────────────────────────────────────────────

export type EditorSaveStatus = 'unsaved' | 'saving' | 'saved' | 'error';

// Extended SavedVideo with editable fields (returned from edit page RSC)
export type EditorVideoData = {
  id: string;
  project_id: string;
  title: string;
  original_script: string;
  enhanced_script: string | null;
  settings: Partial<VideoSettings>;
  segments: SegmentData[];
  edited_settings: Partial<VideoSettings> | null;
  edited_segments: SegmentData[] | null;
  edited_video_path: string | null;
  final_video_path: string | null;
  duration_seconds: number | null;
  // Resolved signed URLs keyed by segment_index
  imageUrlsByIndex: Record<number, string>;
  audioUrl: string | null;
  editedVideoUrl: string | null;
  finalVideoUrl: string | null;
  editHistory: VideoEdit[];
};
