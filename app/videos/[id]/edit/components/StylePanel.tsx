'use client';

import type { VideoSettings, SubtitleFont, SubtitleAnimation } from '@/types';
import type { VideoEditPatch } from '@/types/editor';

interface Props {
  settings: Partial<VideoSettings>;
  onPatch: (patch: VideoEditPatch) => void;
}

const FONTS: SubtitleFont[] = [
  'Bebas Neue', 'Impact', 'Anton', 'Montserrat', 'Poppins',
  'Archivo Black', 'League Spartan', 'Oswald', 'Raleway',
  'Inter', 'Roboto Condensed', 'TheBoldFont', 'Arial Black',
  'Georgia', 'Verdana', 'Courier New',
];

const ANIMATIONS: { value: SubtitleAnimation; label: string }[] = [
  { value: 'word-highlight', label: 'Zvýraznění' },
  { value: 'word-reveal',    label: 'Odhalení' },
  { value: 'pop',            label: 'Pop' },
  { value: 'fade-slide',     label: 'Fade slide' },
  { value: 'none',           label: 'Žádná' },
];

function Slider({
  label, value, min, max, step, display, onChange,
}: {
  label: string; value: number; min: number; max: number; step: number;
  display: string; onChange: (v: number) => void;
}) {
  return (
    <div>
      <div className="flex items-center justify-between mb-1.5">
        <span className="text-[10px] font-semibold uppercase tracking-widest text-gray-500">{label}</span>
        <span className="text-xs font-bold text-cyan-200 tabular-nums">{display}</span>
      </div>
      <input
        type="range" min={min} max={max} step={step} value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-full h-1.5 accent-cyan-400 cursor-pointer"
      />
    </div>
  );
}

function Toggle({ label, value, onChange }: { label: string; value: boolean; onChange: (v: boolean) => void }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-[10px] font-semibold uppercase tracking-widest text-gray-500">{label}</span>
      <button
        onClick={() => onChange(!value)}
        className={`relative w-10 h-5 rounded-full transition-colors ${value ? 'bg-cyan-500' : 'bg-gray-700'}`}
      >
        <span className={`absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-transform ${value ? 'translate-x-5' : 'translate-x-0.5'}`} />
      </button>
    </div>
  );
}

function ColorSwatch({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-[10px] font-semibold uppercase tracking-widest text-gray-500">{label}</span>
      <label className="flex items-center gap-2 cursor-pointer">
        <span className="text-[10px] text-gray-500 font-mono">{value}</span>
        <span
          className="w-7 h-7 rounded-lg border-2 border-gray-600 cursor-pointer relative overflow-hidden"
          style={{ backgroundColor: value }}
        >
          <input
            type="color" value={value}
            onChange={(e) => onChange(e.target.value)}
            className="opacity-0 absolute inset-0 cursor-pointer"
          />
        </span>
      </label>
    </div>
  );
}

function SectionDivider({ label }: { label: string }) {
  return (
    <div className="flex items-center gap-2 pt-2">
      <span className="text-[10px] font-black uppercase tracking-[0.2em] text-cyan-300">{label}</span>
      <div className="flex-1 h-px bg-gray-800" />
    </div>
  );
}

