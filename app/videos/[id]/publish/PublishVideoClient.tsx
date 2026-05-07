'use client';

import { useMemo, useRef, useState } from 'react';
import Link from 'next/link';

type PlatformId = 'instagram' | 'youtube' | 'tiktok';
type SoundChoice = 'original' | 'trending' | 'none';
type ThumbnailMode = 'default' | 'ai' | 'upload';
type ThumbnailSource = 'default' | 'ai' | 'uploaded';

type PlatformState = {
  enabled: boolean;
  sound: SoundChoice;
  volume: number;
};

const PLATFORMS: { id: PlatformId; label: string }[] = [
  { id: 'instagram', label: 'Instagram Reels' },
  { id: 'youtube', label: 'YouTube Shorts' },
  { id: 'tiktok', label: 'TikTok' },
];

const SOUND_OPTIONS: { value: SoundChoice; label: string }[] = [
  { value: 'original', label: 'Original audio' },
  { value: 'trending', label: 'Trending sound placeholder' },
  { value: 'none', label: 'No added sound' },
];

function defaultPlatformState(): Record<PlatformId, PlatformState> {
  return {
    instagram: { enabled: true, sound: 'original', volume: 80 },
    youtube: { enabled: true, sound: 'original', volume: 80 },
    tiktok: { enabled: true, sound: 'original', volume: 80 },
  };
}

async function readApiError(res: Response) {
  try {
    const data = await res.json() as { error?: string };
    return data.error ?? `HTTP ${res.status}`;
  } catch {
    return `HTTP ${res.status}`;
  }
}

