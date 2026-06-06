import { useEffect, useRef, useState, useCallback } from 'react'
import { useProjectStore } from '../../stores/projectStore'
import { audioEngine } from '../../audio/audioEngine'

// DAW-style channel strip for the track inspector: name + M/S, a vertical
// dB-scaled volume fader with a tick scale, a live peak meter hugging the fader
// (0 dB line aligned across both), and a numeric dB readout.
//
// Volume is stored linear (0–4); the fader works in dB across [-60, +12] so it
// behaves like a console fader. Meter reads audioEngine.getTrackPeak (post-FX).

const TOP_DB = 12
const BOT_DB = -60
const RANGE = TOP_DB - BOT_DB
const SCALE_TICKS = [12, 6, 0, -6, -12, -24, -36, -48, -60]

const gainToDb = (g) => (g > 0.0001 ? 20 * Math.log10(g) : BOT_DB)
const dbToGain = (db) => (db <= BOT_DB ? 0 : Math.pow(10, db / 20))
const dbToFrac = (db) => Math.max(0, Math.min(1, (db - BOT_DB) / RANGE)) // 0=bottom, 1=top
const fmtDb = (db) => (db <= BOT_DB ? '-∞' : (db > 0 ? '+' : '') + db.toFixed(1))

export default function ChannelStrip({ track }) {
  const setTrackVolume = useProjectStore(s => s.setTrackVolume)
  const setTrackVolumeLive = useProjectStore(s => s.setTrackVolumeLive)
  const toggleTrackMuted = useProjectStore(s => s.toggleTrackMuted)
  const timerRef = useRef(null)
  const faderRef = useRef(null)
  const draggingRef = useRef(false)

  const vol = track.volume ?? 1
  const muted = !!track.muted
  const db = gainToDb(vol)
  const faderFrac = dbToFrac(db)

  const commitVol = useCallback((v) => {
    const clamped = Math.max(0, Math.min(4, v))
    setTrackVolumeLive(track.id, clamped)
    if (timerRef.current) clearTimeout(timerRef.current)
    timerRef.current = setTimeout(() => setTrackVolume(track.id, clamped), 250)
  }, [track.id, setTrackVolume, setTrackVolumeLive])

  const setFromClientY = useCallback((clientY) => {
    const el = faderRef.current
    if (!el) return
    const r = el.getBoundingClientRect()
    const frac = 1 - (clientY - r.top) / r.height
    const ndb = BOT_DB + Math.max(0, Math.min(1, frac)) * RANGE
    commitVol(dbToGain(ndb))
  }, [commitVol])

  const onPointerDown = (e) => {
    draggingRef.current = true
    try { e.currentTarget.setPointerCapture(e.pointerId) } catch {}
    setFromClientY(e.clientY)
  }
  const onPointerMove = (e) => { if (draggingRef.current) setFromClientY(e.clientY) }
  const onPointerUp = (e) => {
    draggingRef.current = false
    try { e.currentTarget.releasePointerCapture(e.pointerId) } catch {}
  }

  // Live peak meter (post-FX). Frame-counter clip latch ~1s.
  const [meterFrac, setMeterFrac] = useState(0)
  const [clip, setClip] = useState(false)
  const rafRef = useRef(null)
  const clipUntilRef = useRef(0)
  const tRef = useRef(0)
  useEffect(() => {
    const tick = () => {
      const { db: peakDb, clip: isClip } = audioEngine.getTrackPeak(track.id)
      setMeterFrac(isFinite(peakDb) ? dbToFrac(peakDb) : 0)
      tRef.current += 1
      if (isClip) clipUntilRef.current = tRef.current + 60
      setClip(tRef.current < clipUntilRef.current)
      rafRef.current = requestAnimationFrame(tick)
    }
    rafRef.current = requestAnimationFrame(tick)
    return () => { if (rafRef.current) cancelAnimationFrame(rafRef.current) }
  }, [track.id])

  const zeroTop = `${(1 - dbToFrac(0)) * 100}%`  // 0 dB line position

  return (
    <div className="select-none">
      {/* Header: name + M/S */}
      <div className="flex items-center gap-2 mb-3">
        <span className="text-[11px]">{track.type === 'audio' ? '🎵' : '🎬'}</span>
        <span className="text-xs text-[#e8e8ea] font-medium truncate flex-1">{track.name}</span>
        <button
          onClick={() => toggleTrackMuted(track.id)}
          className={`w-6 h-6 rounded text-[10px] font-bold transition-colors ${
            muted ? 'bg-[#e0b341] text-black shadow-[0_0_8px_rgba(224,179,65,0.4)]' : 'bg-[#262629] text-[#777] hover:text-[#aaa] border border-[#333]'
          }`}
          title={muted ? '取消靜音' : '靜音'}
        >M</button>
        <button
          disabled
          className="w-6 h-6 rounded text-[10px] font-bold bg-[#262629] text-[#444] border border-[#2e2e30] cursor-not-allowed"
          title="Solo（規劃中）"
        >S</button>
      </div>

      {/* Fader section: scale | fader | meter | readout */}
      <div className="flex items-stretch gap-2 h-[188px] px-1">
        {/* dB scale */}
        <div className="relative w-7 shrink-0">
          {SCALE_TICKS.map(t => (
            <div
              key={t}
              className="absolute right-0 flex items-center gap-1 -translate-y-1/2"
              style={{ top: `${(1 - dbToFrac(t)) * 100}%` }}
            >
              <span className={`font-mono text-[8px] tabular-nums ${t === 0 ? 'text-[#9b8dff]' : 'text-[#555]'}`}>
                {t > 0 ? `+${t}` : t}
              </span>
              <span className={`w-1 h-px ${t === 0 ? 'bg-[#6d5efc]' : 'bg-[#3a3a3a]'}`} />
            </div>
          ))}
        </div>

        {/* Fader */}
        <div
          ref={faderRef}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onDoubleClick={() => commitVol(1)}
          className="relative w-7 shrink-0 cursor-ns-resize touch-none"
          title="整軌音量（拖曳；雙擊回 0 dB）"
        >
          {/* groove */}
          <div className="absolute left-1/2 -translate-x-1/2 top-1 bottom-1 w-[3px] rounded-full bg-[#0c0c0d] border border-[#2a2a2a]" />
          {/* filled portion up to thumb */}
          <div
            className="absolute left-1/2 -translate-x-1/2 w-[3px] rounded-full bg-gradient-to-t from-[#6d5efc]/30 to-[#6d5efc]"
            style={{ bottom: '4px', height: `calc(${faderFrac * 100}% - 4px)` }}
          />
          {/* 0 dB reference line */}
          <div className="absolute left-0 right-0 h-px bg-[#6d5efc]/25" style={{ top: zeroTop }} />
          {/* thumb */}
          <div
            className="absolute left-1/2 -translate-x-1/2 -translate-y-1/2 w-6 h-3.5 rounded-[3px] bg-gradient-to-b from-[#3a3a3f] to-[#222226] border border-[#4a4a52] shadow-[0_2px_4px_rgba(0,0,0,0.6)] flex flex-col items-center justify-center gap-[2px]"
            style={{ top: `${(1 - faderFrac) * 100}%` }}
          >
            <span className="w-3.5 h-px bg-[#6d5efc]" />
            <span className="w-3.5 h-px bg-[#555]" />
            <span className="w-3.5 h-px bg-[#555]" />
          </div>
        </div>

        {/* Meter */}
        <div className="relative w-2.5 shrink-0 rounded-sm overflow-hidden bg-black border-l border-r border-[#333]">
          <div
            className="absolute inset-x-0 bottom-0"
            style={{ height: `${meterFrac * 100}%`, background: 'linear-gradient(to top, #22c55e 0%, #22c55e 62%, #eab308 84%, #ef4444 100%)' }}
          />
          <div className="absolute left-0 right-0 h-px bg-white/15" style={{ top: zeroTop }} />
          {clip && <div className="absolute inset-x-0 top-0 h-1 bg-[#ef4444]" />}
        </div>

        {/* Readout */}
        <div className="flex-1 flex flex-col justify-end pb-0.5">
          <div className="text-right">
            <div className="font-mono text-[15px] text-[#e8e8ea] tabular-nums leading-none">{fmtDb(db)}</div>
            <div className="font-mono text-[9px] text-[#666] mt-0.5">dB · {Math.round(vol * 100)}%</div>
          </div>
        </div>
      </div>
    </div>
  )
}
