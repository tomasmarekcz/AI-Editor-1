import type { AutomationToolDefinition } from '@/lib/automation/toolCatalog';
import { VIDEO_AUTOMATION_TOOLS } from '@/lib/automation/toolCatalog';
import {
  applyVideoPatchTool,
  brainstormTopicsTool,
  cancelScheduledPostTool,
  createVideoFromPromptTool,
  createVideoFromScriptTool,
  createVideoRecordTool,
  deleteVideoTool,
  generateCaptionTool,
  generateScriptTool,
  getProjectTool,
  getVideoStatusTool,
  getVideoTool,
  listProjectsTool,
  listScheduledPostsTool,
  listVideoAssetsTool,
  listVideosTool,
  listWorkerLogsTool,
  queueRenderTool,
  regenerateSceneImageTool,
  retryRenderTool,
  saveVideoEditTool,
  scheduleYouTubePublishTool,
  segmentScriptTool,
  selectTopicTool,
  setThumbnailFromAssetTool,
  updateProjectDefaultsTool,
  type AutomationToolContext,
} from '@/lib/automation/videoTools';
import type { AgentScope } from '@/lib/automation/agentScopes';

type JsonSchema = {
  type: 'object';
  properties?: Record<string, unknown>;
  required?: string[];
  additionalProperties?: boolean;
};

export type McpAutomationTool = AutomationToolDefinition & {
  inputSchema: JsonSchema;
  requiredScopes?: AgentScope[];
};

export type McpAutomationCall = {
  name: string;
  arguments?: Record<string, unknown>;
};

type ToolHandler = (ctx: AutomationToolContext, args: Record<string, unknown>) => Promise<unknown>;

const stringProp = (description?: string) => ({ type: 'string', description });
const numberProp = (description?: string) => ({ type: 'number', description });
const booleanProp = (description?: string) => ({ type: 'boolean', description });
const objectProp = (description?: string) => ({ type: 'object', description, additionalProperties: true });
const arrayProp = (items: unknown, description?: string) => ({ type: 'array', items, description });

const anyObjectSchema = (properties: Record<string, unknown> = {}, required: string[] = []): JsonSchema => ({
  type: 'object',
  properties,
  required,
  additionalProperties: false,
});

