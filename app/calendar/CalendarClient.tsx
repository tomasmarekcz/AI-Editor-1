'use client';

import Link from 'next/link';
import { useMemo } from 'react';
import { useRouter } from 'next/navigation';

export type CalendarProject = {
  id: string;
  name: string;
};

export type CalendarPost = {
  id: string;
  video_id: string;
  project_id: string | null;
  platform: string;
  status: string;
  scheduled_for: string;
  title: string;
  projectName: string;
};

function monthLabel(month: string) {
  const [year, monthIndex] = month.split('-').map(Number);
  return new Date(year, monthIndex - 1, 1).toLocaleDateString(undefined, {
    month: 'long',
    year: 'numeric',
  });
}

function shiftMonth(month: string, offset: number) {
  const [year, monthIndex] = month.split('-').map(Number);
  const date = new Date(year, monthIndex - 1 + offset, 1);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
}

function dayKey(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function statusClass(status: string) {
  if (status === 'published') return 'border-emerald-700 bg-emerald-500/10 text-emerald-200';
  if (status === 'failed') return 'border-red-800 bg-red-500/10 text-red-200';
  if (status === 'processing') return 'border-amber-700 bg-amber-500/10 text-amber-200';
  return 'border-cyan-800 bg-cyan-500/10 text-cyan-100';
}

export function CalendarClient({
  month,
  selectedProject,
  projects,
  posts,
}: {
  month: string;
  selectedProject: string;
  projects: CalendarProject[];
  posts: CalendarPost[];
}) {
  const router = useRouter();
  const [year, monthIndex] = month.split('-').map(Number);
  const firstDay = new Date(year, monthIndex - 1, 1);
  const daysInMonth = new Date(year, monthIndex, 0).getDate();
  const leadingBlanks = (firstDay.getDay() + 6) % 7;
  const previousMonth = shiftMonth(month, -1);
  const nextMonth = shiftMonth(month, 1);

  const postsByDay = useMemo(() => {
    const grouped: Record<string, CalendarPost[]> = {};
    for (const post of posts) {
      const key = dayKey(new Date(post.scheduled_for));
      grouped[key] = [...(grouped[key] ?? []), post];
    }
    return grouped;
  }, [posts]);

  function hrefFor(nextMonthValue: string, projectValue = selectedProject) {
    const params = new URLSearchParams();
    params.set('month', nextMonthValue);
    if (projectValue) params.set('project', projectValue);
    return `/calendar?${params.toString()}`;
  }

  function changeProject(projectId: string) {
    router.push(hrefFor(month, projectId));
  }

  return (
    <div className="mx-auto max-w-7xl">
      <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-xs font-black uppercase tracking-[0.28em] text-cyan-300">Calendar</p>
          <h1 className="mt-2 text-3xl font-black tracking-normal text-white">{monthLabel(month)}</h1>
          <p className="mt-2 text-sm text-gray-400">Scheduled publishing across your projects.</p>
        </div>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
          <label className="block sm:min-w-56">
            <span className="text-xs font-bold uppercase tracking-[0.18em] text-gray-500">Project</span>
            <select
              value={selectedProject}
              onChange={(event) => changeProject(event.target.value)}
              className="mt-2 w-full rounded-lg border border-gray-700 bg-gray-950 px-3 py-2 text-sm font-bold text-white outline-none transition focus:border-cyan-400"
            >
              <option value="">All projects</option>
              {projects.map((project) => (
                <option key={project.id} value={project.id}>{project.name}</option>
              ))}
            </select>
          </label>
          <div className="flex gap-2">
            <Link href={hrefFor(previousMonth)} className="rounded-lg border border-gray-700 px-4 py-2 text-sm font-black text-gray-200 transition hover:border-cyan-400 hover:text-cyan-100">
              Previous
            </Link>
            <Link href={hrefFor(nextMonth)} className="rounded-lg border border-gray-700 px-4 py-2 text-sm font-black text-gray-200 transition hover:border-cyan-400 hover:text-cyan-100">
              Next
            </Link>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-7 border-b border-l border-gray-800 bg-gray-900/70 text-center text-xs font-black uppercase tracking-[0.16em] text-gray-500">
        {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((day) => (
          <div key={day} className="border-r border-t border-gray-800 px-2 py-3">{day}</div>
        ))}
      </div>

      <div className="grid grid-cols-7 border-l border-gray-800 bg-gray-950">
        {Array.from({ length: leadingBlanks }).map((_, index) => (
          <div key={`blank-${index}`} className="min-h-32 border-r border-t border-gray-800 bg-gray-950/50" />
        ))}
        {Array.from({ length: daysInMonth }).map((_, index) => {
          const day = index + 1;
          const date = new Date(year, monthIndex - 1, day);
          const key = dayKey(date);
          const dayPosts = postsByDay[key] ?? [];
          return (
            <div key={key} className="min-h-32 border-r border-t border-gray-800 p-2">
              <div className="mb-2 text-xs font-black text-gray-500">{day}</div>
              <div className="space-y-1.5">
                {dayPosts.map((post) => (
                  <Link
                    key={post.id}
                    href={`/videos/${post.video_id}`}
                    className={`block rounded border px-2 py-1.5 text-xs leading-4 transition hover:border-white hover:text-white ${statusClass(post.status)}`}
                  >
                    <span className="block truncate font-black">{post.title}</span>
                    <span className="mt-0.5 block truncate text-[10px] opacity-75">
                      {new Date(post.scheduled_for).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} · {post.projectName} · {post.status}
                    </span>
                  </Link>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
