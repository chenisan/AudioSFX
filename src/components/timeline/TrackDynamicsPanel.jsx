import { useRef } from 'react'
import Knob from './Knob'

// Param editor for dynamics plugins (compressor / limiter) — amp-style hardware
// knobs to match TrackReverbPanel. Stateless w.r.t. the store; TrackFxEditor owns
// the plugins array + the live (store-only) + debounced (server) persist.
//
// MIRROR: ranges/units match server/core/ffmpegBuilder.ts buildCompressorFilter /
// buildLimiterFilter and src/audio/audioEngine.js _makePluginNodes. Threshold/
// makeup/knee/ceiling are dB; attack/release are ms; ratio is n:1. Each knob gets
// a distinct accent colour so the six compressor controls stay legible.
const FIELDS = {
  compressor: [
    { key: 'threshold', label: '閾值', min: -60, max: 0,    step: 0.5, unit: 'dB', def: -24, color: '#E94560' },
    { key: 'ratio',     label: '比率', min: 1,   max: 20,   step: 0.1, unit: ':1', def: 3,   color: '#f59e0b' },
    { key: 'attack',    label: '啟動', min: 0,   max: 200,  step: 1,   unit: 'ms', def: 10,  color: '#eab308' },
    { key: 'release',   label: '釋放', min: 0,   max: 1000, step: 5,   unit: 'ms', def: 100, color: '#22d3ee' },
    { key: 'knee',      label: '拐點', min: 0,   max: 40,   step: 1,   unit: 'dB', def: 6,   color: '#a855f7' },
    { key: 'makeup',    label: '補償', min: -12, max: 24,   step: 0.5, unit: 'dB', def: 0,   color: '#22c55e' },
  ],
  limiter: [
    { key: 'threshold', label: '上限', min: -24, max: 0,   step: 0.5, unit: 'dB', def: -1, color: '#E94560' },
    { key: 'release',   label: '釋放', min: 1,   max: 500, step: 1,   unit: 'ms', def: 50, color: '#22d3ee' },
  ],
}

export default function TrackDynamicsPanel({ type, params, onChange }) {
  const timerRef = useRef(null)
  const fields = FIELDS[type] || []

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
  // Respect step precision in the readout (0.5-step dB → 1 decimal, ms → integer).
  const fmt = (f) => (v) => `${(+v).toFixed(f.step < 1 ? 1 : 0)}${f.unit}`

  return (
    <div className="pt-2">
      <div className="flex items-start justify-center flex-wrap gap-x-2 gap-y-3 rounded-lg px-2 py-4 bg-gradient-to-b from-[#1a1a1e] to-[#141417] border border-[#2a2a2f]">
        {fields.map(f => (
          <Knob
            key={f.key}
            label={f.label}
            value={Number.isFinite(+params?.[f.key]) ? +params[f.key] : f.def}
            min={f.min} max={f.max} step={f.step} def={f.def} unit={f.unit} color={f.color}
            scale={0.9} variant="amp" format={fmt(f)}
            onChange={(v, persist) => set(f.key, v, persist)}
          />
        ))}
      </div>
    </div>
  )
}
