import { useRef, useEffect } from 'react'
import { audioEngine } from '../../audio/audioEngine'
import { eqCurveDb } from '../../utils/biquadResponse'

// FabFilter Pro-Q-style graphical EQ: log-frequency response graph with a live
// spectrum overlay and draggable per-band handles (drag = freq+gain, wheel = Q).
// Fixed 5 bands; DSP unchanged. onChange(nextBands, persist) — live during drag,
// persist on release.

const W = 440, H = 210
const F_MIN = 20, F_MAX = 20000
const LOG_MIN = Math.log10(F_MIN)
const LOG_SPAN = Math.log10(F_MAX / F_MIN)
const GMAX = 18
export const BAND_COLORS = ['#E94560', '#f59e0b', '#22c55e', '#22d3ee', '#6d5efc']
const F_LINES = [[20, ''], [50, ''], [100, '100'], [200, ''], [500, ''], [1000, '1k'], [2000, ''], [5000, ''], [10000, '10k'], [20000, '20k']]
const G_LINES = [12, 6, 0, -6, -12]
const CURVE_F = Array.from({ length: 200 }, (_, i) => Math.pow(10, LOG_MIN + (i / 199) * LOG_SPAN))

const clamp = (v, lo, hi) => { v = Number(v); return Number.isFinite(v) ? Math.max(lo, Math.min(hi, v)) : lo }
const xOf = (f) => ((Math.log10(clamp(f, F_MIN, F_MAX)) - LOG_MIN) / LOG_SPAN) * W
const fOf = (x) => Math.pow(10, LOG_MIN + (x / W) * LOG_SPAN)
const yOf = (g) => H / 2 - (clamp(g, -GMAX, GMAX) / GMAX) * (H / 2)
const gOf = (y) => ((H / 2 - y) / (H / 2)) * GMAX

export default function EqGraph({ bands, onChange, trackId, selected, onSelect }) {
  const svgRef = useRef(null)
  const canvasRef = useRef(null)

  // Live spectrum on the canvas, animated independently of React renders.
  useEffect(() => {
    const cv = canvasRef.current
    if (!cv) return
    const g = cv.getContext('2d')
    let raf
    const draw = () => {
      g.clearRect(0, 0, W, H)
      const spec = trackId ? audioEngine.getTrackSpectrum(trackId) : null
      if (spec) {
        const { data, sampleRate, fftSize } = spec
        g.beginPath(); g.moveTo(0, H)
        for (let x = 0; x <= W; x += 2) {
          const bin = Math.round((fOf(x) * fftSize) / sampleRate)
          const v = data[Math.min(bin, data.length - 1)] || 0
          g.lineTo(x, H - (v / 255) * H * 0.92)
        }
        g.lineTo(W, H); g.closePath()
        g.fillStyle = 'rgba(109,94,252,0.16)'
        g.fill()
      }
      raf = requestAnimationFrame(draw)
    }
    raf = requestAnimationFrame(draw)
    return () => cancelAnimationFrame(raf)
  }, [trackId])

  const ys = eqCurveDb(bands, CURVE_F)
  let curvePath = ''
  for (let i = 0; i < CURVE_F.length; i++) {
    curvePath += (i === 0 ? 'M' : 'L') + xOf(CURVE_F[i]).toFixed(1) + ' ' + yOf(ys[i]).toFixed(1) + ' '
  }

  const posFromEvent = (e) => {
    const r = svgRef.current.getBoundingClientRect()
    return {
      x: clamp(((e.clientX - r.left) / r.width) * W, 0, W),
      y: clamp(((e.clientY - r.top) / r.height) * H, 0, H),
    }
  }

  const startDrag = (i) => (e) => {
    e.preventDefault()
    onSelect(i)
    const orig = bands
    let last = orig
    const move = (ev) => {
      const { x, y } = posFromEvent(ev)
      last = orig.map((b, j) => j === i
        ? { ...b, freq: Math.round(clamp(fOf(x), F_MIN, F_MAX)), gain: +clamp(gOf(y), -GMAX, GMAX).toFixed(1) }
        : b)
      onChange(last, false)
    }
    const up = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      onChange(last, true)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }

  const onWheelHandle = (i) => (e) => {
    const cur = clamp(bands[i]?.q, 0.1, 20) || 1
    const q = +clamp(cur * (e.deltaY > 0 ? 1.12 : 0.89), 0.1, 20).toFixed(3)
    onChange(bands.map((b, j) => (j === i ? { ...b, q } : b)), true)
  }

  return (
    <div className="relative rounded-lg overflow-hidden border border-[#2a2a2f] bg-[#0c0c0f]" style={{ width: W, height: H }}>
      <canvas ref={canvasRef} width={W} height={H} className="absolute inset-0" />
      <svg ref={svgRef} width={W} height={H} viewBox={`0 0 ${W} ${H}`} className="absolute inset-0">
        {/* vertical freq grid */}
        {F_LINES.map(([f, lbl]) => (
          <g key={f}>
            <line x1={xOf(f)} y1={0} x2={xOf(f)} y2={H} stroke="#ffffff" strokeOpacity="0.05" />
            {lbl && <text x={xOf(f) + 2} y={H - 4} fontSize="8" fill="#555" fontFamily="monospace">{lbl}</text>}
          </g>
        ))}
        {/* horizontal dB grid */}
        {G_LINES.map(gdb => (
          <g key={gdb}>
            <line x1={0} y1={yOf(gdb)} x2={W} y2={yOf(gdb)} stroke="#ffffff" strokeOpacity={gdb === 0 ? 0.16 : 0.05} />
            <text x={W - 2} y={yOf(gdb) - 2} fontSize="8" fill="#555" fontFamily="monospace" textAnchor="end">{gdb > 0 ? `+${gdb}` : gdb}</text>
          </g>
        ))}
        {/* response curve */}
        <path d={curvePath} fill="none" stroke="#f5b942" strokeWidth="2" strokeLinejoin="round"
          style={{ filter: 'drop-shadow(0 0 3px rgba(245,185,74,0.4))' }} />
        {/* band handles */}
        {bands.map((b, i) => {
          const col = BAND_COLORS[i % BAND_COLORS.length]
          const sel = selected === i
          return (
            <circle
              key={i} cx={xOf(b.freq)} cy={yOf(b.gain)} r={sel ? 7 : 5.5}
              fill={col} stroke="#fff" strokeOpacity={sel ? 0.9 : 0.4} strokeWidth={sel ? 2 : 1}
              style={{ cursor: 'grab', filter: `drop-shadow(0 0 ${sel ? 4 : 2}px ${col})` }}
              onPointerDown={startDrag(i)}
              onWheel={onWheelHandle(i)}
            />
          )
        })}
      </svg>
    </div>
  )
}
