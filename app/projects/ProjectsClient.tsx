'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { DEFAULT_VIDEO_SETTINGS, mergeVideoSettings } from '@/lib/projects/defaults';
import type { Project, ProjectFormValues } from '@/lib/projects/types';
import type { VideoSettings } from '@/types';

const EMPTY_FORM: ProjectFormValues = {
  name: '',
  niche: '',
  language: 'cs',
  voice_style: 'hype',
  visual_style: '',
  caption_style: 'bold-highlight',
  default_project_prompt: '',
  ttsProvider: 'gemini',
  orientation: 'vertical',
  imageSource: 'google',
};

const VOICE_STYLES = [
  { id: 'hype', label: 'Hype' },
  { id: 'storyteller', label: 'Storyteller' },
  { id: 'mystery', label: 'Mystery' },
  { id: 'business', label: 'Business' },
  { id: 'documentary', label: 'Documentary' },
  { id: 'custom', label: 'Custom' },
];

const CAPTION_STYLES = [
  { id: 'bold-highlight', label: 'Bold highlight' },
  { id: 'clean-white', label: 'Clean white' },
  { id: 'all-caps', label: 'All caps' },
  { id: 'minimal', label: 'Minimal' },
];

function formFromProject(project?: Project | null): ProjectFormValues {
  if (!project) return EMPTY_FORM;
  const settings = mergeVideoSettings(project.default_settings);

  return {
    name: project.name,
    niche: project.niche,
    language: project.language,
    voice_style: project.voice_style || settings.geminiPreset || settings.voicePreset,
    visual_style: project.visual_style,
    caption_style: project.caption_style,
    default_project_prompt: project.default_project_prompt,
    ttsProvider: settings.ttsProvider,
    orientation: settings.orientation,
    imageSource: settings.imageSource,
  };
}

function settingsFromForm(values: ProjectFormValues, existing?: Partial<VideoSettings> | null): VideoSettings {
  const base = mergeVideoSettings(existing ?? DEFAULT_VIDEO_SETTINGS);
  const captionPatch =
    values.caption_style === 'clean-white'
      ? { allCaps: false, highlight: false, color: '#ffffff' }
      : values.caption_style === 'all-caps'
        ? { allCaps: true, highlight: true }
        : values.caption_style === 'minimal'
          ? { allCaps: false, highlight: false, sizeScale: 0.85 }
          : { allCaps: false, highlight: true, highlightColor: '#FFE400' };

  return {
    ...base,
    ttsProvider: values.ttsProvider,
    voicePreset: values.voice_style as VideoSettings['voicePreset'],
    geminiPreset: values.voice_style as VideoSettings['geminiPreset'],
    orientation: values.orientation,
    imageSource: values.imageSource,
    subtitle: {
      ...base.subtitle,
      ...captionPatch,
    },
  };
}

function labelFor(options: { id: string; label: string }[], id: string) {
  return options.find((option) => option.id === id)?.label ?? id;
}

