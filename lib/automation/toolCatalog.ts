export type AutomationToolDefinition = {
  name: string;
  category: 'project' | 'ideation' | 'generation' | 'video' | 'editing' | 'rendering' | 'publishing' | 'observability';
  description: string;
  requiresHumanReview?: boolean;
  mutatesData: boolean;
};

export const VIDEO_AUTOMATION_TOOLS: AutomationToolDefinition[] = [
  {
    name: 'listProjects',
    category: 'project',
    description: 'List projects available in the current workspace.',
    mutatesData: false,
  },
  {
    name: 'getProject',
    category: 'project',
    description: 'Load one project including niche, language, prompts, visual style, and default settings.',
    mutatesData: false,
  },
  {
    name: 'updateProjectDefaults',
    category: 'project',
    description: 'Update project-level default settings, prompt, visual style, voice style, or caption style.',
    mutatesData: true,
    requiresHumanReview: true,
  },
  {
    name: 'brainstormTopics',
    category: 'ideation',
    description: 'Generate fresh short-form video topic ideas for a project while avoiding recent and rejected topics.',
    mutatesData: false,
  },
  {
    name: 'selectTopic',
    category: 'ideation',
    description: 'Pick the first usable topic from a candidate list while respecting rejected topics.',
    mutatesData: false,
  },
  {
    name: 'generateScript',
    category: 'generation',
    description: 'Generate a spoken short-form video script from a topic or prompt using the project context.',
    mutatesData: false,
  },
  {
    name: 'segmentScript',
    category: 'generation',
    description: 'Split a script into timed scene segments with keywords and subtitle chunking hints.',
    mutatesData: false,
  },
  {
    name: 'createVideoRecord',
    category: 'video',
    description: 'Create a saved video draft from a script and settings without queueing render.',
    mutatesData: true,
  },
  {
    name: 'createVideoFromPrompt',
    category: 'generation',
    description: 'Generate script, segment it, create a video, queue the render, and optionally trigger the worker.',
    mutatesData: true,
    requiresHumanReview: true,
  },
  {
    name: 'createVideoFromScript',
    category: 'generation',
    description: 'Segment an existing script, create a video, queue the render, and optionally trigger the worker.',
    mutatesData: true,
    requiresHumanReview: true,
  },
  {
    name: 'queueRender',
    category: 'rendering',
    description: 'Queue a video render from prepared segments/settings and optionally trigger the worker.',
    mutatesData: true,
  },
  {
    name: 'retryRender',
    category: 'rendering',
    description: 'Requeue a failed, done, or queued video render and optionally trigger the worker.',
    mutatesData: true,
  },
  {
    name: 'listVideos',
    category: 'video',
    description: 'List videos in the workspace, optionally filtered by project or status.',
    mutatesData: false,
  },
  {
    name: 'getVideo',
    category: 'video',
    description: 'Load one video with optional signed URLs for final video and thumbnail assets.',
    mutatesData: false,
  },
  {
    name: 'getVideoStatus',
    category: 'observability',
    description: 'Read a compact status/progress/error summary for one video.',
    mutatesData: false,
  },
  {
    name: 'listVideoAssets',
    category: 'observability',
    description: 'List generated assets for a video, optionally including temporary signed URLs.',
    mutatesData: false,
  },
  {
    name: 'listWorkerLogs',
    category: 'observability',
    description: 'Read recent worker logs for a video.',
    mutatesData: false,
  },
  {
    name: 'generateCaption',
    category: 'publishing',
    description: 'Generate a short social caption with hashtags for a video.',
    mutatesData: false,
  },
  {
    name: 'setThumbnailFromAsset',
    category: 'editing',
    description: 'Set an existing video asset as the current thumbnail.',
    mutatesData: true,
    requiresHumanReview: true,
  },
  {
    name: 'saveVideoEdit',
    category: 'editing',
    description: 'Save edited settings and edited scene segments for a video.',
    mutatesData: true,
    requiresHumanReview: true,
  },
  {
    name: 'applyVideoPatch',
    category: 'editing',
    description: 'Apply a structured edit patch to video settings/scenes and save it to edit history.',
    mutatesData: true,
    requiresHumanReview: true,
  },
  {
    name: 'regenerateSceneImage',
    category: 'editing',
    description: 'Regenerate one scene image with Google image search or AI image generation and save it as an edit.',
    mutatesData: true,
    requiresHumanReview: true,
  },
  {
    name: 'scheduleYouTubePublish',
    category: 'publishing',
    description: 'Schedule or reschedule a completed video for YouTube publishing.',
    mutatesData: true,
    requiresHumanReview: true,
  },
  {
    name: 'listScheduledPosts',
    category: 'publishing',
    description: 'List scheduled, published, failed, or cancelled social posts.',
    mutatesData: false,
  },
  {
    name: 'cancelScheduledPost',
    category: 'publishing',
    description: 'Cancel a draft, scheduled, or failed scheduled post.',
    mutatesData: true,
    requiresHumanReview: true,
  },
  {
    name: 'deleteVideo',
    category: 'video',
    description: 'Delete a video and its related scheduled posts, usage rows, assets, and storage files.',
    mutatesData: true,
    requiresHumanReview: true,
  },
];

export function listAutomationToolDefinitions() {
  return VIDEO_AUTOMATION_TOOLS;
}