export function PublishVideoClient({
  videoId,
  videoTitle,
  videoUrl,
  projectName,
  projectNiche,
  initialThumbnailUrl,
  initialThumbnailPath,
  initialThumbnailPrompt,
  initialThumbnailSource,
}: {
  videoId: string;
  videoTitle: string;
  videoUrl: string | null;
  projectName: string;
  projectNiche: string;
  initialThumbnailUrl: string | null;
  initialThumbnailPath: string | null;
  initialThumbnailPrompt: string;
  initialThumbnailSource: ThumbnailSource;
}) {
  const [caption, setCaption] = useState('');
  const [hasGeneratedCaption, setHasGeneratedCaption] = useState(false);
  const [isGeneratingCaption, setIsGeneratingCaption] = useState(false);
  const [captionError, setCaptionError] = useState('');
  const [thumbnailMode, setThumbnailMode] = useState<ThumbnailMode>(initialThumbnailSource === 'ai' ? 'ai' : initialThumbnailSource === 'uploaded' ? 'upload' : 'default');
  const [thumbnailUrl, setThumbnailUrl] = useState(initialThumbnailUrl);
  const [thumbnailPath, setThumbnailPath] = useState(initialThumbnailPath);
  const [thumbnailPrompt, setThumbnailPrompt] = useState(initialThumbnailPrompt);
  const [thumbnailSource, setThumbnailSource] = useState<ThumbnailSource>(initialThumbnailSource);
  const [isGeneratingThumbnail, setIsGeneratingThumbnail] = useState(false);
  const [isUploadingThumbnail, setIsUploadingThumbnail] = useState(false);
  const [thumbnailError, setThumbnailError] = useState('');
  const uploadInputRef = useRef<HTMLInputElement | null>(null);
  const [automaticPublishing, setAutomaticPublishing] = useState(false);
  const [platforms, setPlatforms] = useState<Record<PlatformId, PlatformState>>(defaultPlatformState);
  const [publishDate, setPublishDate] = useState('');
  const [publishTime, setPublishTime] = useState('');
  const [draftMessage, setDraftMessage] = useState('');

  const timezone = useMemo(() => {
    try {
      return Intl.DateTimeFormat().resolvedOptions().timeZone;
    } catch {
      return 'Local timezone';
    }
  }, []);

  const selectedPlatforms = PLATFORMS.filter((platform) => platforms[platform.id].enabled);
  const canSchedule = automaticPublishing && selectedPlatforms.length > 0 && publishDate && publishTime;

  async function generateCaption() {
    if (isGeneratingCaption) return;
    setIsGeneratingCaption(true);
    setCaptionError('');
    setDraftMessage('');

    try {
      const res = await fetch(`/api/videos/${videoId}/generate-caption`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          previousCaption: hasGeneratedCaption ? caption : undefined,
        }),
      });
      const data = await res.json() as { caption?: string; error?: string };
      if (!res.ok || data.error || !data.caption) {
        throw new Error(data.error ?? await readApiError(res));
      }

      setCaption(data.caption);
      setHasGeneratedCaption(true);
    } catch (err) {
      setCaptionError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsGeneratingCaption(false);
    }
  }

  async function generateThumbnail() {
    if (isGeneratingThumbnail) return;
    setIsGeneratingThumbnail(true);
    setThumbnailError('');
    setDraftMessage('');

    try {
      const res = await fetch(`/api/videos/${videoId}/thumbnail/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt: thumbnailPrompt }),
      });
      const data = await res.json() as {
        thumbnailUrl?: string | null;
        storagePath?: string;
        prompt?: string;
        source?: ThumbnailSource;
        error?: string;
      };
      if (!res.ok || data.error || !data.thumbnailUrl || !data.storagePath) {
        throw new Error(data.error ?? await readApiError(res));
      }

      setThumbnailUrl(data.thumbnailUrl);
      setThumbnailPath(data.storagePath);
      setThumbnailPrompt(data.prompt ?? thumbnailPrompt);
      setThumbnailSource(data.source ?? 'ai');
      setThumbnailMode('ai');
      setDraftMessage('Thumbnail generated and set as active.');
    } catch (err) {
      setThumbnailError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsGeneratingThumbnail(false);
    }
  }

  async function uploadThumbnail(file: File | null) {
    if (!file || isUploadingThumbnail) return;
    setIsUploadingThumbnail(true);
    setThumbnailError('');
    setDraftMessage('');

    try {
      if (!file.type.startsWith('image/')) {
        throw new Error('Please upload an image file.');
      }

      const formData = new FormData();
      formData.append('file', file);
      const res = await fetch(`/api/videos/${videoId}/thumbnail/upload`, {
        method: 'POST',
        body: formData,
      });
      const data = await res.json() as {
        thumbnailUrl?: string | null;
        storagePath?: string;
        source?: ThumbnailSource;
        error?: string;
      };
      if (!res.ok || data.error || !data.thumbnailUrl || !data.storagePath) {
        throw new Error(data.error ?? await readApiError(res));
      }

      setThumbnailUrl(data.thumbnailUrl);
      setThumbnailPath(data.storagePath);
      setThumbnailSource(data.source ?? 'uploaded');
      setThumbnailMode('upload');
      setDraftMessage('Uploaded thumbnail set as active.');
    } catch (err) {
      setThumbnailError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsUploadingThumbnail(false);
      if (uploadInputRef.current) uploadInputRef.current.value = '';
    }
  }

  function updatePlatform(id: PlatformId, patch: Partial<PlatformState>) {
    setPlatforms((current) => ({
      ...current,
      [id]: { ...current[id], ...patch },
    }));
    setDraftMessage('');
  }

  function saveDraft() {
    setDraftMessage('Publishing draft saved locally for this page. Database persistence will be added with the future publishing backend.');
  }

  function schedulePublishing() {
    if (!canSchedule) {
      setDraftMessage('Choose at least one platform and a publishing date/time before scheduling.');
      return;
    }
    setDraftMessage('Publishing schedule prepared locally. Real platform upload is not connected yet.');
  }

  return (
    <div className="mx-auto max-w-7xl">
      <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="text-xs font-black uppercase tracking-[0.28em] text-cyan-300">
            Publishing
          </p>
          <h1 className="mt-2 text-3xl font-black tracking-normal text-white">
            Schedule Publishing
          </h1>
          <p className="mt-2 text-sm leading-6 text-gray-400">
            {videoTitle} · {projectName}{projectNiche ? ` · ${projectNiche}` : ''}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link
            href={`/videos/${videoId}`}
            className="rounded-lg border border-gray-700 px-4 py-2 text-sm font-bold text-gray-300 transition hover:border-gray-500 hover:text-white"
          >
            Video Detail
          </Link>
          <Link
            href={`/videos/${videoId}/edit`}
            className="rounded-lg border border-cyan-700 bg-cyan-400/10 px-4 py-2 text-sm font-bold text-cyan-200 transition hover:border-cyan-400 hover:text-white"
          >
            Edit Video
          </Link>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-[1.05fr_0.95fr] lg:items-start">
        <section className="space-y-5">
          <div className="rounded-lg border border-gray-800 bg-gray-900/75 p-5">
            <div className="flex items-center justify-between gap-3">
              <label htmlFor="caption" className="text-xs font-black uppercase tracking-[0.22em] text-gray-400">
                Caption
              </label>
              <button
                type="button"
                onClick={generateCaption}
                disabled={isGeneratingCaption}
                className="rounded-lg border border-purple-700 bg-purple-500/10 px-3 py-2 text-xs font-black text-purple-200 transition hover:border-purple-400 hover:bg-purple-500/20 disabled:cursor-not-allowed disabled:border-gray-800 disabled:text-gray-600"
              >
                {isGeneratingCaption
                  ? 'Generating...'
                  : hasGeneratedCaption
                    ? 'Regenerate caption with AI'
                    : 'Generate caption with AI'}
              </button>
            </div>
            <textarea
              id="caption"
              value={caption}
              onChange={(event) => {
                setCaption(event.target.value);
                setDraftMessage('');
              }}
              rows={7}
              placeholder="Write the caption for Instagram Reels, YouTube Shorts, and TikTok."
              className="mt-4 w-full resize-none rounded-lg border border-gray-700 bg-gray-950 px-4 py-3 text-sm leading-6 text-white outline-none transition placeholder:text-gray-600 focus:border-purple-400"
            />
            {captionError && (
              <p className="mt-3 rounded-lg border border-red-800 bg-red-950/40 px-3 py-2 text-sm text-red-200">
                {captionError}
              </p>
            )}
          </div>

          <div className="rounded-lg border border-gray-800 bg-gray-900/75 p-5">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <h2 className="text-xs font-black uppercase tracking-[0.22em] text-gray-400">
                  Thumbnail
                </h2>
                <p className="mt-2 text-xs text-gray-500">
                  Active source: {thumbnailSource === 'ai' ? 'AI generated' : thumbnailSource === 'uploaded' ? 'Uploaded' : 'Default'}
                </p>
              </div>
              <div className="grid grid-cols-3 gap-1 rounded-lg border border-gray-800 bg-gray-950 p-1">
                {([
                  ['default', 'Default'],
                  ['ai', 'Generate with AI'],
                  ['upload', 'Upload'],
                ] as const).map(([mode, label]) => (
                  <button
                    key={mode}
                    type="button"
                    onClick={() => {
                      setThumbnailMode(mode);
                      setThumbnailError('');
                    }}
                    className={`rounded px-3 py-2 text-xs font-black transition ${
                      thumbnailMode === mode
                        ? 'bg-cyan-400 text-gray-950'
                        : 'text-gray-400 hover:bg-gray-900 hover:text-white'
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>

            <div className="mt-4 grid gap-4 sm:grid-cols-[180px_1fr]">
              {thumbnailUrl ? (
                <img
                  src={thumbnailUrl}
                  alt=""
                  className="aspect-[9/16] w-full rounded-lg border border-gray-800 bg-gray-950 object-cover"
                />
              ) : (
                <div className="flex aspect-[9/16] w-full items-center justify-center rounded-lg border border-dashed border-gray-700 bg-gray-950 p-4 text-center text-xs font-bold text-gray-600">
                  No thumbnail
                </div>
              )}

              <div className="min-w-0">
                {thumbnailMode === 'default' && (
                  <div className="rounded-lg border border-gray-800 bg-gray-950 p-4">
                    <p className="text-sm font-bold text-gray-200">
                      {thumbnailPath ? 'Using the current default thumbnail.' : 'No default thumbnail is available yet.'}
                    </p>
                    <p className="mt-2 break-all text-xs text-gray-500">
                      {thumbnailPath ?? 'The first available image asset will be used when one exists.'}
                    </p>
                  </div>
                )}

                {thumbnailMode === 'ai' && (
                  <div>
                    <label htmlFor="thumbnailPrompt" className="text-[11px] font-bold uppercase tracking-[0.18em] text-gray-500">
                      Prompt
                    </label>
                    <textarea
                      id="thumbnailPrompt"
                      value={thumbnailPrompt}
                      onChange={(event) => setThumbnailPrompt(event.target.value)}
                      rows={5}
                      placeholder="Leave empty to generate a thumbnail prompt from the script."
                      className="mt-2 w-full resize-none rounded-lg border border-gray-700 bg-gray-950 px-4 py-3 text-sm leading-6 text-white outline-none transition placeholder:text-gray-600 focus:border-cyan-400"
                    />
                    <button
                      type="button"
                      onClick={generateThumbnail}
                      disabled={isGeneratingThumbnail}
                      className="mt-3 rounded-lg border border-cyan-700 bg-cyan-400/10 px-4 py-2 text-sm font-black text-cyan-200 transition hover:border-cyan-400 hover:bg-cyan-400/20 disabled:cursor-not-allowed disabled:border-gray-800 disabled:text-gray-600"
                    >
                      {isGeneratingThumbnail ? 'Generating...' : 'Generate thumbnail with AI'}
                    </button>
                  </div>
                )}

                {thumbnailMode === 'upload' && (
                  <div className="rounded-lg border border-gray-800 bg-gray-950 p-4">
                    <input
                      ref={uploadInputRef}
                      type="file"
                      accept="image/jpeg,image/png,image/webp,image/gif"
                      onChange={(event) => uploadThumbnail(event.target.files?.[0] ?? null)}
                      className="block w-full text-sm text-gray-300 file:mr-4 file:rounded-lg file:border-0 file:bg-cyan-400 file:px-4 file:py-2 file:text-sm file:font-black file:text-gray-950 hover:file:bg-cyan-300"
                      disabled={isUploadingThumbnail}
                    />
                    <p className="mt-3 text-xs text-gray-500">
                      {isUploadingThumbnail ? 'Uploading...' : 'JPEG, PNG, WebP, or GIF.'}
                    </p>
                  </div>
                )}

                {thumbnailError && (
                  <p className="mt-3 rounded-lg border border-red-800 bg-red-950/40 px-3 py-2 text-sm text-red-200">
                    {thumbnailError}
                  </p>
                )}
              </div>
            </div>
          </div>

          <div className="rounded-lg border border-gray-800 bg-gray-900/75 p-5">
            <label className="flex items-start gap-3">
              <input
                type="checkbox"
                checked={automaticPublishing}
                onChange={(event) => {
                  setAutomaticPublishing(event.target.checked);
                  setDraftMessage('');
                }}
                className="mt-1 h-4 w-4 accent-cyan-400"
              />
              <span>
                <span className="block text-sm font-black text-white">Automatically publish this video</span>
                <span className="mt-1 block text-xs leading-5 text-gray-500">
                  Platform controls are placeholders until the upload integrations are connected.
                </span>
              </span>
            </label>

            <fieldset
              disabled={!automaticPublishing}
              className={`mt-5 space-y-4 transition ${automaticPublishing ? 'opacity-100' : 'opacity-45'}`}
            >
              <div className="grid gap-3">
                {PLATFORMS.map((platform) => {
                  const state = platforms[platform.id];
                  return (
                    <div key={platform.id} className="rounded-lg border border-gray-800 bg-gray-950 p-4">
                      <label className="flex items-center gap-3">
                        <input
                          type="checkbox"
                          checked={state.enabled}
                          onChange={(event) => updatePlatform(platform.id, { enabled: event.target.checked })}
                          className="h-4 w-4 accent-cyan-400"
                        />
                        <span className="text-sm font-bold text-gray-100">{platform.label}</span>
                      </label>

                      {state.enabled && (
                        <div className="mt-4 grid gap-4 sm:grid-cols-[1fr_180px]">
                          <label className="block">
                            <span className="text-[11px] font-bold uppercase tracking-[0.18em] text-gray-500">
                              Sound selection
                            </span>
                            <select
                              value={state.sound}
                              onChange={(event) => updatePlatform(platform.id, { sound: event.target.value as SoundChoice })}
                              className="mt-2 w-full rounded-lg border border-gray-700 bg-gray-900 px-3 py-2 text-sm text-white outline-none transition focus:border-cyan-400"
                            >
                              {SOUND_OPTIONS.map((option) => (
                                <option key={option.value} value={option.value}>{option.label}</option>
                              ))}
                            </select>
                          </label>

                          <label className="block">
                            <span className="text-[11px] font-bold uppercase tracking-[0.18em] text-gray-500">
                              Volume {state.volume}%
                            </span>
                            <input
                              type="range"
                              min={0}
                              max={100}
                              step={5}
                              value={state.volume}
                              onChange={(event) => updatePlatform(platform.id, { volume: Number(event.target.value) })}
                              className="mt-4 w-full accent-cyan-400"
                            />
                          </label>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>

              <div className="rounded-lg border border-gray-800 bg-gray-950 p-4">
                <p className="text-[11px] font-black uppercase tracking-[0.22em] text-gray-500">
                  Schedule date/time
                </p>
                <div className="mt-4 grid gap-4 sm:grid-cols-2">
                  <label className="block">
                    <span className="text-xs font-bold text-gray-400">Date</span>
                    <input
                      type="date"
                      value={publishDate}
                      onChange={(event) => {
                        setPublishDate(event.target.value);
                        setDraftMessage('');
                      }}
                      className="mt-2 w-full rounded-lg border border-gray-700 bg-gray-900 px-3 py-2 text-sm text-white outline-none transition focus:border-cyan-400"
                    />
                  </label>
                  <label className="block">
                    <span className="text-xs font-bold text-gray-400">Time</span>
                    <input
                      type="time"
                      value={publishTime}
                      onChange={(event) => {
                        setPublishTime(event.target.value);
                        setDraftMessage('');
                      }}
                      className="mt-2 w-full rounded-lg border border-gray-700 bg-gray-900 px-3 py-2 text-sm text-white outline-none transition focus:border-cyan-400"
                    />
                  </label>
                </div>
                <p className="mt-3 text-xs text-gray-500">Timezone: {timezone}</p>
              </div>
            </fieldset>

            <div className="mt-5 flex flex-col gap-3 sm:flex-row">
              <button
                type="button"
                onClick={saveDraft}
                className="flex-1 rounded-lg border border-gray-700 px-4 py-3 text-sm font-black text-gray-200 transition hover:border-gray-500 hover:text-white"
              >
                Save publishing draft
              </button>
              <button
                type="button"
                onClick={schedulePublishing}
                className="flex-1 rounded-lg bg-cyan-400 px-4 py-3 text-sm font-black uppercase tracking-[0.14em] text-gray-950 transition hover:bg-cyan-300"
              >
                Schedule Publishing
              </button>
            </div>

            {draftMessage && (
              <p className="mt-4 rounded-lg border border-cyan-900 bg-cyan-950/30 px-3 py-2 text-sm text-cyan-100">
                {draftMessage}
              </p>
            )}
          </div>
        </section>

        <aside className="lg:sticky lg:top-8">
          <div className="rounded-lg border border-gray-800 bg-gray-900/75 p-5">
            <div className="mb-4 flex items-center justify-between gap-3">
              <div>
                <p className="text-xs font-black uppercase tracking-[0.22em] text-gray-500">
                  Preview
                </p>
                <h2 className="mt-1 text-lg font-black text-white">Final video</h2>
              </div>
              <span className="rounded bg-emerald-500/15 px-2 py-1 text-[10px] font-black uppercase tracking-[0.12em] text-emerald-300">
                Ready
              </span>
            </div>
            {videoUrl ? (
              <video
                src={videoUrl}
                controls
                className="aspect-[9/16] max-h-[72vh] w-full rounded-lg bg-black object-contain"
              />
            ) : (
              <div className="flex aspect-[9/16] max-h-[72vh] items-center justify-center rounded-lg border border-gray-800 bg-gray-950 p-8 text-center text-sm text-gray-500">
                Final MP4 is not available yet.
              </div>
            )}
          </div>
        </aside>
      </div>
    </div>
  );
}
