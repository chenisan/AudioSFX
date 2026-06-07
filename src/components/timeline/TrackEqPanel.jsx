import { useState } from 'react'
import EqGraph, { BAND_COLORS } from './EqGraph'
import Knob from './Knob'
import { DEFAULT_EQ_BANDS } from '../../utils/trackPlugins'

// Graphical 5-band EQ (FabFilter Pro-Q-style). The response graph + draggable
// handles + live spectrum live in EqGraph; below it a band selector and the
// selected band's FREQ / GAIN / Q knobs. onChange(nextBands, persist) is owned
// by TrackFxEditor (live store update + debounced server persist).

const BAND_LABELS = ['低架', '低中', '中', '高中', '高架']

export default function TrackEqPanel({ bands, onChange, trackId }) {
  const [sel, setSel] = useState(2)
  const b = bands[sel] || {}
  const col = BAND_COLORS[sel % BAND_COLORS.length]

  const setBand = (patch, persist) => {
    onChange(bands.map((bb, j) => (j === sel ? { ...bb, ...patch } : bb)), persist)
  }
  const reset = () => onChange(DEFAULT_EQ_BANDS.map(x => ({ ...x })), true)

  const fmtFreq = (v) => (v >= 1000 ? `${(v / 1000).toFixed(v % 1000 === 0 ? 0 : 1)}k` : `${Math.round(v)}`)

  return (
    <div className="pt-1.5">
      <EqGraph bands={bands} onChange={onChange} trackId={trackId} selected={sel} onSelect={setSel} />

      {/* band selector */}
      <div className="flex gap-1 mt-2">
        {bands.map((_, i) => (
          <button
            key={i}
            onClick={() => setSel(i)}
            className={`flex-1 text-[9px] py-1 rounded border transition-colors ${sel === i ? '' : 'text-[#888] border-[#2a2a2f] hover:text-[#bbb]'}`}
            style={sel === i ? { borderColor: BAND_COLORS[i], color: BAND_COLORS[i] } : undefined}
          >
            {BAND_LABELS[i] || `B${i + 1}`}
          </button>
        ))}
      </div>

      {/* selected band knobs */}
      <div className="flex items-center justify-center gap-4 mt-2 rounded-lg px-3 py-3 bg-gradient-to-b from-[#1a1a1e] to-[#141417] border border-[#2a2a2f]">
        <Knob label="FREQ" value={Number(b.freq ?? 1000)} min={20} max={20000} step={1} def={1000} color={col} log
          format={fmtFreq} onChange={(v, p) => setBand({ freq: Math.round(v) }, p)} />
        <Knob label="GAIN" value={Number(b.gain ?? 0)} min={-18} max={18} step={0.1} def={0} color={col}
          format={(v) => `${v > 0 ? '+' : ''}${Number(v).toFixed(1)}`} onChange={(v, p) => setBand({ gain: +Number(v).toFixed(1) }, p)} />
        <Knob label="Q" value={Number(b.q ?? 1)} min={0.1} max={20} step={0.1} def={1} color={col}
          format={(v) => Number(v).toFixed(2)} onChange={(v, p) => setBand({ q: +Number(v).toFixed(2) }, p)} />
      </div>

      <div className="flex justify-between items-center mt-2 px-0.5">
        <span className="text-[9px] text-[#555]">拖曳圖上的點調整 · 滾輪改 Q</span>
        <button onClick={reset} className="text-[10px] text-[#666] hover:text-[#aaa]">重設</button>
      </div>
    </div>
  )
}
