'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import type { VideoListItem } from './page';
import type { Project } from '@/lib/projects/types';

type SortKey = 'newest' | 'oldest' | 'duration_desc' | 'duration_asc' | 'cost_desc';
type PublishingFilter = 'all' | 'published' | 'scheduled' | 'not_scheduled';

const STATUS_LABEL: Record<string, string> = {
  queued: 'Ve frontě',
  processing: 'Zpracovávám',
  done: 'Hotovo',
  failed: 'Chyba',
  generating: 'Generuji',
  processing_images: 'Obrázky',
  generating_images: 'Obrázky',
  generating_voice: 'Voiceover',
  transcribing: 'Titulky',
  rendering: 'Renderuji',
  uploading: 'Nahrávám',
};

const STATUS_COLOR: Record<string, string> = {
  queued: 'bg-amber-500/15 text-amber-300',
  processing: 'bg-cyan-500/15 text-cyan-300',
  done: 'bg-emerald-500/15 text-emerald-300',
  failed: 'bg-red-500/15 text-red-300',
  generating: 'bg-cyan-500/15 text-cyan-300',
  processing_images: 'bg-cyan-500/15 text-cyan-300',
  generating_images: 'bg-cyan-500/15 text-cyan-300',
  generating_voice: 'bg-cyan-500/15 text-cyan-300',
  transcribing: 'bg-cyan-500/15 text-cyan-300',
  rendering: 'bg-cyan-500/15 text-cyan-300',
  uploading: 'bg-cyan-500/15 text-cyan-300',
};

const PUBLISHING_LABEL: Record<VideoListItem['publishingStatus'], string> = {
  published: 'Publikováno',
  scheduled: 'Naplánováno',
  not_scheduled: 'Nenaplánováno',
};

const PUBLISHING_COLOR: Record<VideoListItem['publishingStatus'], string> = {
  published: 'bg-emerald-500/15 text-emerald-300',
  scheduled: 'bg-purple-500/15 text-purple-300',
  not_scheduled: 'bg-gray-800/80 text-gray-400',
};

function formatDuration(sec: number | null): string {
  if (!sec) return '—';
  const m = Math.floor(sec / 60);
  const s = Math.round(sec % 60);
  return m > 0 ? `${m}m ${s}s` : `${s}s`;
}

function formatCost(usd: number | null): string {
  if (!usd) return '—';
  return `$${usd.toFixed(4)}`;
}

interface Props {
  videos: VideoListItem[];
  projects: Pick<Project, 'id' | 'name'>[];
  initialProjectFilter: string | null;
}

