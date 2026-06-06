import { useRef } from 'react'
import { DEFAULT_EQ_BANDS } from '../../utils/trackPlugins'

const BAND_LABELS = ['低架', '低中', '中', '高中', '高架']

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v))
const fmtFreq = (f) => (f >= 1000 ? `${(f / 1000).toFixed(f % 1000 === 0 ? 0 : 1)}k` : `${Math.round(f)}`)

// EQ band editor — stateless w.r.t. the store. Receives the eq plugin's `bands`
// and an `onChange(nextBands, persist)` callback; TrackFxEditor owns the plugins
// array and the live (store-only) + debounced (server) persist. `persist=false`
// = live drag update; `persist=true` = commit (reset / final value).
export default function TrackEqPanel({ bands, onChange }) {
  const timerRef = useRef(null)

  // Live update now, debounce a persist after the drag settles.
  const liveCommit = (next) => {
    onChange(next, false)
    if (timerRef.current) clearTimeout(timerRef.current)
    timerRef.current = setTimeout(() => onChange(next, true), 300)
  }

  const updateBand = (i, field, value) => {
    liveCommit(bands.map((b, j) => (j === i ? { ...b, [field]: value } : { ...b })))
  }

  const reset = () => onChange(DEFAULT_EQ_BANDS.map(b => ({ ...b })), true)

  return (
    <div className="pt-1.5">
      <div className="flex items-center justify-end mb-1.5">
        <button
          onClick={reset}
          className="text-[10px] px-1.5 py-0.5 rounded border border-[#444] text-[#888] hover:border-[#6d5efc] hover:text-[#6d5efc] transition-colors"
          title="所有頻段歸零（平直）"
        >
          重置
        </button>
      </div>

      <div className="flex flex-col gap-1.5">
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
