import { useEffect, useRef, useState } from 'react'
import { useProjectStore } from '../../stores/projectStore'
import { audioEngine } from '../../audio/audioEngine'

// Main Out master channel — pinned at the bottom of the left "效果" tab. Master
// volume fader + live output peak meter (audioEngine.getOutputPeak, pre-limiter)
// + CLIP latch + dB readout. Mirrors the參考圖 right-side Main Out channel.

const MIN_DB = -48
const dbToPct = (db) => {
  if (!isFinite(db)) return 0
  const c = Math.max(MIN_DB, Math.min(0, db))
  return ((c - MIN_DB) / -MIN_DB) * 100
}
const volToDb = (v) => (v > 0.0001 ? 20 * Math.log10(v) : -Infinity)
const fmtDb = (db) => (db <= MIN_DB || !isFinite(db) ? '-∞' : (db > 0 ? '+' : '') + db.toFixed(1))

export default function MainOutStrip() {
  const masterVolume = useProjectStore(s => s.masterVolume)
  const setMasterVolume = useProjectStore(s => s.setMasterVolume)

  const [db, setDb] = useState(-Infinity)
  const [clip, setClip] = useState(false)
  const rafRef = useRef(null)
  const clipUntil = useRef(0)
  const tRef = useRef(0)

  useEffect(() => {
    const tick = () => {
      const { db: peakDb, clip: isClip } = audioEngine.getOutputPeak()
      setDb(peakDb)
      tRef.current += 1
      if (isClip) clipUntil.current = tRef.current + 60
      setClip(tRef.current < clipUntil.current)
      rafRef.current = requestAnimationFrame(tick)
    }
    rafRef.current = requestAnimationFrame(tick)
    return () => { if (rafRef.current) cancelAnimationFrame(rafRef.current) }
  }, [])

  const meterPct = dbToPct(db)
  const volDb = volToDb(masterVolume)
  const muted = masterVolume <= 0

  return (
    <div className="shrink-0 px-3 py-2.5 bg-gradient-to-b from-[#1c1c20] to-[#141416] border-t border-[#000]/50 shadow-[0_-1px_0_rgba(255,255,255,0.03)]">
      {/* Header */}
      <div className="flex items-center justify-between mb-2">
        <span className="text-[10px] font-semibold tracking-[0.15em] text-[#6d5efc]/80">MAIN OUT</span>
        <span className="font-mono text-[11px] text-[#e8e8ea] tabular-nums">{fmtDb(volDb)}<span className="text-[#666] text-[9px] ml-0.5">dB</span></span>
      </div>

      {/* Volume fader */}
      <div className="flex items-center gap-2 mb-1.5">
        <button
          onClick={() => setMasterVolume(v => (v > 0 ? 0 : 1))}
          className={`w-5 h-5 flex items-center justify-center shrink-0 transition-colors ${muted ? 'text-[#e0b341]' : 'text-[#888] hover:text-white'}`}
          title={muted ? '取消靜音' : '靜音'}
        >
          {muted ? (
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><line x1="23" y1="9" x2="17" y2="15"/><line x1="17" y1="9" x2="23" y2="15"/></svg>
          ) : (
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><path d="M19.07 4.93a10 10 0 0 1 0 14.14M15.54 8.46a5 5 0 0 1 0 7.07"/></svg>
          )}
        </button>
        <input
          type="range" min={0} max={1} step={0.01} value={masterVolume}
          onChange={e => setMasterVolume(+e.target.value)}
          onDoubleClick={() => setMasterVolume(1)}
          className="flex-1 h-1 accent-[#6d5efc] cursor-pointer"
          title="主音量（雙擊回 100%）"
        />
        <span className="font-mono text-[9px] text-[#777] tabular-nums w-8 text-right">{Math.round(masterVolume * 100)}%</span>
      </div>

      {/* Output peak meter */}
      <div className="flex items-center gap-2">
        <span className="text-[8px] font-mono text-[#555] w-5 shrink-0">OUT</span>
        <div className="relative flex-1 h-2 rounded-sm bg-black border border-[#2a2a2a] overflow-hidden">
          <div
            className="absolute inset-y-0 left-0"
            style={{ width: `${meterPct}%`, background: 'linear-gradient(to right, #22c55e 0%, #22c55e 70%, #eab308 88%, #ef4444 100%)' }}
          />
          <div className="absolute inset-y-0 right-0 w-px bg-[#ef4444]/60" />
        </div>
        <span
          className={`w-8 text-center text-[8px] font-mono rounded-sm py-0.5 shrink-0 transition-colors ${
            clip ? 'bg-[#ef4444] text-white' : 'bg-[#1a1a1a] text-[#444] border border-[#2a2a2a]'
          }`}
        >CLIP</span>
      </div>
    </div>
  )
}