export function ProjectsClient({
  initialProjects,
  userId,
  accountId,
  userEmail,
}: {
  initialProjects: Project[];
  userId: string;
  accountId: string;
  userEmail: string;
}) {
  const router = useRouter();
  const [projects, setProjects] = useState<Project[]>(initialProjects);
  const [editingProject, setEditingProject] = useState<Project | null>(null);
  const [isCreating, setIsCreating] = useState(false);
  const [values, setValues] = useState<ProjectFormValues>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const modalTitle = editingProject ? 'Project settings' : 'Create new project';
  const hasModal = isCreating || editingProject;

  const sortedProjects = useMemo(
    () => [...projects].sort((a, b) => a.name.localeCompare(b.name)),
    [projects],
  );

  function openCreate() {
    setError('');
    setEditingProject(null);
    setValues(EMPTY_FORM);
    setIsCreating(true);
  }

  function openSettings(project: Project) {
    setError('');
    setIsCreating(false);
    setEditingProject(project);
    setValues(formFromProject(project));
  }

  function closeModal() {
    setError('');
    setIsCreating(false);
    setEditingProject(null);
    setValues(EMPTY_FORM);
  }

  function updateValue<K extends keyof ProjectFormValues>(key: K, value: ProjectFormValues[K]) {
    setValues((current) => ({ ...current, [key]: value }));
  }

  async function saveProject(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setError('');

    const supabase = createClient();
    const payload = {
      user_id: userId,
      account_id: accountId,
      name: values.name.trim(),
      niche: values.niche.trim(),
      language: values.language.trim() || 'cs',
      voice_style: values.voice_style,
      visual_style: values.visual_style.trim(),
      caption_style: values.caption_style,
      default_project_prompt: values.default_project_prompt.trim(),
      default_settings: settingsFromForm(values, editingProject?.default_settings),
    };

    if (!payload.name || !payload.niche) {
      setSaving(false);
      setError('Project name and niche are required.');
      return;
    }

    const query = editingProject
      ? supabase.from('projects').update(payload).eq('id', editingProject.id).select('*').single()
      : supabase.from('projects').insert(payload).select('*').single();

    const { data, error: saveError } = await query;
    setSaving(false);

    if (saveError) {
      setError(saveError.message);
      return;
    }

    const saved = data as Project;
    setProjects((current) => editingProject
      ? current.map((project) => project.id === saved.id ? saved : project)
      : [...current, saved]);
    closeModal();
  }

  async function deleteProject() {
    if (!editingProject) return;
    const confirmed = window.confirm(`Delete project "${editingProject.name}"?`);
    if (!confirmed) return;

    setSaving(true);
    setError('');

    const supabase = createClient();
    const { error: deleteError } = await supabase
      .from('projects')
      .delete()
      .eq('id', editingProject.id);

    setSaving(false);

    if (deleteError) {
      setError(deleteError.message);
      return;
    }

    setProjects((current) => current.filter((project) => project.id !== editingProject.id));
    closeModal();
  }

  return (
    <main className="min-h-screen bg-gray-950 px-4 py-8 text-white">
      <div className="mx-auto max-w-7xl">
        <header className="mb-8 flex flex-col gap-4 border-b border-gray-800 pb-6 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="text-xs font-black uppercase tracking-[0.28em] text-cyan-300">
              Projects
            </p>
            <h1 className="mt-2 text-4xl font-black tracking-normal text-white">
              Choose your content brand
            </h1>
            <p className="mt-2 text-sm text-gray-400">
              {userEmail} · each project stores its own default voice, visuals, format and captions.
            </p>
          </div>
          <form action="/auth/logout" method="post">
            <button className="rounded-lg border border-gray-700 px-4 py-2 text-sm font-bold text-gray-200 transition hover:border-red-400 hover:text-red-200">
              Logout
            </button>
          </form>
        </header>

        <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <button
            onClick={openCreate}
            className="min-h-64 rounded-lg border border-dashed border-cyan-500/60 bg-cyan-400/5 p-5 text-left transition hover:border-cyan-300 hover:bg-cyan-400/10"
          >
            <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-cyan-400 text-2xl font-black text-gray-950">
              +
            </span>
            <h2 className="mt-6 text-2xl font-black tracking-normal">Create New Project</h2>
            <p className="mt-3 text-sm leading-6 text-gray-400">
              Set name, niche, language and the defaults that should load into the editor.
            </p>
          </button>

          {sortedProjects.map((project) => (
            <article
              key={project.id}
              className="group flex min-h-64 flex-col rounded-lg border border-gray-800 bg-gray-900/80 p-5 transition hover:border-cyan-500/70"
            >
              <button
                onClick={() => router.push(`/projects/${project.id}/create`)}
                className="flex-1 text-left"
              >
                <p className="text-xs font-bold uppercase tracking-[0.22em] text-gray-500">
                  {project.language || 'cs'} · {project.niche || 'No niche'}
                </p>
                <h2 className="mt-3 text-2xl font-black tracking-normal text-white">
                  {project.name}
                </h2>
                <p className="mt-3 line-clamp-3 text-sm leading-6 text-gray-400">
                  {project.default_project_prompt || project.visual_style || 'Project defaults are ready for the editor.'}
                </p>

                <div className="mt-5 grid grid-cols-2 gap-2 text-xs text-gray-300">
                  <span className="rounded-lg border border-gray-800 bg-gray-950 px-3 py-2">
                    Voice: {labelFor(VOICE_STYLES, project.voice_style)}
                  </span>
                  <span className="rounded-lg border border-gray-800 bg-gray-950 px-3 py-2">
                    Captions: {labelFor(CAPTION_STYLES, project.caption_style)}
                  </span>
                </div>
              </button>

              <div className="mt-5 flex items-center gap-2">
                <button
                  onClick={() => openSettings(project)}
                  className="rounded-lg border border-gray-700 px-3 py-2 text-xs font-bold uppercase tracking-[0.16em] text-gray-300 transition hover:border-cyan-400 hover:text-cyan-200"
                >
                  Settings
                </button>
                <button
                  onClick={() => router.push(`/videos?project=${project.id}`)}
                  className="rounded-lg border border-gray-700 px-3 py-2 text-xs font-bold uppercase tracking-[0.16em] text-gray-300 transition hover:border-gray-500 hover:text-white"
                >
                  Videos
                </button>
                <button
                  onClick={() => router.push(`/projects/${project.id}/create`)}
                  className="ml-auto rounded-lg bg-cyan-400 px-4 py-2 text-xs font-black uppercase tracking-[0.16em] text-gray-950 transition hover:bg-cyan-300"
                >
                  Open
                </button>
              </div>
            </article>
          ))}
        </section>
      </div>

      {hasModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm">
          <form
            onSubmit={saveProject}
            className="max-h-[92vh] w-full max-w-3xl overflow-y-auto rounded-lg border border-gray-700 bg-gray-900 p-6 shadow-2xl"
          >
            <div className="mb-5 flex items-start justify-between gap-4">
              <div>
                <p className="text-xs font-bold uppercase tracking-[0.22em] text-cyan-300">
                  {modalTitle}
                </p>
                <h2 className="mt-1 text-2xl font-black tracking-normal">
                  {editingProject ? editingProject.name : 'New content brand'}
                </h2>
              </div>
              <button
                type="button"
                onClick={closeModal}
                className="text-2xl leading-none text-gray-500 hover:text-white"
              >
                x
              </button>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <label className="block">
                <span className="mb-2 block text-xs font-bold uppercase tracking-[0.18em] text-gray-500">
                  Project name
                </span>
                <input
                  value={values.name}
                  onChange={(event) => updateValue('name', event.target.value)}
                  placeholder="Ancient What If"
                  className="w-full rounded-lg border border-gray-700 bg-gray-950 px-3 py-2.5 text-white outline-none focus:border-cyan-400"
                />
              </label>

              <label className="block">
                <span className="mb-2 block text-xs font-bold uppercase tracking-[0.18em] text-gray-500">
                  Niche
                </span>
                <input
                  value={values.niche}
                  onChange={(event) => updateValue('niche', event.target.value)}
                  placeholder="History, AI tools, business facts..."
                  className="w-full rounded-lg border border-gray-700 bg-gray-950 px-3 py-2.5 text-white outline-none focus:border-cyan-400"
                />
              </label>

              <label className="block">
                <span className="mb-2 block text-xs font-bold uppercase tracking-[0.18em] text-gray-500">
                  Language
                </span>
                <input
                  value={values.language}
                  onChange={(event) => updateValue('language', event.target.value)}
                  placeholder="cs, en, sk..."
                  className="w-full rounded-lg border border-gray-700 bg-gray-950 px-3 py-2.5 text-white outline-none focus:border-cyan-400"
                />
              </label>

              <label className="block">
                <span className="mb-2 block text-xs font-bold uppercase tracking-[0.18em] text-gray-500">
                  Voice style
                </span>
                <select
                  value={values.voice_style}
                  onChange={(event) => updateValue('voice_style', event.target.value)}
                  className="w-full rounded-lg border border-gray-700 bg-gray-950 px-3 py-2.5 text-white outline-none focus:border-cyan-400"
                >
                  {VOICE_STYLES.map((style) => (
                    <option key={style.id} value={style.id}>{style.label}</option>
                  ))}
                </select>
              </label>

              <label className="block">
                <span className="mb-2 block text-xs font-bold uppercase tracking-[0.18em] text-gray-500">
                  TTS provider
                </span>
                <select
                  value={values.ttsProvider}
                  onChange={(event) => updateValue('ttsProvider', event.target.value as VideoSettings['ttsProvider'])}
                  className="w-full rounded-lg border border-gray-700 bg-gray-950 px-3 py-2.5 text-white outline-none focus:border-cyan-400"
                >
                  <option value="gemini">Gemini TTS</option>
                  <option value="openai">OpenAI TTS</option>
                  <option value="elevenlabs">ElevenLabs</option>
                </select>
              </label>

              <label className="block">
                <span className="mb-2 block text-xs font-bold uppercase tracking-[0.18em] text-gray-500">
                  Caption style
                </span>
                <select
                  value={values.caption_style}
                  onChange={(event) => updateValue('caption_style', event.target.value)}
                  className="w-full rounded-lg border border-gray-700 bg-gray-950 px-3 py-2.5 text-white outline-none focus:border-cyan-400"
                >
                  {CAPTION_STYLES.map((style) => (
                    <option key={style.id} value={style.id}>{style.label}</option>
                  ))}
                </select>
              </label>

              <label className="block">
                <span className="mb-2 block text-xs font-bold uppercase tracking-[0.18em] text-gray-500">
                  Format
                </span>
                <select
                  value={values.orientation}
                  onChange={(event) => updateValue('orientation', event.target.value as VideoSettings['orientation'])}
                  className="w-full rounded-lg border border-gray-700 bg-gray-950 px-3 py-2.5 text-white outline-none focus:border-cyan-400"
                >
                  <option value="vertical">Vertical 9:16</option>
                  <option value="horizontal">Horizontal 16:9</option>
                </select>
              </label>

              <label className="block">
                <span className="mb-2 block text-xs font-bold uppercase tracking-[0.18em] text-gray-500">
                  Image source
                </span>
                <select
                  value={values.imageSource}
                  onChange={(event) => updateValue('imageSource', event.target.value as VideoSettings['imageSource'])}
                  className="w-full rounded-lg border border-gray-700 bg-gray-950 px-3 py-2.5 text-white outline-none focus:border-cyan-400"
                >
                  <option value="google">Google</option>
                  <option value="imagen">AI Gen</option>
                  <option value="hybrid">Hybrid</option>
                  <option value="upload">Upload manually</option>
                </select>
              </label>
            </div>

            <label className="mt-4 block">
              <span className="mb-2 block text-xs font-bold uppercase tracking-[0.18em] text-gray-500">
                Visual prompt
              </span>
              <textarea
                value={values.visual_style}
                onChange={(event) => updateValue('visual_style', event.target.value)}
                rows={3}
                placeholder="Cinematic documentary realism, vertical composition, dramatic lighting, no logos, no text..."
                className="w-full resize-none rounded-lg border border-gray-700 bg-gray-950 px-3 py-2.5 text-white outline-none focus:border-cyan-400"
              />
            </label>

            <label className="mt-4 block">
              <span className="mb-2 block text-xs font-bold uppercase tracking-[0.18em] text-gray-500">
                Default project prompt
              </span>
              <textarea
                value={values.default_project_prompt}
                onChange={(event) => updateValue('default_project_prompt', event.target.value)}
                rows={3}
                placeholder="What this channel should sound and feel like..."
                className="w-full resize-none rounded-lg border border-gray-700 bg-gray-950 px-3 py-2.5 text-white outline-none focus:border-cyan-400"
              />
            </label>

            {error && (
              <p className="mt-4 rounded-lg border border-red-800 bg-red-950/50 px-3 py-2 text-sm text-red-200">
                {error}
              </p>
            )}

            <div className="mt-6 flex flex-col-reverse gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                {editingProject && (
                  <button
                    type="button"
                    onClick={deleteProject}
                    disabled={saving}
                    className="rounded-lg border border-red-900 px-4 py-2 text-sm font-bold text-red-300 transition hover:border-red-500 hover:text-red-100 disabled:opacity-50"
                  >
                    Delete project
                  </button>
                )}
              </div>
              <div className="flex gap-3">
                <button
                  type="button"
                  onClick={closeModal}
                  className="rounded-lg border border-gray-700 px-4 py-2 text-sm font-bold text-gray-300 transition hover:border-gray-500 hover:text-white"
                >
                  Cancel
                </button>
                <button
                  disabled={saving}
                  className="rounded-lg bg-cyan-400 px-5 py-2 text-sm font-black uppercase tracking-[0.16em] text-gray-950 transition hover:bg-cyan-300 disabled:opacity-60"
                >
                  {saving ? 'Saving...' : 'Save project'}
                </button>
              </div>
            </div>
          </form>
        </div>
      )}
    </main>
  );
}
