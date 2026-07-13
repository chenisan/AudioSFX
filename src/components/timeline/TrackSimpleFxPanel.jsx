import { useRef } from 'react'
import Knob from './Knob'

// Generic knob panel for the SFX effects (delay/distortion/filter/tremolo/
// chorus/flanger/gate/pitch) — spec-driven so each type is one entry here, not
// a bespoke panel. Filter additionally gets an LP/BP/HP mode button row.
//
// Stateless w.r.t. the store: receives params + onChange(nextParams, persist);
// TrackFxEditor owns the plugins array and the live + debounced persist.
// MIRROR: ranges match server/core/ffmpegBuilder.ts builders and
// src/audio/audioEngine.js _makePluginNodes.

export const SIMPLE_FX_SPECS = {
  delay: [
    { key: 'time',     label: 'TIME',     min: 1,   max: 2000, step: 1,   def: 350, unit: 'ms', color: '#6d5efc' },
    { key: 'feedback', label: 'FEEDBACK', min: 0,   max: 95,   step: 1,   def: 35,  unit: '%',  color: '#f59e0b' },
    { key: 'mix',      label: 'MIX',      min: 0,   max: 100,  step: 1,   def: 30,  unit: '%',  color: '#22c55e' },
  ],
  distortion: [
    { key: 'drive',  label: 'DRIVE',  min: 0,   max: 100, step: 1,   def: 40, unit: '%',  color: '#E94560' },
    { key: 'tone',   label: 'TONE',   min: 0,   max: 100, step: 1,   def: 60, unit: '%',  color: '#22d3ee' },
    { key: 'output', label: 'OUTPUT', min: -24, max: 6,   step: 0.5, def: 0,  unit: 'dB', color: '#22c55e' },
  ],
  filter: [
    { key: 'freq', label: 'FREQ', min: 20,  max: 20000, step: 10,  def: 1000, unit: 'Hz', color: '#6d5efc' },
    { key: 'q',    label: 'RESO', min: 0.1, max: 20,    step: 0.1, def: 0.7,             color: '#f59e0b' },
  ],
  tremolo: [
    { key: 'rate',  label: 'RATE',  min: 0.1, max: 20,  step: 0.1, def: 5,  unit: 'Hz', color: '#6d5efc' },
    { key: 'depth', label: 'DEPTH', min: 0,   max: 100, step: 1,   def: 50, unit: '%',  color: '#22c55e' },
  ],
  chorus: [
    { key: 'rate',  label: 'RATE',  min: 0.1, max: 5,   step: 0.05, def: 0.8, unit: 'Hz', color: '#6d5efc' },
    { key: 'depth', label: 'DEPTH', min: 0.5, max: 10,  step: 0.1,  def: 3,   unit: 'ms', color: '#22d3ee' },
    { key: 'mix',   label: 'MIX',   min: 0,   max: 100, step: 1,    def: 40,  unit: '%',  color: '#22c55e' },
  ],
  flanger: [
    { key: 'rate',     label: 'RATE',     min: 0.1, max: 10,  step: 0.05, def: 0.5, unit: 'Hz', color: '#6d5efc' },
    { key: 'depth',    label: 'DEPTH',    min: 0.1, max: 10,  step: 0.1,  def: 2,   unit: 'ms', color: '#22d3ee' },
    { key: 'feedback', label: 'FEEDBACK', min: 0,   max: 90,  step: 1,    def: 50,  unit: '%',  color: '#f59e0b' },
    { key: 'mix',      label: 'MIX',      min: 0,   max: 100, step: 1,    def: 60,  unit: '%',  color: '#22c55e' },
  ],
  gate: [
    { key: 'threshold', label: 'THRESH',  min: -80,  max: 0,    step: 1,   def: -40, unit: 'dB', color: '#E94560' },
    { key: 'ratio',     label: 'RATIO',   min: 1,    max: 9,    step: 0.5, def: 4,               color: '#f59e0b' },
    { key: 'attack',    label: 'ATTACK',  min: 0.1,  max: 100,  step: 0.1, def: 5,   unit: 'ms', color: '#22d3ee' },
    { key: 'release',   label: 'RELEASE', min: 10,   max: 1000, step: 5,   def: 100, unit: 'ms', color: '#3b82f6' },
  ],
  pitch: [
    { key: 'semitones', label: 'PITCH', min: -12, max: 12, step: 1, def: 0, color: '#6d5efc',
      format: (v) => `${v > 0 ? '+' : ''}${Math.round(v)} st` },
  ],
}

const FILTER_MODES = [
  { id: 'lowpass',  label: 'LP' },
  { id: 'bandpass', label: 'BP' },
  { id: 'highpass', label: 'HP' },
]

export default function TrackSimpleFxPanel({ type, params, onChange }) {
  const timerRef = useRef(null)
  const spec = SIMPLE_FX_SPECS[type] || []

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

  return (
    <div className="pt-2">
      {type === 'filter' && (
        <div className="flex justify-center gap-1 mb-2">
          {FILTER_MODES.map(m => (
            <button
              key={m.id}
              onClick={() => set('mode', m.id, true)}
              className={`px-3 py-1 rounded text-[11px] font-mono border transition-colors ${
                (params?.mode ?? 'lowpass') === m.id
                  ? 'bg-[#6d5efc] border-[#6d5efc] text-white shadow-[0_0_8px_rgba(109,94,252,0.4)]'
                  : 'bg-black/30 border-black/50 text-[#9a948b] hover:text-[#d8d2c6]'
              }`}
            >
              {m.label}
            </button>
          ))}
        </div>
      )}
      <div className="flex items-center justify-center gap-2 rounded-lg px-2 py-4 bg-gradient-to-b from-[#1a1a1e] to-[#141417] border border-[#2a2a2f]">
        {spec.map(f => (
          <Knob
            key={f.key} label={f.label} value={Number(params?.[f.key] ?? f.def)}
            min={f.min} max={f.max} step={f.step} def={f.def} unit={f.unit} color={f.color}
            format={f.format} scale={spec.length === 1 ? 1.45 : 0.95} variant="amp"
            onChange={(v, persist) => set(f.key, v, persist)}
          />
        ))}
      </div>
    </div>
  )
}
