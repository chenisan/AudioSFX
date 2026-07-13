import { useEffect, useRef, useState } from 'react'

// Ableton-style preview strip for the local library: shows the current sound's
// waveform with a play-progress overlay + moving playhead, and click-to-seek.
// Peaks come from GET /api/local-library/waveform (Rust computeWaveform, cached).
// `audioRef` is the panel's shared Audio() element; we read currentTime each frame.
export default function WaveformPreview({ item, audioRef, playingId }) {
  const canvasRef = useRef(null)
  const [wave, setWave] = useState(null)
  const [failed, setFailed] = useState(false)

  // Fetch peaks whenever the shown item changes.
  useEffect(() => {
    if (!item) { setWave(null); setFailed(false); return }
    let alive = true
    setWave(null); setFailed(false)
    fetch(`/api/local-library/waveform?id=${encodeURIComponent(item.id)}`)
      .then(r => (r.ok ? r.json() : null))
      .then(d => { if (alive) (d && d.peaksMax ? setWave(d) : setFailed(true)) })
      .catch(() => { if (alive) setFailed(true) })
    return () => { alive = false }
  }, [item?.id])

  // Continuous draw loop: waveform bars + played/unplayed split + playhead line.
  useEffect(() => {
    let raf
    const draw = () => {
      raf = requestAnimationFrame(draw)
      const canvas = canvasRef.current
      if (!canvas) return
      const W = canvas.clientWidth, H = canvas.clientHeight
      if (W < 2 || H < 2) return
      const dpr = Math.min(window.devicePixelRatio || 1, 2)
      if (canvas.width !== Math.round(W * dpr)) { canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr) }
      const ctx = canvas.getContext('2d')
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      ctx.clearRect(0, 0, W, H)
      if (!wave) return

      const { peaksMin, peaksMax, bucketCount, duration } = wave
      const a = audioRef.current
      const playingThis = a && playingId === item?.id
      const dur = duration || (a && a.duration) || 1
      const t = playingThis ? a.currentTime : 0
      const playedX = Math.min(1, Math.max(0, t / dur)) * W

      const bars = Math.max(1, Math.floor(W / 2))
      const barW = Math.max(1, W / bars - 0.5)
      const centerY = H / 2, halfH = H / 2 - 1
      for (let i = 0; i < bars; i++) {
        const from = Math.floor((i / bars) * bucketCount)
        const to = Math.max(from + 1, Math.floor(((i + 1) / bars) * bucketCount))
        let hi = 0, lo = 0
        for (let j = from; j < to && j < bucketCount; j++) {
          if (peaksMax[j] > hi) hi = peaksMax[j]
          if (peaksMin[j] < lo) lo = peaksMin[j]
        }
        const x = (i / bars) * W
        const top = centerY - hi * halfH
        const bot = centerY - lo * halfH
        ctx.fillStyle = x <= playedX ? 'rgba(34,197,94,0.9)' : 'rgba(130,130,130,0.45)'
        ctx.fillRect(x, top, barW, Math.max(1, bot - top))
      }
      if (playingThis) {
        ctx.fillStyle = '#22c55e'
        ctx.fillRect(playedX - 0.75, 0, 1.5, H)
      }
    }
    raf = requestAnimationFrame(draw)
    return () => cancelAnimationFrame(raf)
  }, [wave, audioRef, playingId, item?.id])

  const seek = (e) => {
    const a = audioRef.current
    if (!a || !wave) return
    const rect = e.currentTarget.getBoundingClientRect()
    const frac = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width))
    const dur = wave.duration || a.duration || 0
    if (dur) a.currentTime = frac * dur
  }

  if (!item) return null
  return (
    <div className="px-2 pt-1.5 pb-1 border-b border-[#2a2a2a] shrink-0">
      <div className="text-[10px] text-[#aaa] truncate mb-1" title={item.name}>{item.name}</div>
      <canvas
        ref={canvasRef}
        onClick={seek}
        className="w-full h-12 rounded bg-[#0d0d0d] border border-[#2a2a2a] cursor-pointer block"
      />
      {failed && <div className="text-[9px] text-[#666] mt-0.5">（此檔無法產生波形）</div>}
    </div>
  )
}