export function StylePanel({ settings, onPatch }: Props) {
  const sub = settings.subtitle;

  return (
    <div className="space-y-4">
      <SectionDivider label="Titulky" />

      <div>
        <p className="text-[10px] font-semibold uppercase tracking-widest text-gray-500 mb-1.5">Font</p>
        <div className="grid grid-cols-2 gap-1">
          {FONTS.map((f) => (
            <button
              key={f}
              onClick={() => onPatch({ captions: { font: f } })}
              className={[
                'rounded-lg border px-2 py-1.5 text-[11px] text-left transition truncate',
                (sub?.font ?? 'Bebas Neue') === f
                  ? 'border-cyan-500 bg-cyan-500/10 text-cyan-200 font-bold'
                  : 'border-gray-800 text-gray-400 hover:border-gray-600 hover:text-white',
              ].join(' ')}
            >
              {f}
            </button>
          ))}
        </div>
      </div>

      <div>
        <p className="text-[10px] font-semibold uppercase tracking-widest text-gray-500 mb-1.5">Animace</p>
        <div className="grid grid-cols-1 gap-1">
          {ANIMATIONS.map((a) => (
            <button
              key={a.value}
              onClick={() => onPatch({ captions: { stylePreset: a.value } })}
              className={[
                'rounded-lg border px-3 py-2 text-xs text-left transition',
                (sub?.animation ?? 'word-highlight') === a.value
                  ? 'border-cyan-500 bg-cyan-500/10 text-cyan-200 font-bold'
                  : 'border-gray-800 text-gray-400 hover:border-gray-600 hover:text-white',
              ].join(' ')}
            >
              {a.label}
            </button>
          ))}
        </div>
      </div>

      <Slider
        label="Velikost textu"
        value={sub?.sizeScale ?? 1}
        min={0.5} max={2.5} step={0.05}
        display={`${Math.round((sub?.sizeScale ?? 1) * 100)}%`}
        onChange={(v) => onPatch({ captions: { fontSize: v } })}
      />

      <Slider
        label="Výška od spodku"
        value={sub?.positionY ?? 8}
        min={3} max={55} step={1}
        display={`${sub?.positionY ?? 8}%`}
        onChange={(v) => onPatch({ captions: { positionY: v } })}
      />

      <div>
        <p className="text-[10px] font-semibold uppercase tracking-widest text-gray-500 mb-1.5">Počet slov / řádek</p>
        <div className="flex gap-1.5">
          {([1, 2, 3] as const).map((n) => (
            <button
              key={n}
              onClick={() => onPatch({ captions: { chunkSize: n } })}
              className={[
                'flex-1 rounded-lg border py-2 text-sm font-bold transition',
                (sub?.chunkSize ?? 2) === n
                  ? 'border-cyan-500 bg-cyan-500/10 text-cyan-300'
                  : 'border-gray-800 text-gray-500 hover:border-gray-600 hover:text-white',
              ].join(' ')}
            >
              {n}
            </button>
          ))}
        </div>
      </div>

      <ColorSwatch
        label="Barva textu"
        value={sub?.color ?? '#ffffff'}
        onChange={(v) => onPatch({ captions: { color: v } })}
      />

      <ColorSwatch
        label="Barva zvýraznění"
        value={sub?.highlightColor ?? '#facc15'}
        onChange={(v) => onPatch({ captions: { highlightColor: v } })}
      />

      <ColorSwatch
        label="Barva ohraničení"
        value={sub?.captionStrokeColor ?? '#000000'}
        onChange={(v) => onPatch({ captions: { captionStrokeColor: v } })}
      />

      <Slider
        label="Ohraničení"
        value={sub?.captionStrokeWidth ?? 0}
        min={0} max={12} step={1}
        display={`${sub?.captionStrokeWidth ?? 0}px`}
        onChange={(v) => onPatch({ captions: { captionStrokeWidth: v } })}
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

      <SectionDivider label="Efekty" />

      <Toggle
        label="Efekty scén"
        value={settings.enableEffects ?? true}
        onChange={(v) => onPatch({ effects: { enableEffects: v } })}
      />

      <div>
        <p className="text-[10px] font-semibold uppercase tracking-widest text-gray-500 mb-1.5">Aplikovat na všechny scény</p>
        <div className="grid grid-cols-3 gap-1.5">
          {(['none', 'flash', 'zoom-burst', 'shake', 'glitch'] as const).map((ef) => (
            <button
              key={ef}
              onClick={() => onPatch({ effects: { globalEffect: ef } })}
              className="rounded-lg border border-gray-800 px-2 py-1.5 text-[11px] text-gray-400 hover:border-gray-600 hover:text-white transition text-center"
            >
              {ef === 'none' ? '○ Žádný' : ef === 'flash' ? '⚡ Flash' : ef === 'zoom-burst' ? '🔍 Zoom' : ef === 'shake' ? '💥 Shake' : '📺 Glitch'}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