export function VideosClient({ videos, projects, initialProjectFilter }: Props) {
  const router = useRouter();
  const [projectFilter, setProjectFilter] = useState<string>(initialProjectFilter ?? 'all');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [publishingFilter, setPublishingFilter] = useState<PublishingFilter>('all');
  const [sortKey, setSortKey] = useState<SortKey>('newest');
  const [search, setSearch] = useState('');

  const filtered = useMemo(() => {
    let list = videos;

    if (projectFilter !== 'all') {
      list = list.filter((v) => v.project_id === projectFilter);
    }
    if (statusFilter !== 'all') {
      list = list.filter((v) => v.status === statusFilter);
    }
    if (publishingFilter !== 'all') {
      list = list.filter((v) => v.publishingStatus === publishingFilter);
    }
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      list = list.filter(
        (v) => v.title.toLowerCase().includes(q) || (v.project_name ?? '').toLowerCase().includes(q),
      );
    }

    switch (sortKey) {
      case 'oldest':
        list = [...list].sort((a, b) => a.created_at.localeCompare(b.created_at));
        break;
      case 'duration_desc':
        list = [...list].sort((a, b) => (b.duration_seconds ?? 0) - (a.duration_seconds ?? 0));
        break;
      case 'duration_asc':
        list = [...list].sort((a, b) => (a.duration_seconds ?? 0) - (b.duration_seconds ?? 0));
        break;
      case 'cost_desc':
        list = [...list].sort(
          (a, b) => (b.actual_cost_usd ?? b.estimated_cost_usd ?? 0) - (a.actual_cost_usd ?? a.estimated_cost_usd ?? 0),
        );
        break;
      default: // newest — already ordered from server
        break;
    }

    return list;
  }, [videos, projectFilter, statusFilter, publishingFilter, sortKey, search]);

  const activeProject = projects.find((p) => p.id === projectFilter);

  return (
    <div className="mx-auto max-w-6xl">
      {/* Header */}
      <div className="mb-6 flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-xs font-black uppercase tracking-[0.28em] text-cyan-300">Videa</p>
          <h1 className="mt-1 text-3xl font-black">
            {activeProject ? activeProject.name : 'Všechna videa'}
          </h1>
          <p className="mt-1 text-sm text-gray-500">
            {filtered.length} z {videos.length} videí
          </p>
        </div>
        {activeProject && (
          <Link
            href={`/projects/${activeProject.id}/create`}
            className="rounded-lg bg-cyan-500 px-4 py-2 text-xs font-black text-gray-950 transition hover:bg-cyan-400 self-start"
          >
            ▶ Generovat video
          </Link>
        )}
      </div>

      {/* Filter bar */}
      <div className="mb-6 flex flex-wrap items-center gap-3">
        {/* Search */}
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Hledat název..."
          className="rounded-lg border border-gray-700 bg-gray-900 px-3 py-2 text-sm text-white placeholder-gray-600 focus:border-cyan-500 focus:outline-none w-48"
        />

        {/* Project filter */}
        <select
          value={projectFilter}
          onChange={(e) => {
            setProjectFilter(e.target.value);
            // Update URL param for bookmarking
            const url = new URL(window.location.href);
            if (e.target.value === 'all') {
              url.searchParams.delete('project');
            } else {
              url.searchParams.set('project', e.target.value);
            }
            router.replace(url.pathname + url.search, { scroll: false });
          }}
          className="rounded-lg border border-gray-700 bg-gray-900 px-3 py-2 text-sm text-white focus:border-cyan-500 focus:outline-none"
        >
          <option value="all">Všechny projekty</option>
          {projects.map((p) => (
            <option key={p.id} value={p.id}>{p.name}</option>
          ))}
        </select>

        {/* Status filter */}
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="rounded-lg border border-gray-700 bg-gray-900 px-3 py-2 text-sm text-white focus:border-cyan-500 focus:outline-none"
        >
          <option value="all">Všechny statusy</option>
          <option value="done">Hotovo</option>
          <option value="failed">Chyba</option>
          <option value="queued">Ve frontě</option>
          <option value="processing">Zpracovává se</option>
          <option value="generating">Generuje se</option>
          <option value="rendering">Renderuje se</option>
        </select>

        {/* Publishing filter */}
        <select
          value={publishingFilter}
          onChange={(e) => setPublishingFilter(e.target.value as PublishingFilter)}
          className="rounded-lg border border-gray-700 bg-gray-900 px-3 py-2 text-sm text-white focus:border-cyan-500 focus:outline-none"
        >
          <option value="all">Vše publikace</option>
          <option value="published">Publikováno</option>
          <option value="scheduled">Naplánováno</option>
          <option value="not_scheduled">Nenaplánováno</option>
        </select>

        {/* Sort */}
        <select
          value={sortKey}
          onChange={(e) => setSortKey(e.target.value as SortKey)}
          className="rounded-lg border border-gray-700 bg-gray-900 px-3 py-2 text-sm text-white focus:border-cyan-500 focus:outline-none"
        >
          <option value="newest">Nejnovější</option>
          <option value="oldest">Nejstarší</option>
          <option value="duration_desc">Délka (nejdelší)</option>
          <option value="duration_asc">Délka (nejkratší)</option>
          <option value="cost_desc">Cena (nejvyšší)</option>
        </select>

        {/* Clear filters */}
        {(projectFilter !== 'all' || statusFilter !== 'all' || publishingFilter !== 'all' || search || sortKey !== 'newest') && (
          <button
            onClick={() => {
              setProjectFilter('all');
              setStatusFilter('all');
              setPublishingFilter('all');
              setSearch('');
              setSortKey('newest');
              router.replace('/videos', { scroll: false });
            }}
            className="rounded-lg border border-gray-700 px-3 py-2 text-xs font-bold text-gray-500 hover:text-gray-300 transition"
          >
            ✕ Reset filtrů
          </button>
        )}
      </div>

      {/* Video grid */}
      {filtered.length === 0 ? (
        <div className="rounded-xl border border-gray-800 bg-gray-900/50 p-12 text-center">
          <p className="text-sm text-gray-500">Žádná videa neodpovídají filtru.</p>
          {projectFilter !== 'all' && (
            <Link
              href={`/projects/${projectFilter}/create`}
              className="mt-4 inline-block rounded-lg bg-cyan-500 px-4 py-2 text-xs font-black text-gray-950 hover:bg-cyan-400 transition"
            >
              ▶ Generovat první video
            </Link>
          )}
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {filtered.map((video) => (
            <VideoCard key={video.id} video={video} />
          ))}
        </div>
      )}
    </div>
  );
}

