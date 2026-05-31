import { useEffect, useRef, useState } from 'react'
import { useProjectStore } from '../../stores/projectStore'

// ── Constants used by widgets ────────────────────────────────────────────────

export const FILTER_DEFS = [
  { id: 'none',    label: '無',   css: '' },
  { id: 'vintage', label: '復古', css: 'sepia(0.5) contrast(1.1) brightness(0.88)' },
  { id: 'cool',    label: '冷色', css: 'hue-rotate(190deg) saturate(1.3) brightness(1.05)' },
  { id: 'warm',    label: '暖色', css: 'hue-rotate(-20deg) saturate(1.3) brightness(1.05)' },
  { id: 'bw',      label: '黑白', css: 'grayscale(1)' },
  { id: 'glow',    label: '光暈', css: 'brightness(1.5) saturate(0.6) contrast(0.85)' },
]

export const ANIM_IN_DEFS = [
  { id: 'none',       label: '無',   icon: '✕' },
  { id: 'fade-in',    label: '淡入', icon: '◐' },
  { id: 'slide-up',   label: '上滑', icon: '↑' },
  { id: 'slide-left', label: '左滑', icon: '←' },
  { id: 'typewriter', label: '打字', icon: 'Aa' },
]

export const ANIM_OUT_DEFS = [
  { id: 'none',       label: '無',   icon: '✕' },
  { id: 'fade-out',   label: '淡出', icon: '◑' },
  { id: 'slide-down', label: '下滑', icon: '↓' },
]

export const POSITION_PRESETS_X = ['center', 'left', 'right', '10%', '50%', '90%']
export const POSITION_PRESETS_Y = ['10%', '25%', '50%', '75%', '82%', '90%']

export const FONT_FAMILIES = [
  { id: '"Noto Sans TC", sans-serif',   label: 'Noto Sans TC' },
  { id: '"Noto Serif TC", serif',       label: 'Noto Serif TC' },
  { id: 'Inter, sans-serif',            label: 'Inter' },
  { id: 'Arial, sans-serif',            label: 'Arial' },
  { id: '"Helvetica Neue", sans-serif', label: 'Helvetica Neue' },
  { id: '"Microsoft JhengHei", sans-serif', label: '微軟正黑體' },
  { id: '"PingFang TC", sans-serif',    label: '蘋方-繁' },
  { id: '"Source Han Sans TC", sans-serif', label: '思源黑體' },
  { id: '"Source Han Serif TC", serif',  label: '思源宋體' },
  { id: 'Georgia, serif',               label: 'Georgia' },
  { id: '"Courier New", monospace',      label: 'Courier New' },
  { id: '"Comic Sans MS", cursive',     label: 'Comic Sans' },
]

const EASING_LABELS = { linear: 'L', 'ease-in': 'EI', 'ease-out': 'EO', 'ease-in-out': 'EIO' }

// ── Layout primitives ────────────────────────────────────────────────────────

export function Section({ title, children }) {
  return (
    <div>
      <div className="text-[10px] text-[#555] uppercase tracking-widest mb-2 pb-1 border-b border-[#222]">{title}</div>
      <div className="space-y-2">{children}</div>
    </div>
  )
}

export function Row({ label, children }) {
  return (
    <div className="flex items-center gap-2 min-h-[24px]">
      <span className="text-[11px] text-[#666] w-16 shrink-0 text-right pr-1">{label}</span>
      <div className="flex items-center gap-1 flex-1 flex-wrap">{children}</div>
    </div>
  )
}

export function Unit({ children }) {
  return <span className="text-[10px] text-[#555]">{children}</span>
}

export function Mono({ children }) {
  return <span className="text-[11px] text-[#888] font-mono truncate">{children}</span>
}

// ── Form widgets ─────────────────────────────────────────────────────────────

export function NumInput({ value, step = 1, min, max, onChange }) {
  return (
    <input type="number" value={value} step={step} min={min} max={max}
      onFocus={() => useProjectStore.getState().pushUndo()}
      onChange={e => onChange(e.target.value)}
      className="w-20 bg-[#111] border border-[#333] rounded px-2 py-0.5 text-xs text-gray-300 font-mono focus:outline-none focus:border-[#6d5efc]"
    />
  )
}

