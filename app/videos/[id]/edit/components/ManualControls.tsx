'use client';

import type { VideoSettings, SegmentData, VideoEffect, SubtitleFont, SubtitleAnimation } from '@/types';
import type { VideoEditPatch } from '@/types/editor';

interface Props {
  settings: Partial<VideoSettings>;
  segments: SegmentData[];
  selectedSceneIdx: number | null;
  onPatch: (patch: VideoEditPatch) => void;
}

const FONTS: SubtitleFont[] = [
  'Bebas Neue', 'Impact', 'Montserrat', 'Anton', 'Poppins', 'Inter',
  'Archivo Black', 'League Spartan', 'Raleway', 'Oswald', 'Roboto Condensed',
  'TheBoldFont', 'Arial Black', 'Georgia', 'Verdana', 'Courier New',
];

const ANIMATIONS: { value: SubtitleAnimation; label: string }[] = [
  { value: 'none',           label: 'Žádná' },
  { value: 'word-highlight', label: 'Zvýraznění slov' },
  { value: 'word-reveal',    label: 'Odhalení slov' },
  { value: 'pop',            label: 'Pop' },
  { value: 'fade-slide',     label: 'Fade + slide' },
];

const EFFECTS: { value: VideoEffect; label: string }[] = [
  { value: 'none',       label: '○ Žádný' },
  { value: 'flash',      label: '⚡ Flash' },
  { value: 'zoom-burst', label: '🔍 Zoom burst' },
  { value: 'shake',      label: '💥 Shake' },
  { value: 'glitch',     label: '📺 Glitch' },
];

function Slider({
  label, value, min, max, step, onChange, displayValue,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (v: number) => void;
  displayValue?: string;
}) {
  return (
    <div>
      <div className="flex items-center justify-between mb-1">
        <span className="text-[11px] font-semibold uppercase tracking-widest text-gray-500">{label}</span>
        <span className="text-xs font-bold text-cyan-200">{displayValue ?? value}</span>
      </div>
      <input
        type="range"
        min={min} max={max} step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-full h-1.5 accent-cyan-400 cursor-pointer"
      />
    </div>
  );
}

function Toggle({ label, value, onChange }: { label: string; value: boolean; onChange: (v: boolean) => void }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-[11px] font-semibold uppercase tracking-widest text-gray-500">{label}</span>
      <button
        onClick={() => onChange(!value)}
        className={`relative w-10 h-5 rounded-full transition-colors ${value ? 'bg-cyan-500' : 'bg-gray-700'}`}
      >
        <span className={`absolute top-0.5 h-4 w-4 rounded-full bg-white transition-transform ${value ? 'translate-x-5' : 'translate-x-0.5'}`} />
      </button>
    </div>
  );
}

function ColorPicker({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-[11px] font-semibold uppercase tracking-widest text-gray-500">{label}</span>
      <div className="flex items-center gap-2">
        <input
          type="color"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="w-8 h-8 rounded cursor-pointer border border-gray-700 bg-transparent p-0.5"
        />
        <span className="text-xs text-gray-400">{value}</span>
      </div>
    </div>
  );
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-[10px] font-black uppercase tracking-[0.25em] text-cyan-300 mb-3 mt-5 first:mt-0">
      {children}
    </p>
  );
}

