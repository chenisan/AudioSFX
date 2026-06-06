import { useEffect, useRef, useState } from 'react'
import { audioEngine } from '../../audio/audioEngine'

// Master output peak meter + clip indicator. Reads audioEngine.getOutputPeak()
// (tapped pre-limiter), so the red light means the raw mix hit ≥ 0 dBFS and the
// master limiter is engaging — useful to diagnose EQ-boost "爆爆" clipping while
// the limiter keeps the actual output clean.
//
// Meter range: -48 dBFS (left) → 0 dBFS (right). Green < -6, yellow -6..-1,
// red ≥ -1. The CLIP latch lights when raw peak ≥ 0 dBFS and holds ~1s.
const MIN_DB = -48

function dbToPct(db) {
  if (!isFinite(db)) return 0
  const clamped = Math.max(MIN_DB, Math.min(0, db))
  return ((clamped - MIN_DB) / -MIN_DB) * 100
}

export default function OutputMeter() {
  const [db, setDb] = useState(-Infinity)
  const [clip, setClip] = useState(false)
  const rafRef = useRef(null)
  const clipUntilRef = useRef(0)
  const tRef = useRef(0)

  // Always-on poll: reads the master peak every frame regardless of play state,
  // so it reflects whatever is hitting the output (silence reads −∞). Reading a
  // 1024-sample float array + a max scan per frame is negligible.
  useEffect(() => {
    const tick = () => {
      const { db: peakDb, clip: isClip } = audioEngine.getOutputPeak()
      setDb(peakDb)
      // Latch the clip light ~1s so a brief over is still visible. Use a frame
      // counter instead of Date.now() (cheap, monotonic enough for UI).
      tRef.current += 1
      if (isClip) clipUntilRef.current = tRef.current + 60
      setClip(tRef.current < clipUntilRef.current)
      rafRef.current = requestAnimationFrame(tick)
    }
    rafRef.current = requestAnimationFrame(tick)
    return () => { if (rafRef.current) cancelAnimationFrame(rafRef.current) }
  }, [])

  const pct = dbToPct(db)
  const label = isFinite(db) ? `${db <= MIN_DB ? '−∞' : db.toFixed(1)}` : '−∞'

  return (
    <div className="flex items-center gap-1.5 mr-2" title="主輸出峰值（−∞ … 0 dBFS）。紅＝原始混音 ≥ 0 dBFS，限幅器介入中">
      <span className="text-[9px] text-[#666] font-mono select-none">OUT</span>
      <div className="relative w-20 h-2 rounded-sm bg-[#1a1a1a] border border-[#2a2a2a] overflow-hidden">
        {/* level fill */}
        <div
          className="absolute inset-y-0 left-0"
          style={{
            width: `${pct}%`,
            background: 'linear-gradient(to right, #22c55e 0%, #22c55e 70%, #eab308 88%, #ef4444 100%)',
          }}
        />
        {/* 0 dBFS tick */}
        <div className="absolute inset-y-0 right-0 w-px bg-[#ef4444]/60" />
      </div>
      {/* CLIP latch */}
      <span
        className={`w-7 text-center text-[8px] font-mono rounded-sm px-0.5 select-none transition-colors ${
          clip ? 'bg-[#ef4444] text-white' : 'bg-[#1a1a1a] text-[#444] border border-[#2a2a2a]'
        }`}
        title="CLIP：原始混音超過 0 dBFS（限幅器正在壓）"
      >
        CLIP
      </span>
      <span className="w-9 text-right text-[9px] font-mono text-[#888] tabular-nums select-none">{label}</span>
    </div>
  )
}