export const MCP_AUTOMATION_TOOL_INPUT_SCHEMAS: Record<string, JsonSchema> = {
  listProjects: anyObjectSchema(),
  getProject: anyObjectSchema({ projectId: stringProp('Project id.') }, ['projectId']),
  updateProjectDefaults: anyObjectSchema({
    projectId: stringProp('Project id.'),
    defaultSettings: objectProp('Partial video settings to save as project defaults.'),
    defaultProjectPrompt: stringProp('Default project prompt.'),
    visualStyle: stringProp('Default visual style.'),
    voiceStyle: stringProp('Default voice style.'),
    captionStyle: stringProp('Default caption style.'),
  }, ['projectId']),
  brainstormTopics: anyObjectSchema({
    projectId: stringProp('Project id.'),
    rejectedTopics: arrayProp({ type: 'string' }, 'Topics to avoid.'),
    recentDays: numberProp('How many recent days of video titles to avoid.'),
  }, ['projectId']),
  selectTopic: anyObjectSchema({
    topics: arrayProp({ type: 'string' }, 'Candidate topics.'),
    rejectedTopics: arrayProp({ type: 'string' }, 'Topics to avoid.'),
  }, ['topics']),
  generateScript: anyObjectSchema({
    projectId: stringProp('Project id.'),
    description: stringProp('Topic or prompt.'),
    preferredLengthSeconds: numberProp('Preferred video length in seconds, clamped to 20-60.'),
  }, ['projectId', 'description']),
  segmentScript: anyObjectSchema({
    script: stringProp('Full spoken script.'),
    chunkSize: numberProp('Subtitle chunk size, normally 1-3.'),
    segmentDuration: {
      oneOf: [{ type: 'string', enum: ['auto'] }, { type: 'number' }],
      description: 'auto or target seconds per segment.',
    },
  }, ['script']),
  createVideoRecord: anyObjectSchema({
    projectId: stringProp('Project id.'),
    script: stringProp('Full spoken script.'),
    settings: objectProp('Optional partial video settings.'),
    title: stringProp('Optional title override.'),
    scriptGenerationCostLines: arrayProp(objectProp(), 'Optional script generation cost lines.'),
  }, ['projectId', 'script']),
  createVideoFromPrompt: anyObjectSchema({
    projectId: stringProp('Project id.'),
    description: stringProp('Topic or prompt.'),
    preferredLengthSeconds: numberProp('Preferred video length in seconds.'),
    settings: objectProp('Optional partial video settings.'),
    triggerWorker: booleanProp('Whether to trigger the worker immediately.'),
  }, ['projectId', 'description']),
  createVideoFromScript: anyObjectSchema({
    projectId: stringProp('Project id.'),
    script: stringProp('Full spoken script.'),
    settings: objectProp('Optional partial video settings.'),
    triggerWorker: booleanProp('Whether to trigger the worker immediately.'),
    scriptGenerationCostLines: arrayProp(objectProp(), 'Optional script generation cost lines.'),
  }, ['projectId', 'script']),
  queueRender: anyObjectSchema({
    projectId: stringProp('Project id.'),
    segments: arrayProp(objectProp(), 'Prepared SegmentData objects.'),
    settings: objectProp('Optional partial video settings.'),
    originalScript: stringProp('Original full script.'),
    videoId: stringProp('Existing video id to queue.'),
    scriptGenerationCostLines: arrayProp(objectProp(), 'Optional script generation cost lines.'),
    triggerWorker: booleanProp('Whether to trigger the worker immediately.'),
  }, ['projectId', 'segments']),
  retryRender: anyObjectSchema({
    videoId: stringProp('Video id.'),
    triggerWorker: booleanProp('Whether to trigger the worker immediately.'),
  }, ['videoId']),
  listVideos: anyObjectSchema({
    projectId: stringProp('Optional project id.'),
    limit: numberProp('Maximum videos to return.'),
    status: stringProp('Optional video status filter.'),
  }),
  getVideo: anyObjectSchema({
    videoId: stringProp('Video id.'),
    signedUrls: booleanProp('Whether to include signed asset URLs.'),
  }, ['videoId']),
  getVideoStatus: anyObjectSchema({ videoId: stringProp('Video id.') }, ['videoId']),
  listVideoAssets: anyObjectSchema({
    videoId: stringProp('Video id.'),
    signedUrls: booleanProp('Whether to include signed asset URLs.'),
  }, ['videoId']),
  listWorkerLogs: anyObjectSchema({
    videoId: stringProp('Video id.'),
    limit: numberProp('Maximum logs to return.'),
  }, ['videoId']),
  generateCaption: anyObjectSchema({
    videoId: stringProp('Video id.'),
    previousCaption: stringProp('Previous caption to avoid repeating.'),
  }, ['videoId']),
  setThumbnailFromAsset: anyObjectSchema({
    videoId: stringProp('Video id.'),
    storagePath: stringProp('Storage path of an existing video asset.'),
    source: { type: 'string', enum: ['default', 'ai', 'uploaded'] },
    prompt: stringProp('Optional thumbnail prompt.'),
  }, ['videoId', 'storagePath']),
  saveVideoEdit: anyObjectSchema({
    videoId: stringProp('Video id.'),
    editedSettings: objectProp('Edited partial video settings.'),
    editedSegments: arrayProp(objectProp(), 'Edited SegmentData objects.'),
  }, ['videoId', 'editedSettings', 'editedSegments']),
  applyVideoPatch: anyObjectSchema({
    videoId: stringProp('Video id.'),
    patch: objectProp('Structured VideoEditPatch.'),
    prompt: stringProp('Optional prompt/reason stored in edit history.'),
  }, ['videoId', 'patch']),
  regenerateSceneImage: anyObjectSchema({
    videoId: stringProp('Video id.'),
    segmentIndex: numberProp('Zero-based segment index.'),
    prompt: stringProp('Image prompt or search query.'),
    mode: { type: 'string', enum: ['google', 'imagen'] },
    orientation: { type: 'string', enum: ['vertical', 'horizontal'] },
  }, ['videoId', 'segmentIndex', 'prompt', 'mode']),
  scheduleYouTubePublish: anyObjectSchema({
    videoId: stringProp('Video id.'),
    scheduledFor: stringProp('ISO datetime to publish.'),
    caption: stringProp('Caption / description.'),
    title: stringProp('YouTube title.'),
    description: stringProp('YouTube description.'),
    timezone: stringProp('Timezone label.'),
    thumbnailStoragePath: stringProp('Optional thumbnail storage path override.'),
    privacyStatus: { type: 'string', enum: ['private', 'unlisted', 'public'] },
    scheduledPostId: stringProp('Existing scheduled post id for reschedule.'),
  }, ['videoId', 'scheduledFor']),
  listScheduledPosts: anyObjectSchema({
    projectId: stringProp('Optional project id.'),
    videoId: stringProp('Optional video id.'),
    status: stringProp('Optional scheduled post status.'),
    limit: numberProp('Maximum posts to return.'),
  }),
  cancelScheduledPost: anyObjectSchema({
    scheduledPostId: stringProp('Scheduled post id.'),
  }, ['scheduledPostId']),
  deleteVideo: anyObjectSchema({
    videoId: stringProp('Video id.'),
  }, ['videoId']),
};