function VideoCard({ video }: { video: VideoListItem }) {
  const router = useRouter();
  const [isRetrying, setIsRetrying] = useState(false);
  const canRetry = video.status === 'failed' || video.status === 'queued' || video.status === 'done';
  const detailHref = `/videos/${video.id}`;
  const isInProgress = video.status !== 'done' && video.status !== 'failed';
  const progressPct = Math.max(0, Math.min(100, Math.round(video.render_progress ?? 0)));

  async function retryRender() {
    setIsRetrying(true);
    try {
      const res = await fetch(`/api/videos/${video.id}/retry-render`, { method: 'POST' });
      const data = await res.json().catch(() => ({})) as { error?: string };
      if (!res.ok || data.error) throw new Error(data.error ?? `HTTP ${res.status}`);
      router.refresh();
    } catch (err) {
      alert(err instanceof Error ? err.message : String(err));
    } finally {
      setIsRetrying(false);
    }
  }

  return (
    <article
      role="link"
      tabIndex={0}
      onClick={() => router.push(detailHref)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          router.push(detailHref);
        }
      }}
      className="group cursor-pointer rounded-xl border border-gray-800 bg-gray-900/70 overflow-hidden transition hover:border-gray-700 focus:outline-none focus:ring-2 focus:ring-cyan-400/40"
    >
      {/* Thumbnail */}
      <div className="relative aspect-video bg-gray-950 overflow-hidden">
        {video.thumbnailUrl ? (
          <img
            src={video.thumbnailUrl}
            alt=""
            className="w-full h-full object-cover transition group-hover:scale-105"
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center text-gray-700 text-xs">
            {video.status !== 'done' ? video.status : 'Bez náhledu'}
          </div>
        )}
        {/* Status badge */}
        <div className="absolute top-2 right-3 flex items-center gap-1.5">
          <span className={`rounded px-2 py-0.5 text-[10px] font-bold uppercase ${STATUS_COLOR[video.status] ?? 'bg-gray-800 text-gray-400'}`}>
            {STATUS_LABEL[video.status] ?? video.status}
          </span>
          {isInProgress && (
            <span className="rounded bg-gray-950/80 px-2 py-0.5 text-[10px] font-black text-cyan-200 ring-1 ring-cyan-500/30">
              {progressPct}%
            </span>
          )}
        </div>
        <span className={`absolute bottom-2 left-2 rounded px-2 py-0.5 text-[10px] font-bold uppercase ${PUBLISHING_COLOR[video.publishingStatus]}`}>
          {PUBLISHING_LABEL[video.publishingStatus]}
        </span>
        {/* Progress bar */}
        {isInProgress && (
          <div className="absolute bottom-0 inset-x-0 h-1 bg-gray-800">
            <div className="h-full bg-cyan-400" style={{ width: `${progressPct}%` }} />
          </div>
        )}
      </div>

      {/* Info */}
      <div className="p-3">
        <h3 className="text-sm font-bold text-white line-clamp-2 leading-snug">{video.title}</h3>

        <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-gray-500">
          {video.project_name && (
            <Link
              href={`/videos?project=${video.project_id}`}
              className="hover:text-cyan-300 transition truncate max-w-[120px]"
              title={video.project_name}
              onClick={(e) => e.stopPropagation()}
            >
              📁 {video.project_name}
            </Link>
          )}
          {video.duration_seconds != null && (
            <span>⏱ {formatDuration(video.duration_seconds)}</span>
          )}
          {(video.actual_cost_usd ?? video.estimated_cost_usd) != null && (
            <span>{formatCost(video.actual_cost_usd ?? video.estimated_cost_usd)}</span>
          )}
          <span className="ml-auto">{new Date(video.created_at).toLocaleDateString('cs-CZ')}</span>
        </div>

        {video.error_message && (
          <p className="mt-2 text-[10px] text-red-400 line-clamp-2">{video.error_message}</p>
        )}

        {/* Actions */}
        <div className="mt-3 flex flex-wrap gap-1.5">
          <Link
            href={detailHref}
            onClick={(e) => e.stopPropagation()}
            className="min-w-[72px] flex-1 rounded-lg border border-gray-700 py-1.5 text-center text-[11px] font-bold text-gray-300 transition hover:border-cyan-400 hover:text-cyan-200"
          >
            Detail
          </Link>
          {video.status === 'done' && (
            <>
              <Link
                href={`/videos/${video.id}/publish`}
                onClick={(e) => e.stopPropagation()}
                className="min-w-[120px] flex-1 rounded-lg border border-purple-800 bg-purple-500/10 py-1.5 text-center text-[11px] font-bold text-purple-200 transition hover:border-purple-500 hover:bg-purple-500/20"
              >
                Schedule Publishing
              </Link>
              <Link
                href={`/videos/${video.id}/edit`}
                onClick={(e) => e.stopPropagation()}
                className="min-w-[72px] flex-1 rounded-lg border border-cyan-800 bg-cyan-600/10 py-1.5 text-center text-[11px] font-bold text-cyan-300 transition hover:border-cyan-500 hover:bg-cyan-500/20"
              >
                ✏️ Edit
              </Link>
            </>
          )}
          {canRetry && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                void retryRender();
              }}
              disabled={isRetrying}
              className="min-w-[96px] flex-1 rounded-lg border border-amber-700 bg-amber-500/10 py-1.5 text-center text-[11px] font-bold text-amber-200 transition hover:border-amber-400 hover:bg-amber-500/20 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {isRetrying ? 'Spouštím...' : video.status === 'queued' ? 'Trigger worker' : video.status === 'done' ? 'Render again' : 'Try again'}
            </button>
          )}
        </div>
      </div>
    </article>
  );
}