export function DatalistInput({ value, list, onChange }) {
  const id = 'dl-' + list[0]
  return (
    <>
      <input list={id} value={value}
        onFocus={() => useProjectStore.getState().pushUndo()}
        onChange={e => onChange(e.target.value)}
        className="flex-1 bg-[#111] border border-[#333] rounded px-2 py-0.5 text-xs text-gray-300 focus:outline-none focus:border-[#6d5efc]"
      />
      <datalist id={id}>{list.map(o => <option key={o} value={o} />)}</datalist>
    </>
  )
}

export function Select({ value, options, onChange }) {
  return (
    <select value={value} onChange={e => { useProjectStore.getState().pushUndo(); onChange(e.target.value) }}
      className="flex-1 bg-[#111] border border-[#333] rounded px-2 py-0.5 text-xs text-gray-300 focus:outline-none"
    >
      {options.map(o => <option key={o} value={o}>{o}</option>)}
    </select>
  )
}

export function ColorPicker({ value, onChange }) {
  return (
    <label className="flex items-center gap-1.5 cursor-pointer">
      <input type="color" value={value}
        onFocus={() => useProjectStore.getState().pushUndo()}
        onChange={e => onChange(e.target.value)}
        className="w-8 h-6 rounded border-0 cursor-pointer bg-transparent"
      />
      <span className="text-[10px] text-[#555] font-mono">{value}</span>
    </label>
  )
}

export function Toggle({ checked, onChange }) {
  return (
    <button
      onClick={() => { useProjectStore.getState().pushUndo(); onChange(!checked) }}
      style={{ backgroundColor: checked ? '#6d5efc' : '#333' }}
      className="w-9 h-5 rounded-full relative overflow-hidden transition-colors"
    >
      <span
        className="absolute top-0.5 w-4 h-4 bg-white rounded-full shadow"
        style={{ left: checked ? '19px' : '2px', transition: 'left 150ms' }}
      />
    </button>
  )
}

// ── Specialized grids ────────────────────────────────────────────────────────

export function FilterGrid({ value, onChange }) {
  const BG = 'linear-gradient(135deg, #e06c75 0%, #e5c07b 40%, #56b6c2 100%)'
  return (
    <div className="grid grid-cols-5 gap-1 mb-2">
      {FILTER_DEFS.map(f => (
        <button
          key={f.id}
          onClick={() => onChange(f.id)}
          className={`flex flex-col items-center gap-0.5 rounded border p-0.5 transition-colors ${
            value === f.id ? 'border-[#6d5efc]' : 'border-[#2a2a2a] hover:border-[#555]'
          }`}
        >
          <div
            className="w-full aspect-square rounded"
            style={{ background: BG, filter: f.css || undefined }}
          />
          <span className={`text-[9px] leading-tight ${value === f.id ? 'text-[#6d5efc]' : 'text-[#666]'}`}>{f.label}</span>
        </button>
      ))}
    </div>
  )
}

export function AnimGrid({ defs, value, onChange }) {
  return (
    <div className="grid grid-cols-5 gap-1 mb-2">
      {defs.map(a => (
        <button
          key={a.id}
          onClick={() => onChange(a.id)}
          className={`flex flex-col items-center gap-0.5 rounded border p-1 transition-colors ${
            value === a.id ? 'border-[#6d5efc] bg-[#6d5efc]/10' : 'border-[#2a2a2a] hover:border-[#555]'
          }`}
        >
          <span className={`text-sm font-bold leading-tight ${value === a.id ? 'text-[#6d5efc]' : 'text-[#666]'}`}>{a.icon}</span>
          <span className={`text-[9px] leading-tight ${value === a.id ? 'text-[#6d5efc]' : 'text-[#666]'}`}>{a.label}</span>
        </button>
      ))}
    </div>
  )
}

export function FontSelect({ value, onChange }) {
  return (
    <select
      value={value}
      onChange={e => onChange(e.target.value)}
      className="flex-1 bg-[#111] border border-[#333] rounded px-2 py-0.5 text-xs text-gray-300 focus:outline-none focus:border-[#6d5efc]"
    >
      {FONT_FAMILIES.map(f => (
        <option key={f.id} value={f.id} style={{ fontFamily: f.id }}>{f.label}</option>
      ))}
    </select>
  )
}

// ── Keyframe editor (used by both video opacity + audio volume) ──────────────