const TOOL_HANDLERS: Record<string, ToolHandler> = {
  listProjects: (ctx) => listProjectsTool(ctx),
  getProject: (ctx, args) => getProjectTool(ctx, args as Parameters<typeof getProjectTool>[1]),
  updateProjectDefaults: (ctx, args) => updateProjectDefaultsTool(ctx, args as Parameters<typeof updateProjectDefaultsTool>[1]),
  brainstormTopics: (ctx, args) => brainstormTopicsTool(ctx, args as Parameters<typeof brainstormTopicsTool>[1]),
  selectTopic: (ctx, args) => selectTopicTool(ctx, args as Parameters<typeof selectTopicTool>[1]),
  generateScript: (ctx, args) => generateScriptTool(ctx, args as Parameters<typeof generateScriptTool>[1]),
  segmentScript: (ctx, args) => segmentScriptTool(ctx, args as Parameters<typeof segmentScriptTool>[1]),
  createVideoRecord: (ctx, args) => createVideoRecordTool(ctx, args as Parameters<typeof createVideoRecordTool>[1]),
  createVideoFromPrompt: (ctx, args) => createVideoFromPromptTool(ctx, args as Parameters<typeof createVideoFromPromptTool>[1]),
  createVideoFromScript: (ctx, args) => createVideoFromScriptTool(ctx, args as Parameters<typeof createVideoFromScriptTool>[1]),
  queueRender: (ctx, args) => queueRenderTool(ctx, args as Parameters<typeof queueRenderTool>[1]),
  retryRender: (ctx, args) => retryRenderTool(ctx, args as Parameters<typeof retryRenderTool>[1]),
  listVideos: (ctx, args) => listVideosTool(ctx, args as Parameters<typeof listVideosTool>[1]),
  getVideo: (ctx, args) => getVideoTool(ctx, args as Parameters<typeof getVideoTool>[1]),
  getVideoStatus: (ctx, args) => getVideoStatusTool(ctx, args as Parameters<typeof getVideoStatusTool>[1]),
  listVideoAssets: (ctx, args) => listVideoAssetsTool(ctx, args as Parameters<typeof listVideoAssetsTool>[1]),
  listWorkerLogs: (ctx, args) => listWorkerLogsTool(ctx, args as Parameters<typeof listWorkerLogsTool>[1]),
  generateCaption: (ctx, args) => generateCaptionTool(ctx, args as Parameters<typeof generateCaptionTool>[1]),
  setThumbnailFromAsset: (ctx, args) => setThumbnailFromAssetTool(ctx, args as Parameters<typeof setThumbnailFromAssetTool>[1]),
  saveVideoEdit: (ctx, args) => saveVideoEditTool(ctx, args as Parameters<typeof saveVideoEditTool>[1]),
  applyVideoPatch: (ctx, args) => applyVideoPatchTool(ctx, args as Parameters<typeof applyVideoPatchTool>[1]),
  regenerateSceneImage: (ctx, args) => regenerateSceneImageTool(ctx, args as Parameters<typeof regenerateSceneImageTool>[1]),
  scheduleYouTubePublish: (ctx, args) => scheduleYouTubePublishTool(ctx, args as Parameters<typeof scheduleYouTubePublishTool>[1]),
  listScheduledPosts: (ctx, args) => listScheduledPostsTool(ctx, args as Parameters<typeof listScheduledPostsTool>[1]),
  cancelScheduledPost: (ctx, args) => cancelScheduledPostTool(ctx, args as Parameters<typeof cancelScheduledPostTool>[1]),
  deleteVideo: (ctx, args) => deleteVideoTool(ctx, args as Parameters<typeof deleteVideoTool>[1]),
};

