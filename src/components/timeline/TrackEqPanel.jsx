import { useRef } from 'react'
import { useProjectStore } from '../../stores/projectStore'

// Fixed 5-band parametric EQ. Mirrored by audioEngine.js (Web Audio biquads,
// preview) and ffmpegBuilder.ts (bass/equalizer/treble, export). Keep the band
// shape (type/freq/gain/q) identical across all three.
export const DEFAULT_EQ_BANDS = [
  { type: 'lowshelf',  freq: 80,   gain: 0, q: 0.7 },
  { type: 'peaking',   freq: 250,  gain: 0, q: 1.0 },
  { type: 'peaking',   freq: 1000, gain: 0, q: 1.0 },
  { type: 'peaking',   freq: 3500, gain: 0, q: 1.0 },
  { type: 'highshelf', freq: 8000, gain: 0, q: 0.7 },
]

const BAND_LABELS = ['低架', '低中', '中', '高中', '高架']

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v))
const fmtFreq = (f) => (f >= 1000 ? `${(f / 1000).toFixed(f % 1000 === 0 ? 0 : 1)}k` : `${Math.round(f)}`)

// Track-level EQ editor rendered inside the track "⋯更多" flyout. Live updates
// during drag (setTrackEqLive, no server hit) + a debounced setTrackEq commit,
// mirroring the 整軌音量 slider pattern.
export default function TrackEqPanel({ track }) {
  const setTrackEq = useProjectStore(s => s.setTrackEq)
  const setTrackEqLive = useProjectStore(s => s.setTrackEqLive)
  const timerRef = useRef(null)

  // Current EQ, seeded with flat defaults when the track has none yet.
  const hasBands = track.eq && Array.isArray(track.eq.bands) && track.eq.bands.length > 0
  const enabled = !!track.eq?.enabled
  const bands = hasBands ? track.eq.bands : DEFAULT_EQ_BANDS

  // Live + debounced persist (band-param drags). Marks the project dirty until save.
  const liveCommit = (next) => {
    setTrackEqLive(track.id, next)
    if (timerRef.current) clearTimeout(timerRef.current)
    timerRef.current = setTimeout(() => setTrackEq(track.id, next), 300)
  }

  // Structural toggle (enable/disable) — persist immediately; it rebuilds the
  // preview node chain (EQ structure is part of the clip key), so no debounce.
  const toggleEnabled = () => {
    const next = { enabled: !enabled, bands: bands.map(b => ({ ...b })) }
    setTrackEqLive(track.id, next)
    setTrackEq(track.id, next)
  }

  const updateBand = (i, field, value) => {
    const next = {
      enabled: true,   // editing a band implies the user wants EQ on
      bands: bands.map((b, j) => (j === i ? { ...b, [field]: value } : { ...b })),
    }
    liveCommit(next)
  }

  const reset = () => {
    const next = { enabled, bands: DEFAULT_EQ_BANDS.map(b => ({ ...b })) }
    setTrackEqLive(track.id, next)
    setTrackEq(track.id, next)
  }

  return (
    <div
      className="absolute left-full top-0 ml-1 bg-[#2a2a2a] border border-[#444] rounded-lg shadow-xl z-50 p-3 w-[300px]"
      onClick={e => e.stopPropagation()}
    >
      {/* Header: enable toggle + reset */}
      <div className="flex items-center justify-between mb-2">
        <label className="flex items-center gap-1.5 text-[11px] text-[#ccc] cursor-pointer select-none">
          <input
            type="checkbox"
            checked={enabled}
            onChange={toggleEnabled}
            className="accent-[#6d5efc] cursor-pointer"
          />
          <span>EQ {enabled ? '開啟' : '關閉'}</span>
        </label>
        <button
          onClick={reset}
          className="text-[10px] px-1.5 py-0.5 rounded border border-[#444] text-[#888] hover:border-[#6d5efc] hover:text-[#6d5efc] transition-colors"
          title="所有頻段歸零（平直）"
        >
          重置
        </button>
      </div>

      {/* Bands */}
      <div className={`flex flex-col gap-1.5 ${enabled ? '' : 'opacity-40'}`}>
        {bands.map((b, i) => {
          const gain = Number(b.gain) || 0
          return (
            <div key={i} className="flex items-center gap-1.5">
              <span className="w-8 text-[10px] text-[#888] shrink-0">{BAND_LABELS[i] ?? `B${i + 1}`}</span>
              {/* freq */}
              <input
                type="number"
                value={Math.round(b.freq)}
                min={20} max={20000} step={10}
                onChange={e => updateBand(i, 'freq', clamp(+e.target.value || 0, 20, 20000))}
                className="w-12 bg-[#1a1a1a] text-[10px] text-[#ccc] px-1 py-0.5 rounded border border-[#3a3a3a] outline-none focus:border-[#6d5efc] font-mono"
                title="頻率 (Hz)"
              />
              {/* gain slider */}
              <input
                type="range"
                min={-18} max={18} step={0.5}
                value={gain}
                onChange={e => updateBand(i, 'gain', +e.target.value)}
                onDoubleClick={() => updateBand(i, 'gain', 0)}
                className="flex-1 h-1 accent-[#6d5efc] cursor-pointer"
                title={`${BAND_LABELS[i] ?? ''} 增益（雙擊歸零）`}
              />
              <span className="w-10 text-right font-mono text-[10px] text-[#ccc] shrink-0">
                {gain > 0 ? '+' : ''}{gain.toFixed(1)}
              </span>
              {/* Q — peaking only; shelf filters ignore it */}
              {b.type === 'peaking' ? (
                <input
                  type="number"
                  value={Number(b.q).toFixed(1)}
                  min={0.1} max={20} step={0.1}
                  onChange={e => updateBand(i, 'q', clamp(+e.target.value || 0.1, 0.1, 20))}
                  className="w-10 bg-[#1a1a1a] text-[10px] text-[#ccc] px-1 py-0.5 rounded border border-[#3a3a3a] outline-none focus:border-[#6d5efc] font-mono"
                  title="Q（頻寬）"
                />
              ) : (
                <span className="w-10 text-center text-[9px] text-[#555] shrink-0">{b.type === 'lowshelf' ? '低架' : '高架'}</span>
              )}
            </div>
          )
        })}
      </div>

      <div className="mt-2 text-[9px] text-[#666] leading-tight">
        頻段：{bands.map(b => `${fmtFreq(b.freq)}`).join(' · ')} Hz
      </div>
    </div>
  )
}
