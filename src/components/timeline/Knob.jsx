import { useRef, useCallback, useId } from 'react'

// Rotary knob styled after the poster's neon synth knobs: a colored neon bloom,
// a ring of tick marks (the scale) that light up in the knob's accent colour up
// to the current value, a 3D dial (top-lit metallic bezel + domed face +
// specular highlight + drop shadow) and a glowing pointer. Each knob takes a
// distinct `color` so the four reverb controls are easy to tell apart — matching
// the poster's pink→purple→cyan→green spectrum.
//
// Vertical drag to change; double-click to reset to `def`.
// onChange(value, persist) — persist=false during drag (live), true on release.

const SIZE = 78
const C = SIZE / 2
const DIAL = 18              // dial face radius
const TICK_RI = 28          // tick inner radius (more gap from the dial)
const TICK_RO = 31          // tick outer radius (shorter ticks, poster-style)
const N_TICKS = 25
const START = 225           // screen angle (up=0, clockwise) for frac=0
const SWEEP = 270           // gap of 90° at the bottom

// Gloss arc: 170° over the top (±85° from 12 o'clock), centred on the dial face.
const GLOSS_R = DIAL - 4
const GLOSS_X = GLOSS_R * Math.sin((85 * Math.PI) / 180)
const GLOSS_Y = GLOSS_R * Math.cos((85 * Math.PI) / 180)

