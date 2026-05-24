'use client';

import Link from 'next/link';
import {
  removeBackgroundVideoJob,
  setBackgroundVideoJobMinimized,
  useBackgroundVideoJobs,
} from './backgroundVideoJobs';

export function BackgroundVideoWidget() {
  const jobs = useBackgroundVideoJobs();
  const visibleJobs = jobs.filter((job) => job.minimized || job.phase === 'awaiting-approval' || job.phase === 'ready' || job.phase === 'error');

  if (visibleJobs.length === 0) return null;

  return (
    <div className="fixed inset-x-0 bottom-4 z-50 flex pointer-events-none justify-center px-4">
      <div className="flex w-full max-w-4xl flex-col gap-2 sm:items-end">
        {visibleJobs.slice(0, 5).map((job) => {
          const pct = job.totalCount > 0 ? Math.round((job.doneCount / job.totalCount) * 100) : 0;
          const isActive = job.phase === 'generating-images' || job.phase === 'reviewing-images' || job.phase === 'queued' || job.phase === 'rendering';
          return (
            <div
              key={job.videoId}
              className="pointer-events-auto overflow-hidden rounded-lg border border-gray-700 bg-gray-950/95 shadow-2xl shadow-black/50 backdrop-blur sm:w-[420px]"
            >
              <div className="flex items-center gap-3 p-3">
                <Link
                  href={`/dashboard?project=${job.projectId}&resumeVideo=${job.videoId}`}
                  onClick={() => setBackgroundVideoJobMinimized(job.videoId, false)}
                  className="min-w-0 flex-1"
                >
                  <div className="flex items-center gap-2">
                    {isActive && (
                      <span className="h-3 w-3 flex-shrink-0 rounded-full border-2 border-cyan-300 border-t-transparent animate-spin" />
                    )}
                    <p className="truncate text-sm font-black text-white">{job.title}</p>
                  </div>
                  <p className="mt-0.5 truncate text-xs font-semibold text-cyan-200">{job.status}</p>
                  <p className="mt-0.5 truncate text-[11px] text-gray-500">{job.projectName}</p>
                </Link>
                <button
                  type="button"
                  onClick={() => removeBackgroundVideoJob(job.videoId)}
                  className="rounded border border-gray-800 px-2 py-1 text-xs font-bold text-gray-500 transition hover:border-gray-600 hover:text-gray-200"
                  aria-label="Hide background video"
                >
                  ×
                </button>
              </div>
              {job.totalCount > 0 && job.phase !== 'awaiting-approval' && job.phase !== 'ready' && (
                <div className="h-1 bg-gray-800">
                  <div className="h-full bg-cyan-400 transition-all" style={{ width: `${pct}%` }} />
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
