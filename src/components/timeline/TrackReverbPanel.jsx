import { useRef } from 'react'
import Knob from './Knob'

// Reverb param editor — FabFilter Pro-R-inspired knob layout: PREDELAY /
// CHARACTER / THICKNESS on the left, the big SPACE (decay time) knob centred,
// BRIGHTNESS / WIDTH / MIX on the right. Distinct accent colours per knob.
//
// Stateless w.r.t. the store: receives params + onChange(nextParams, persist);
// TrackFxEditor owns the plugins array and the live + debounced persist.
// MIRROR: ranges match server/core/ffmpegBuilder.ts buildReverbFilter and
// src/audio/audioEngine.js reverb node.

const LEFT = [
  { key: 'predelay',  label: 'PREDELAY',  min: 0, max: 200, step: 1, def: 20, unit: 'ms', color: '#E94560' },
  { key: 'character', label: 'CHARACTER', min: 0, max: 100, step: 1, def: 50, unit: '%',  color: '#f59e0b' },
  { key: 'thickness', label: 'THICKNESS', min: 0, max: 100, step: 1, def: 30, unit: '%',  color: '#eab308' },
]
const SPACE = {
  key: 'space', label: 'SPACE', min: 0.2, max: 8, step: 0.1, def: 2.0, color: '#6d5efc',
  format: (v) => `${Number(v).toFixed(1)}s`,
}
const RIGHT = [
  { key: 'brightness', label: 'BRIGHTNESS', min: 0, max: 100, step: 1, def: 60, unit: '%', color: '#22d3ee' },
  { key: 'width',      label: 'WIDTH',      min: 0, max: 100, step: 1, def: 80, unit: '%', color: '#3b82f6' },
  { key: 'mix',        label: 'MIX',        min: 0, max: 100, step: 1, def: 25, unit: '%', color: '#22c55e' },
]

export default function TrackReverbPanel({ params, onChange }) {
  const timerRef = useRef(null)

  const liveCommit = (next) => {
    onChange(next, false)
    if (timerRef.current) clearTimeout(timerRef.current)
    timerRef.current = setTimeout(() => onChange(next, true), 300)
  }
  const set = (key, value, persist) => {
    const next = { ...params, [key]: value }
    if (persist) onChange(next, true)
    else liveCommit(next)
  }

  const small = (f) => (
    <Knob
      key={f.key} label={f.label} value={Number(params?.[f.key] ?? f.def)}
      min={f.min} max={f.max} step={f.step} def={f.def} unit={f.unit} color={f.color} scale={0.82}
      onChange={(v, persist) => set(f.key, v, persist)}
    />
  )

  return (
    <div className="pt-2">
      <div className="flex items-center justify-center gap-2 rounded-lg px-2 py-4 bg-gradient-to-b from-[#1a1a1e] to-[#141417] border border-[#2a2a2f]">
        <div className="flex gap-2">{LEFT.map(small)}</div>
        <div className="mx-1 shrink-0">
          <Knob
            label={SPACE.label} value={Number(params?.space ?? SPACE.def)}
            min={SPACE.min} max={SPACE.max} step={SPACE.step} def={SPACE.def} color={SPACE.color}
            format={SPACE.format} scale={1.45}
            onChange={(v, persist) => set('space', v, persist)}
          />
        </div>
        <div className="flex gap-1.5">{RIGHT.map(small)}</div>
      </div>
    </div>
  )
}
