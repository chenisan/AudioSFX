import { useRef } from 'react'

// Param editor for dynamics plugins (compressor / limiter). Stateless w.r.t. the
// store — receives params + onChange(nextParams, persist); TrackFxEditor owns the
// plugins array and the live (store-only) + debounced (server) persist.
//
// MIRROR: ranges/units match server/core/ffmpegBuilder.ts buildCompressorFilter /
// buildLimiterFilter and src/audio/audioEngine.js _makePluginNodes. Threshold/
// makeup/ceiling are dB; attack/release are ms; ratio is n:1.
const FIELDS = {
  compressor: [
    { key: 'threshold', label: '閾值', min: -60, max: 0,    step: 0.5, unit: 'dB', def: -24 },
    { key: 'ratio',     label: '比率', min: 1,   max: 20,   step: 0.1, unit: ':1', def: 3 },
    { key: 'attack',    label: '啟動', min: 0,   max: 200,  step: 1,   unit: 'ms', def: 10 },
    { key: 'release',   label: '釋放', min: 0,   max: 1000, step: 5,   unit: 'ms', def: 100 },
    { key: 'knee',      label: '拐點', min: 0,   max: 40,   step: 1,   unit: 'dB', def: 6 },
    { key: 'makeup',    label: '補償', min: -12, max: 24,   step: 0.5, unit: 'dB', def: 0 },
  ],
  limiter: [
    { key: 'threshold', label: '上限', min: -24, max: 0,    step: 0.5, unit: 'dB', def: -1 },
    { key: 'release',   label: '釋放', min: 1,   max: 500,  step: 1,   unit: 'ms', def: 50 },
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
  const set = (key, v) => liveCommit({ ...params, [key]: v })

  return (
    <div className="pt-1.5 flex flex-col gap-1.5">
      {fields.map(f => {
        const val = Number.isFinite(+params?.[f.key]) ? +params[f.key] : f.def
        return (
          <div key={f.key} className="flex items-center gap-1.5">
            <span className="w-8 text-[10px] text-[#888] shrink-0">{f.label}</span>
            <input
              type="range"
              min={f.min} max={f.max} step={f.step}
              value={val}
              onChange={e => set(f.key, +e.target.value)}
              onDoubleClick={() => set(f.key, f.def)}
              className="flex-1 h-1 accent-[#6d5efc] cursor-pointer"
              title={`${f.label}（雙擊重設預設值）`}
            />
            <span className="w-14 text-right font-mono text-[10px] text-[#ccc] shrink-0">
              {val}{f.unit}
            </span>
          </div>
        )
      })}
    </div>
  )
}
