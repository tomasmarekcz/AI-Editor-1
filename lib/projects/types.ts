import type { VideoSettings } from '@/types';

export type Project = {
  id: string;
  user_id: string;
  account_id: string;
  name: string;
  niche: string;
  language: string;
  voice_style: string;
  visual_style: string;
  caption_style: string;
  default_project_prompt: string;
  default_visual_prompt: string;
  default_settings: Partial<VideoSettings> | null;
  created_at: string;
  updated_at: string;
};

export type ProjectFormValues = {
  name: string;
  niche: string;
  language: string;
  voice_style: string;
  visual_style: string;
  caption_style: string;
  default_project_prompt: string;
  default_visual_prompt: string;
  ttsProvider: VideoSettings['ttsProvider'];
  orientation: VideoSettings['orientation'];
  imageSource: VideoSettings['imageSource'];
};

export type VideoStatus =
  | 'queued'
  | 'processing'
  | 'generating'
  | 'processing_images'
  | 'generating_images'
  | 'generating_voice'
  | 'transcribing'
  | 'rendering'
  | 'uploading'
  | 'done'
  | 'failed';

export type SavedVideo = {
  id: string;
  user_id: string;
  account_id: string;
  project_id: string;
  title: string;
  status: VideoStatus;
  original_script: string;
  enhanced_script: string;
  settings: Partial<VideoSettings>;
  segments: unknown[];
  render_progress: number;
  duration_seconds: number | null;
  final_video_path: string | null;
  final_video_mime_type: string | null;
  final_video_size_bytes: number | null;
  thumbnail_path: string | null;
  error_message: string | null;
  estimated_cost_usd: number | null;
  actual_cost_usd: number | null;
  cost_breakdown: Record<string, unknown>;
  usage: Record<string, unknown>;
  estimated_usage: Record<string, unknown>;
  generated_images_count: number;
  regenerated_images_count: number;
  serper_queries_count: number;
  tts_duration_seconds: number | null;
  transcription_duration_seconds: number | null;
  render_duration_seconds: number | null;
  started_at: string;
  completed_at: string | null;
  created_at: string;
  updated_at: string;
  // Editor fields (added in video-editor migration)
  edited_settings: unknown | null;
  edited_segments: unknown[] | null;
  edited_video_path: string | null;
  edited_video_size_bytes: number | null;
};

export type VideoAsset = {
  id: string;
  user_id: string;
  account_id: string;
  project_id: string;
  video_id: string;
  kind: 'image' | 'uploaded_image' | 'audio' | 'subtitles' | 'final_video' | 'thumbnail';
  segment_id: string | null;
  segment_index: number | null;
  storage_bucket: string;
  storage_path: string;
  mime_type: string | null;
  size_bytes: number | null;
  prompt: string | null;
  source: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
};

export type VideoHistoryItem = Pick<
  SavedVideo,
  'id' | 'title' | 'status' | 'created_at' | 'completed_at' | 'render_progress' | 'final_video_path' | 'thumbnail_path' | 'error_message'
  | 'estimated_cost_usd' | 'actual_cost_usd'
> & {
  finalVideoUrl?: string | null;
  thumbnailUrl?: string | null;
};

export type ProjectCreateVideoItem = Pick<
  SavedVideo,
  'id' | 'title' | 'status' | 'created_at' | 'completed_at' | 'render_progress' | 'thumbnail_path' | 'error_message'
  | 'estimated_cost_usd' | 'actual_cost_usd' | 'duration_seconds'
> & {
  thumbnailUrl?: string | null;
};