export default function Knob({ label, value, min = 0, max = 100, step = 1, unit = '', def, onChange, color = '#6d5efc', scale = 1, format, log = false, variant = 'neon' }) {
  const uid = useId().replace(/:/g, '')
  const v = Number.isFinite(value) ? value : (def ?? min)
  const fracOf = (val) => (log ? Math.log(Math.max(min, val) / min) / Math.log(max / min) : (val - min) / (max - min || 1))
  const valOf = (f) => (log ? min * Math.pow(max / min, f) : min + f * (max - min))
  const frac = Math.max(0, Math.min(1, fracOf(v)))

  const commit = useCallback((raw, persist) => {
    const snapped = Math.round(raw / step) * step
    onChange(Math.max(min, Math.min(max, snapped)), persist)
  }, [min, max, step, onChange])

  const onDown = (e) => {
    e.preventDefault()
    const startY = e.clientY
    const startFrac = Math.max(0, Math.min(1, fracOf(v)))   // up = increase
    const at = (ev) => Math.max(0, Math.min(1, startFrac + (startY - ev.clientY) / 150))
    const move = (ev) => commit(valOf(at(ev)), false)
    const up = (ev) => {
      commit(valOf(at(ev)), true)
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }

  // ── Amp variant: a realistic black hardware knob (matte dial + metal bezel +
  // light indicator line + warm tick scale) styled after a guitar-amp head. ──
  if (variant === 'amp') {
    const D = 22                 // dial face radius (chunky amp knob)
    const TRI = 28               // tick inner radius
    const TRO = 31               // tick outer radius
    return (
      <div className="flex flex-col items-center gap-1.5 select-none">
        <span className="text-[9px] font-semibold tracking-[0.14em] uppercase text-[#b8b0a6]">{label}</span>
        <svg
          width={SIZE * scale} height={SIZE * scale} viewBox={`0 0 ${SIZE} ${SIZE}`}
          className="cursor-ns-resize touch-none"
          onPointerDown={onDown}
          onDoubleClick={() => def != null && commit(def, true)}
          title="拖曳調整（雙擊重設）"
        >
          <defs>
            <radialGradient id={`afill-${uid}`} cx="0.5" cy="0.5" r="0.5">
              <stop offset="0" stopColor={color} stopOpacity="0.30" />
              <stop offset="0.6" stopColor={color} stopOpacity="0.07" />
              <stop offset="1" stopColor={color} stopOpacity="0" />
            </radialGradient>
            <linearGradient id={`aring-${uid}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stopColor="#4a4a4e" />
              <stop offset="0.5" stopColor="#26262a" />
              <stop offset="1" stopColor="#0b0b0d" />
            </linearGradient>
            <radialGradient id={`aface-${uid}`} cx="0.40" cy="0.32" r="0.85">
              <stop offset="0" stopColor="#2e2e31" />
              <stop offset="0.5" stopColor="#1a1a1c" />
              <stop offset="1" stopColor="#08080a" />
            </radialGradient>
            <radialGradient id={`ash-${uid}`} cx="0.5" cy="0.5" r="0.5">
              <stop offset="0.55" stopColor="rgba(0,0,0,0.65)" />
              <stop offset="1" stopColor="rgba(0,0,0,0)" />
            </radialGradient>
          </defs>

          {/* warm accent bloom */}
          <circle cx={C} cy={C} r={D + 10} fill={`url(#afill-${uid})`} />

          {/* tick scale — neutral, lights warm up to the current value */}
          {Array.from({ length: N_TICKS }).map((_, i) => {
            const tf = i / (N_TICKS - 1)
            const active = tf <= frac + 0.001
            return (
              <g key={i} transform={`rotate(${START + tf * SWEEP} ${C} ${C})`}>
                <line
                  x1={C} y1={C - TRO} x2={C} y2={C - TRI}
                  stroke={active ? color : '#3d3d40'}
                  strokeWidth={active ? 1.1 : 0.7}
                  strokeLinecap="round"
                  style={active ? { filter: `drop-shadow(0 0 1.2px ${color})` } : undefined}
                />
              </g>
            )
          })}

          {/* cast shadow */}
          <ellipse cx={C} cy={C + 3.5} rx={D + 2.5} ry={D + 1.5} fill={`url(#ash-${uid})`} />
          {/* knurled metal bezel */}
          <circle cx={C} cy={C} r={D + 3} fill={`url(#aring-${uid})`} stroke="#000" strokeOpacity="0.5" strokeWidth="0.8" />
          {/* matte dial face */}
          <circle cx={C} cy={C} r={D} fill={`url(#aface-${uid})`} stroke="#000" strokeOpacity="0.6" strokeWidth="0.6" />
          {/* faint top rim highlight */}
          <path
            d={`M ${C - D * 0.7} ${C - D * 0.62} A ${D} ${D} 0 0 1 ${C + D * 0.7} ${C - D * 0.62}`}
            fill="none" stroke="#fff" strokeOpacity="0.10" strokeWidth="1.1" strokeLinecap="round"
          />
          {/* light indicator line from face centre toward the rim */}
          <g transform={`rotate(${START + frac * SWEEP} ${C} ${C})`}>
            <line x1={C} y1={C - 6} x2={C} y2={C - (D - 3)} stroke="#e9e2d6" strokeWidth="1.8" strokeLinecap="round" />
          </g>
        </svg>
        <span className="text-[10px] font-mono text-[#c9c2b6] tabular-nums">{format ? format(v) : `${Math.round(v)}${unit}`}</span>
      </div>
    )
  }

  return (
    <div className="flex flex-col items-center gap-1.5 select-none">
      <span className="text-[9px] font-medium tracking-[0.12em] uppercase" style={{ color }}>{label}</span>
      <svg
        width={SIZE * scale} height={SIZE * scale} viewBox={`0 0 ${SIZE} ${SIZE}`}
        className="cursor-ns-resize touch-none"
        onPointerDown={onDown}
        onDoubleClick={() => def != null && commit(def, true)}
        title="拖曳調整（雙擊重設）"
      >
        <defs>
          <radialGradient id={`glow-${uid}`} cx="0.5" cy="0.5" r="0.5">
            <stop offset="0" stopColor={color} stopOpacity="0.45" />
            <stop offset="0.55" stopColor={color} stopOpacity="0.12" />
            <stop offset="1" stopColor={color} stopOpacity="0" />
          </radialGradient>
          <linearGradient id={`bezel-${uid}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#56565f" />
            <stop offset="0.5" stopColor="#2b2b31" />
            <stop offset="1" stopColor="#0e0e11" />
          </linearGradient>
          <radialGradient id={`face-${uid}`} cx="0.38" cy="0.30" r="0.8">
            <stop offset="0" stopColor="#3e3e48" />
            <stop offset="0.55" stopColor="#222227" />
            <stop offset="1" stopColor="#111114" />
          </radialGradient>
          <radialGradient id={`shadow-${uid}`} cx="0.5" cy="0.5" r="0.5">
            <stop offset="0.55" stopColor="rgba(0,0,0,0.6)" />
            <stop offset="1" stopColor="rgba(0,0,0,0)" />
          </radialGradient>
          {/* gloss arc gradient: transparent → white → transparent across the top */}
          <linearGradient id={`gloss-${uid}`} gradientUnits="userSpaceOnUse"
            x1={C - GLOSS_X} y1={C - GLOSS_Y} x2={C + GLOSS_X} y2={C - GLOSS_Y}>
            <stop offset="0" stopColor="#fff" stopOpacity="0" />
            <stop offset="0.5" stopColor="#fff" stopOpacity="0.55" />
            <stop offset="1" stopColor="#fff" stopOpacity="0" />
          </linearGradient>
        </defs>

        {/* neon bloom */}
        <circle cx={C} cy={C} r={DIAL + 12} fill={`url(#glow-${uid})`} />

        {/* tick scale — lights up in the accent colour up to the current value */}
        {Array.from({ length: N_TICKS }).map((_, i) => {
          const tf = i / (N_TICKS - 1)
          const active = tf <= frac + 0.001
          return (
            <g key={i} transform={`rotate(${START + tf * SWEEP} ${C} ${C})`}>
              <line
                x1={C} y1={C - TICK_RO} x2={C} y2={C - TICK_RI}
                stroke={active ? color : '#3a3a40'}
                strokeWidth={active ? 0.9 : 0.6}
                strokeLinecap="round"
                style={active ? { filter: `drop-shadow(0 0 1px ${color})` } : undefined}
              />
            </g>
          )
        })}

        {/* drop shadow under the dial */}
        <ellipse cx={C} cy={C + 3} rx={DIAL + 2} ry={DIAL + 1} fill={`url(#shadow-${uid})`} />
        {/* metallic bezel, tinted faintly by the accent */}
        <circle cx={C} cy={C} r={DIAL + 2.5} fill={`url(#bezel-${uid})`} stroke={color} strokeOpacity="0.35" strokeWidth="1" />
        {/* domed face */}
        <circle cx={C} cy={C} r={DIAL} fill={`url(#face-${uid})`} stroke="#000" strokeOpacity="0.45" strokeWidth="0.7" />
        {/* glossy reflection: a thin white 170° arc over the top, fading at both ends */}
        <path
          d={`M ${C - GLOSS_X} ${C - GLOSS_Y} A ${GLOSS_R} ${GLOSS_R} 0 0 1 ${C + GLOSS_X} ${C - GLOSS_Y}`}
          fill="none" stroke={`url(#gloss-${uid})`} strokeWidth="1.6" strokeLinecap="round"
        />
        {/* pointer notch in the accent colour */}
        <g transform={`rotate(${START + frac * SWEEP} ${C} ${C})`}>
          <line x1={C} y1={C - (DIAL - 12)} x2={C} y2={C - (DIAL - 5)} stroke={color} strokeWidth="1.2" strokeLinecap="round"
            style={{ filter: `drop-shadow(0 0 1.2px ${color})` }} />
        </g>
      </svg>
      <span className="text-[10px] font-mono text-[#bbb] tabular-nums">{format ? format(v) : `${Math.round(v)}${unit}`}</span>
    </div>
  )
}