export const MCP_TOOL_REQUIRED_SCOPES: Record<string, AgentScope[]> = {
  listProjects: ['projects:read'],
  getProject: ['projects:read'],
  updateProjectDefaults: ['projects:update'],
  brainstormTopics: ['projects:read', 'topics:brainstorm'],
  selectTopic: ['topics:brainstorm'],
  generateScript: ['projects:read', 'scripts:generate'],
  segmentScript: ['scripts:generate'],
  createVideoRecord: ['projects:read', 'videos:create'],
  createVideoFromPrompt: ['projects:read', 'topics:brainstorm', 'scripts:generate', 'videos:create', 'videos:render'],
  createVideoFromScript: ['projects:read', 'scripts:generate', 'videos:create', 'videos:render'],
  queueRender: ['projects:read', 'videos:render'],
  retryRender: ['videos:render'],
  listVideos: ['videos:read'],
  getVideo: ['videos:read'],
  getVideoStatus: ['videos:read'],
  listVideoAssets: ['assets:read'],
  listWorkerLogs: ['logs:read'],
  generateCaption: ['captions:generate'],
  setThumbnailFromAsset: ['videos:edit', 'assets:read'],
  saveVideoEdit: ['videos:edit'],
  applyVideoPatch: ['videos:edit'],
  regenerateSceneImage: ['videos:edit'],
  scheduleYouTubePublish: ['publishing:schedule'],
  listScheduledPosts: ['publishing:read'],
  cancelScheduledPost: ['publishing:cancel'],
  deleteVideo: ['videos:delete'],
};

export function requiredScopesForMcpAutomationTool(name: string): AgentScope[] {
  return MCP_TOOL_REQUIRED_SCOPES[name] ?? [];
}

export function listMcpAutomationTools(): McpAutomationTool[] {
  return VIDEO_AUTOMATION_TOOLS.map((tool) => ({
    ...tool,
    inputSchema: MCP_AUTOMATION_TOOL_INPUT_SCHEMAS[tool.name] ?? anyObjectSchema(),
    requiredScopes: requiredScopesForMcpAutomationTool(tool.name),
  }));
}

export function listMcpAutomationToolsForScopes(scopes: string[]): McpAutomationTool[] {
  const owned = new Set(scopes);
  return listMcpAutomationTools().filter((tool) => (
    requiredScopesForMcpAutomationTool(tool.name).every((scope) => owned.has(scope))
  ));
}

export function getMcpAutomationTool(name: string): McpAutomationTool | null {
  return listMcpAutomationTools().find((tool) => tool.name === name) ?? null;
}

export async function callMcpAutomationTool(
  ctx: AutomationToolContext,
  call: McpAutomationCall,
) {
  const handler = TOOL_HANDLERS[call.name];
  if (!handler) {
    throw new Error(`Unknown automation tool: ${call.name}`);
  }

  return handler(ctx, call.arguments ?? {});
}

export function listMcpAutomationToolNames() {
  return Object.keys(TOOL_HANDLERS);
}