export function KeyframeEditor({ keyframes, clipStart, clipEnd, playheadTime, valueMin, valueMax, valueStep, valueLabel, defaultValue, onChange }) {
  const clipDur = Math.max(0.01, clipEnd - clipStart)
  const clipRelTime = Math.max(0, Math.min(clipDur, playheadTime - clipStart))
  const sorted = [...keyframes].sort((a, b) => a.time - b.time)

  const addKF = () => {
    useProjectStore.getState().pushUndo()
    const alreadyExists = sorted.some(k => Math.abs(k.time - clipRelTime) < 0.05)
    if (alreadyExists) return
    onChange([...sorted, { time: +clipRelTime.toFixed(3), value: defaultValue, easing: 'ease-in-out' }])
  }

  const removeKF = (idx) => {
    useProjectStore.getState().pushUndo()
    onChange(sorted.filter((_, i) => i !== idx))
  }

  const updateKF = (idx, patch) => {
    const next = sorted.map((k, i) => i === idx ? { ...k, ...patch } : k)
    onChange(next)
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <button
          onClick={addKF}
          className="flex-1 text-[10px] py-1 rounded border border-[#6d5efc]/60 text-[#6d5efc] hover:bg-[#6d5efc]/10 transition-colors"
        >
          ◆ 在 {clipRelTime.toFixed(2)}s 新增關鍵幀
        </button>
      </div>
      {sorted.length === 0 ? (
        <div className="text-[10px] text-[#444] text-center py-1">尚無關鍵幀</div>
      ) : (
        <div className="space-y-1">
          {sorted.map((kf, i) => (
            <div key={i} className="flex items-center gap-1 bg-[#111] rounded px-2 py-1">
              <span className="text-[10px] text-[#555] w-10 font-mono shrink-0">{kf.time.toFixed(2)}s</span>
              <input
                type="range" value={kf.value} min={valueMin} max={valueMax} step={valueStep}
                onChange={e => updateKF(i, { value: +e.target.value })}
                className="flex-1 h-1 accent-[#6d5efc] cursor-pointer"
              />
              <input
                type="number" value={kf.value} min={valueMin} max={valueMax} step={valueStep}
                onChange={e => updateKF(i, { value: Math.max(valueMin, Math.min(valueMax, +e.target.value)) })}
                className="w-12 bg-[#1a1a1a] border border-[#333] rounded px-1 py-0.5 text-[10px] text-gray-300 font-mono text-center focus:outline-none focus:border-[#6d5efc]"
              />
              <select
                value={kf.easing ?? 'linear'}
                onChange={e => updateKF(i, { easing: e.target.value })}
                className="bg-[#1a1a1a] border border-[#333] rounded px-1 py-0.5 text-[10px] text-[#888] focus:outline-none w-14"
              >
                {Object.entries(EASING_LABELS).map(([id, label]) => (
                  <option key={id} value={id}>{label}</option>
                ))}
              </select>
              <button onClick={() => removeKF(i)} className="text-[10px] text-[#444] hover:text-red-400 px-1">✕</button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ── Timeline-style keyframe track ────────────────────────────────────────────
// Mini-timeline lane that mirrors the main timeline's playhead/time axis.
// - Click empty track            → add KF at clicked time
// - Drag marker                  → re-time the KF (snap to 0.05s)
// - Click marker                 → select; value/easing editor appears below
// - ✕ on selected                → delete
//
// Keyframe values are stored as numeric (canvas fractions for xKF/yKF) but
// the UI shows them as percentages (×100) when valueAsPercent is true.

const SNAP = 0.05

export function TimelineKeyframeTrack({
  keyframes, clipStart, clipEnd, playheadTime,
  valueMin, valueMax, valueStep,
  defaultValue, label, valueAsPercent = false,
  onChange,
}) {
  const trackRef = useRef(null)
  const [selectedIdx, setSelectedIdx] = useState(null)
  const [dragIdx, setDragIdx] = useState(null)

  const clipDur = Math.max(0.01, clipEnd - clipStart)
  const clipRelPlayhead = Math.max(0, Math.min(clipDur, playheadTime - clipStart))
  const sorted = [...keyframes].sort((a, b) => a.time - b.time)

  const timeToPct = (t) => `${(t / clipDur) * 100}%`
  const clientXToTime = (clientX) => {
    const rect = trackRef.current?.getBoundingClientRect()
    if (!rect) return 0
    const rel = (clientX - rect.left) / rect.width
    const t = Math.max(0, Math.min(clipDur, rel * clipDur))
    return Math.round(t / SNAP) * SNAP
  }

  const addAt = (t) => {
    useProjectStore.getState().pushUndo()
    if (sorted.some(k => Math.abs(k.time - t) < SNAP / 2)) return
    onChange([...sorted, { time: +t.toFixed(3), value: defaultValue, easing: 'ease-in-out' }])
  }

  const updateKF = (idx, patch) => {
    onChange(sorted.map((k, i) => i === idx ? { ...k, ...patch } : k))
  }

  const removeKF = (idx) => {
    useProjectStore.getState().pushUndo()
    onChange(sorted.filter((_, i) => i !== idx))
    setSelectedIdx(null)
  }

  // Drag — bind window-level listeners while dragging a marker.
  useEffect(() => {
    if (dragIdx == null) return
    const onMove = (e) => {
      const t = clientXToTime(e.clientX)
      updateKF(dragIdx, { time: +t.toFixed(3) })
    }
    const onUp = () => setDragIdx(null)
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
    return () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
  }, [dragIdx, sorted])  // eslint-disable-line react-hooks/exhaustive-deps

  const onTrackClick = (e) => {
    // Ignore clicks while dragging; the click after mouseup would otherwise
    // add a stray KF where the marker was released.
    if (dragIdx != null) return
    // Don't add if user clicked on a marker (marker has its own handler with
    // stopPropagation, but covering edge cases).
    if (e.target?.dataset?.kfMarker) return
    addAt(clientXToTime(e.clientX))
  }

  const fmtValue = (v) => valueAsPercent ? `${(v * 100).toFixed(0)}%` : v.toFixed(2)
  const sel = selectedIdx != null ? sorted[selectedIdx] : null

  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between text-[10px] text-[#888]">
        <span>{label}</span>
        <button
          onClick={() => addAt(clipRelPlayhead)}
          className="text-[#6d5efc] hover:text-[#ff5c75] px-1.5 py-0.5 rounded border border-[#6d5efc]/40 hover:border-[#6d5efc] transition-colors"
          title={`在 ${clipRelPlayhead.toFixed(2)}s（playhead）新增關鍵幀`}
        >＋ {clipRelPlayhead.toFixed(2)}s</button>
      </div>
      <div
        ref={trackRef}
        onMouseDown={onTrackClick}
        className="relative h-7 bg-[#0a0a0a] border border-[#252525] rounded cursor-crosshair select-none"
      >
        {/* Playhead vertical line */}
        <div
          className="absolute top-0 bottom-0 w-px bg-[#6d5efc]/70 pointer-events-none"
          style={{ left: timeToPct(clipRelPlayhead) }}
        />
        {/* KF markers */}
        {sorted.map((kf, i) => (
          <div
            key={i}
            data-kf-marker="1"
            onMouseDown={(e) => {
              e.stopPropagation()
              setSelectedIdx(i)
              setDragIdx(i)
            }}
            className={`absolute top-1/2 w-3 h-3 rotate-45 border cursor-grab ${
              selectedIdx === i
                ? 'bg-[#6d5efc] border-[#fff]'
                : 'bg-[#a855f7] border-[#1a1a1a] hover:bg-[#c084fc]'
            }`}
            style={{
              left: timeToPct(kf.time),
              transform: 'translate(-50%, -50%) rotate(45deg)',
            }}
            title={`${kf.time.toFixed(2)}s · ${fmtValue(kf.value)}`}
          />
        ))}
      </div>
      <div className="flex items-center justify-between text-[8px] text-[#444] font-mono">
        <span>0s</span>
        <span>{clipDur.toFixed(1)}s</span>
      </div>
      {sel && (
        <div className="flex items-center gap-1 bg-[#111] rounded px-2 py-1.5">
          <span className="text-[9px] text-[#888] w-10 font-mono shrink-0">{sel.time.toFixed(2)}s</span>
          <input
            type="range" value={sel.value} min={valueMin} max={valueMax} step={valueStep}
            onChange={e => updateKF(selectedIdx, { value: +e.target.value })}
            className="flex-1 h-1 accent-[#6d5efc] cursor-pointer"
          />
          <span className="text-[9px] text-[#aaa] w-10 font-mono text-right shrink-0">{fmtValue(sel.value)}</span>
          <select
            value={sel.easing ?? 'linear'}
            onChange={e => updateKF(selectedIdx, { easing: e.target.value })}
            className="bg-[#1a1a1a] border border-[#333] rounded px-1 py-0.5 text-[9px] text-[#888] focus:outline-none w-12"
          >
            {Object.entries(EASING_LABELS).map(([id, lbl]) => (
              <option key={id} value={id}>{lbl}</option>
            ))}
          </select>
          <button onClick={() => removeKF(selectedIdx)} className="text-[10px] text-[#444] hover:text-red-400 px-1">✕</button>
        </div>
      )}
    </div>
  )
}
