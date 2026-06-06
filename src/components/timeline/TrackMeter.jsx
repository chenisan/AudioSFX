import { useEffect, useRef, useState } from 'react'
import { audioEngine } from '../../audio/audioEngine'

// Vertical per-track output meter, pinned to the right edge of the track header
// (so it sits at the track's left edge next to the clip lane). Reads
// audioEngine.getTrackPeak(trackId) — the post-EQ, post-track-volume, pre-master
// mix for this track. Range −48 dBFS (bottom) … 0 dBFS (top); a clip latch
// flashes the top red ~1s when the track hits 0 dBFS.
const MIN_DB = -48

function dbToPct(db) {
  if (!isFinite(db)) return 0
  const clamped = Math.max(MIN_DB, Math.min(0, db))
  return ((clamped - MIN_DB) / -MIN_DB) * 100
}

export default function TrackMeter({ trackId }) {
  const [pct, setPct] = useState(0)
  const [clip, setClip] = useState(false)
  const rafRef = useRef(null)
  const clipUntilRef = useRef(0)
  const tRef = useRef(0)

  // Always-on poll; reads a 1024-sample float frame per rAF (negligible cost).
  // Silence reads −∞ → 0% when nothing is scheduled on the track.
  useEffect(() => {
    const tick = () => {
      const { db, clip: isClip } = audioEngine.getTrackPeak(trackId)
      setPct(dbToPct(db))
      tRef.current += 1
      if (isClip) clipUntilRef.current = tRef.current + 60
      setClip(tRef.current < clipUntilRef.current)
      rafRef.current = requestAnimationFrame(tick)
    }
    rafRef.current = requestAnimationFrame(tick)
    return () => { if (rafRef.current) cancelAnimationFrame(rafRef.current) }
  }, [trackId])

  return (
    <div
      className="relative w-2 self-stretch shrink-0 overflow-hidden bg-black border-l border-r border-[#3a3a3a]"
      title="軌道輸出峰值（−∞ … 0 dBFS，紅＝削波）"
    >
      {/* Level fill rising from the bottom — empty slot stays visibly dark. */}
      <div
        className="absolute inset-x-0 bottom-0"
        style={{ height: `${pct}%`, background: 'linear-gradient(to top, #22c55e 0%, #22c55e 55%, #eab308 80%, #ef4444 100%)' }}
      />
      {/* Clip latch at the top. */}
      {clip && <div className="absolute inset-x-0 top-0 h-1.5 bg-[#ef4444]" />}
    </div>
  )
}
