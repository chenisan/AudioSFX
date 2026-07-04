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
            {/* machined bezel: top-lit steel that falls to near-black */}
            <linearGradient id={`aring-${uid}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stopColor="#6a6a72" />
              <stop offset="0.28" stopColor="#3a3a40" />
              <stop offset="0.62" stopColor="#1c1c20" />
              <stop offset="1" stopColor="#050506" />
            </linearGradient>
            {/* anodized sheen swept across the bezel (fakes a conic highlight) */}
            <linearGradient id={`asheen-${uid}`} x1="0" y1="0" x2="1" y2="1">
              <stop offset="0" stopColor="#fff" stopOpacity="0.22" />
              <stop offset="0.35" stopColor="#fff" stopOpacity="0.02" />
              <stop offset="0.65" stopColor="#000" stopOpacity="0.12" />
              <stop offset="1" stopColor="#fff" stopOpacity="0.10" />
            </linearGradient>
            {/* domed matte face, light source upper-left */}
            <radialGradient id={`aface-${uid}`} cx="0.36" cy="0.26" r="0.95">
              <stop offset="0" stopColor="#3a3a3f" />
              <stop offset="0.35" stopColor="#232327" />
              <stop offset="0.75" stopColor="#121215" />
              <stop offset="1" stopColor="#050507" />
            </radialGradient>
            {/* soft specular blob on the dome */}
            <radialGradient id={`aspec-${uid}`} cx="0.5" cy="0.5" r="0.5">
              <stop offset="0" stopColor="#fff" stopOpacity="0.30" />
              <stop offset="0.55" stopColor="#fff" stopOpacity="0.08" />
              <stop offset="1" stopColor="#fff" stopOpacity="0" />
            </radialGradient>
            <radialGradient id={`ash-${uid}`} cx="0.5" cy="0.5" r="0.5">
              <stop offset="0.45" stopColor="rgba(0,0,0,0.7)" />
              <stop offset="1" stopColor="rgba(0,0,0,0)" />
            </radialGradient>
            <filter id={`ablur-${uid}`} x="-40%" y="-40%" width="180%" height="180%">
              <feGaussianBlur stdDeviation="1.6" />
            </filter>
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

          {/* soft cast shadow (blurred, offset down-right like the panel light) */}
          <ellipse cx={C + 1} cy={C + 4} rx={D + 3} ry={D + 2} fill={`url(#ash-${uid})`} filter={`url(#ablur-${uid})`} />

          {/* machined bezel + anodized sheen */}
          <circle cx={C} cy={C} r={D + 3.5} fill={`url(#aring-${uid})`} stroke="#000" strokeOpacity="0.65" strokeWidth="0.9" />
          <circle cx={C} cy={C} r={D + 3.5} fill="none" stroke={`url(#asheen-${uid})`} strokeWidth="2.4" />
          {/* knurled grip: fine teeth cut into the bezel edge */}
          <circle
            cx={C} cy={C} r={D + 2.2} fill="none"
            stroke="#000" strokeOpacity="0.55" strokeWidth="2.6"
            strokeDasharray="1.1 1.55"
          />
          <circle
            cx={C} cy={C} r={D + 2.2} fill="none"
            stroke="#8a8a92" strokeOpacity="0.28" strokeWidth="1"
            strokeDasharray="1.1 1.55" strokeDashoffset="0.55"
          />
          {/* inner collar between grip and face */}
          <circle cx={C} cy={C} r={D + 0.8} fill="none" stroke="#000" strokeOpacity="0.8" strokeWidth="1.2" />
          <circle cx={C} cy={C} r={D + 0.2} fill="none" stroke="#fff" strokeOpacity="0.07" strokeWidth="0.6" />

          {/* domed matte face */}
          <circle cx={C} cy={C} r={D} fill={`url(#aface-${uid})`} stroke="#000" strokeOpacity="0.7" strokeWidth="0.6" />
          {/* concentric machining rings on the face */}
          {[0.82, 0.62, 0.42].map((k) => (
            <circle
              key={k} cx={C} cy={C} r={D * k} fill="none"
              stroke="#fff" strokeOpacity="0.035" strokeWidth="0.7"
            />
          ))}
          {[0.72, 0.52].map((k) => (
            <circle
              key={k} cx={C} cy={C} r={D * k} fill="none"
              stroke="#000" strokeOpacity="0.25" strokeWidth="0.5"
            />
          ))}
          {/* soft specular blob (upper-left light) + crisp rim catch-light */}
          <ellipse cx={C - D * 0.34} cy={C - D * 0.42} rx={D * 0.55} ry={D * 0.38} fill={`url(#aspec-${uid})`} />
          <path
            d={`M ${C - D * 0.72} ${C - D * 0.60} A ${D * 0.94} ${D * 0.94} 0 0 1 ${C + D * 0.55} ${C - D * 0.74}`}
            fill="none" stroke="#fff" strokeOpacity="0.16" strokeWidth="1.2" strokeLinecap="round"
          />
          {/* bottom bounce light off the panel */}
          <path
            d={`M ${C - D * 0.55} ${C + D * 0.74} A ${D * 0.92} ${D * 0.92} 0 0 0 ${C + D * 0.55} ${C + D * 0.74}`}
            fill="none" stroke="#fff" strokeOpacity="0.05" strokeWidth="1" strokeLinecap="round"
          />
          {/* engraved indicator — a groove CUT into the face with cream paint fill.
              The inset illusion needs screen-space lighting (upper-left light →
              lit lower-right edge, shadowed upper-left wall), so the endpoints are
              computed directly instead of rotate()d: with a rotated group the
              highlight would spin with the knob and read as a painted-on decal. */}
          {(() => {
            const a = ((START + frac * SWEEP) * Math.PI) / 180
            const ux = Math.sin(a), uy = -Math.cos(a)
            const x1 = C + 5 * ux, y1 = C + 5 * uy
            const x2 = C + (D - 2.5) * ux, y2 = C + (D - 2.5) * uy
            return (
              <g>
                {/* lit far edge: bright rim on the lower-right of the cut */}
                <line x1={x1 + 0.8} y1={y1 + 0.8} x2={x2 + 0.8} y2={y2 + 0.8}
                  stroke="#fff" strokeOpacity="0.28" strokeWidth="1.8" strokeLinecap="round" />
                {/* shadowed near wall: upper-left edge of the cut */}
                <line x1={x1 - 0.5} y1={y1 - 0.5} x2={x2 - 0.5} y2={y2 - 0.5}
                  stroke="#000" strokeOpacity="0.9" strokeWidth="1.6" strokeLinecap="round" />
                {/* groove floor */}
                <line x1={x1} y1={y1} x2={x2} y2={y2}
                  stroke="#060608" strokeWidth="2.2" strokeLinecap="round" />
                {/* cream paint sitting DOWN IN the groove: narrower than the cut,
                    dimmer than a surface line, its own top-left micro-shadow */}
                <line x1={x1 + 0.15} y1={y1 + 0.15} x2={x2 + 0.15} y2={y2 + 0.15}
                  stroke="#d8d0c0" strokeOpacity="0.92" strokeWidth="1.05" strokeLinecap="round" />
                <line x1={x1 - 0.15} y1={y1 - 0.15} x2={x2 - 0.15} y2={y2 - 0.15}
                  stroke="#000" strokeOpacity="0.22" strokeWidth="1.05" strokeLinecap="round" />
              </g>
            )
          })()}
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