export function ManualControls({ settings, segments, selectedSceneIdx, onPatch }: Props) {
  const sub = settings.subtitle;

  const selectedSeg = selectedSceneIdx != null ? segments[selectedSceneIdx] : null;

  return (
    <div className="space-y-3 text-sm">

      {/* ── Captions ────────────────────────────────────────────────── */}
      <SectionTitle>Titulky</SectionTitle>

      <Slider
        label="Velikost"
        value={sub?.sizeScale ?? 1}
        min={0.5} max={2.5} step={0.05}
        displayValue={`${((sub?.sizeScale ?? 1) * 100).toFixed(0)}%`}
        onChange={(v) => onPatch({ captions: { fontSize: v } })}
      />

      <Slider
        label="Výška (od spodku)"
        value={sub?.positionY ?? 8}
        min={3} max={60} step={1}
        displayValue={`${sub?.positionY ?? 8}%`}
        onChange={(v) => onPatch({ captions: { positionY: v } })}
      />

      <div>
        <p className="text-[11px] font-semibold uppercase tracking-widest text-gray-500 mb-1">Styl animace</p>
        <select
          value={sub?.animation ?? 'none'}
          onChange={(e) => onPatch({ captions: { stylePreset: e.target.value as SubtitleAnimation } })}
          className="w-full rounded-lg border border-gray-700 bg-gray-900 px-3 py-2 text-xs text-white focus:border-cyan-500 focus:outline-none"
        >
          {ANIMATIONS.map((a) => (
            <option key={a.value} value={a.value}>{a.label}</option>
          ))}
        </select>
      </div>

      <div>
        <p className="text-[11px] font-semibold uppercase tracking-widest text-gray-500 mb-1">Font</p>
        <select
          value={sub?.font ?? 'Bebas Neue'}
          onChange={(e) => onPatch({ captions: { font: e.target.value as SubtitleFont } })}
          className="w-full rounded-lg border border-gray-700 bg-gray-900 px-3 py-2 text-xs text-white focus:border-cyan-500 focus:outline-none"
        >
          {FONTS.map((f) => (
            <option key={f} value={f}>{f}</option>
          ))}
        </select>
      </div>

      <div>
        <p className="text-[11px] font-semibold uppercase tracking-widest text-gray-500 mb-1">Počet slov na řádku</p>
        <div className="flex gap-2">
          {([1, 2, 3] as const).map((n) => (
            <button
              key={n}
              onClick={() => onPatch({ captions: { chunkSize: n } })}
              className={`flex-1 rounded-lg border py-2 text-xs font-bold transition ${
                (sub?.chunkSize ?? 2) === n
                  ? 'border-cyan-400 bg-cyan-400/10 text-cyan-300'
                  : 'border-gray-700 text-gray-400 hover:border-gray-500'
              }`}
            >
              {n}
            </button>
          ))}
        </div>
      </div>

      <ColorPicker
        label="Barva textu"
        value={sub?.color ?? '#ffffff'}
        onChange={(v) => onPatch({ captions: { color: v } })}
      />

      <ColorPicker
        label="Barva zvýraznění"
        value={sub?.highlightColor ?? '#facc15'}
        onChange={(v) => onPatch({ captions: { highlightColor: v } })}
      />

      <Toggle
        label="Velká písmena"
        value={sub?.allCaps ?? false}
        onChange={(v) => onPatch({ captions: { allCaps: v } })}
      />

      <Toggle
        label="Zvýraznit klíčová slova"
        value={sub?.highlight ?? true}
        onChange={(v) => onPatch({ captions: { highlight: v } })}
      />

      {/* ── Effects ─────────────────────────────────────────────────── */}
      <SectionTitle>Efekty</SectionTitle>

      <Toggle
        label="Efekty scén"
        value={settings.enableEffects ?? true}
        onChange={(v) => onPatch({ effects: { enableEffects: v } })}
      />

      <div>
        <p className="text-[11px] font-semibold uppercase tracking-widest text-gray-500 mb-1">Aplikovat efekt na všechny scény</p>
        <div className="grid grid-cols-2 gap-1.5">
          {EFFECTS.map((ef) => (
            <button
              key={ef.value}
              onClick={() => onPatch({ effects: { globalEffect: ef.value } })}
              className="rounded-lg border border-gray-700 px-2 py-1.5 text-[11px] text-gray-300 hover:border-cyan-500 hover:text-cyan-200 transition text-left"
            >
              {ef.label}
            </button>
          ))}
        </div>
      </div>

      {/* ── Selected scene ──────────────────────────────────────────── */}
      {selectedSeg != null && selectedSceneIdx != null && (
        <>
          <SectionTitle>Vybraná scéna #{selectedSceneIdx + 1}</SectionTitle>

          <p className="text-xs text-gray-400 line-clamp-3 leading-relaxed">{selectedSeg.text}</p>

          <div>
            <p className="text-[11px] font-semibold uppercase tracking-widest text-gray-500 mb-1">Efekt scény</p>
            <div className="grid grid-cols-2 gap-1.5">
              {EFFECTS.map((ef) => (
                <button
                  key={ef.value}
                  onClick={() => onPatch({ scenes: { [selectedSceneIdx]: { effect: ef.value } } })}
                  className={`rounded-lg border px-2 py-1.5 text-[11px] transition text-left ${
                    (selectedSeg.effect ?? 'none') === ef.value
                      ? 'border-cyan-400 bg-cyan-400/10 text-cyan-300'
                      : 'border-gray-700 text-gray-400 hover:border-gray-500'
                  }`}
                >
                  {ef.label}
                </button>
              ))}
            </div>
          </div>

          <div>
            <p className="text-[11px] font-semibold uppercase tracking-widest text-gray-500 mb-1">Nový prompt pro obrázek</p>
            <ImagePromptInput
              initialPrompt={selectedSeg.imagePrompt ?? ''}
              onApply={(prompt) => onPatch({ scenes: { [selectedSceneIdx]: { newImagePrompt: prompt } } })}
            />
          </div>

          <button
            onClick={() => onPatch({ scenes: { [selectedSceneIdx]: { remove: !(selectedSeg as SegmentData & { _removed?: boolean })._removed } } })}
            className={`w-full rounded-lg border px-3 py-2 text-xs font-bold transition ${
              (selectedSeg as SegmentData & { _removed?: boolean })._removed
                ? 'border-green-500 text-green-400 hover:bg-green-500/10'
                : 'border-red-700 text-red-400 hover:bg-red-500/10'
            }`}
          >
            {(selectedSeg as SegmentData & { _removed?: boolean })._removed ? 'Obnovit scénu' : 'Odstranit scénu'}
          </button>

          {(selectedSeg as SegmentData & { _removed?: boolean })._removed && (
            <p className="text-[10px] text-amber-400/80 leading-snug">
              Audio pro odstraněnou scénu bude stále přehrávat — pro čistý výsledek doporučujeme re-render celého projektu.
            </p>
          )}
        </>
      )}
    </div>
  );
}

function ImagePromptInput({ initialPrompt, onApply }: { initialPrompt: string; onApply: (p: string) => void }) {
  const [value, setValue] = React.useState(initialPrompt);
  return (
    <div className="space-y-1.5">
      <textarea
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder="Popis nového obrázku pro tuto scénu..."
        className="w-full rounded-lg border border-gray-700 bg-gray-900/60 px-3 py-2 text-xs text-white placeholder-gray-600 focus:border-cyan-500 focus:outline-none resize-none"
        rows={2}
      />
      <button
        onClick={() => { if (value.trim()) onApply(value.trim()); }}
        disabled={!value.trim()}
        className="w-full rounded-lg border border-amber-600 px-3 py-1.5 text-xs font-bold text-amber-300 transition hover:bg-amber-600/10 disabled:opacity-40"
      >
        Nastavit prompt (re-render ji vygeneruje)
      </button>
    </div>
  );
}

// Need React import for ImagePromptInput state
import React from 'react';
