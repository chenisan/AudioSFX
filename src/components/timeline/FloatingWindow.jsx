import { useRef, useState, useCallback, useEffect } from 'react'

// Generic draggable floating window. Title bar drags; X closes.
//
// Sizing:
//   - default: content-sized (pass `width`; height follows children, capped at
//     70vh with scroll). Good for compact param panels (EQ / dynamics).
//   - `height` set: fixed body height; children get a full-height box (no inner
//     padding) so a `h-full` flex child like SfxPanel can fill + scroll itself.
//
// Position: local/session state by default. Pass `storageKey` to persist {x,y}
// to localStorage (e.g. the Header-toggled SFX window remembers where you put it).

const MARGIN = 8

function clampPos(x, y, w, h) {
  const vw = window.innerWidth, vh = window.innerHeight
  return {
    x: Math.min(Math.max(0, x), Math.max(0, vw - w)),
    y: Math.min(Math.max(0, y), Math.max(0, vh - h)),
  }
}

export default function FloatingWindow({ title, onClose, children, width = 320, height, initialX, initialY, storageKey }) {
  const ref = useRef(null)
  const [pos, setPos] = useState(() => {
    if (storageKey) {
      try {
        const s = JSON.parse(localStorage.getItem(storageKey + '.pos') || 'null')
        if (s && Number.isFinite(s.x) && Number.isFinite(s.y)) return s
      } catch {}
    }
    return {
      x: initialX ?? Math.max(MARGIN, (window.innerWidth - width) / 2),
      y: initialY ?? 120,
    }
  })
  const dragRef = useRef(null)  // { sx, sy, ox, oy }

  const onMove = useCallback((e) => {
    const d = dragRef.current
    if (!d) return
    const h = ref.current?.offsetHeight ?? 0
    setPos(clampPos(d.ox + (e.clientX - d.sx), d.oy + (e.clientY - d.sy), width, h))
  }, [width])

  const onUp = useCallback(() => {
    if (!dragRef.current) return
    dragRef.current = null
    window.removeEventListener('pointermove', onMove)
    window.removeEventListener('pointerup', onUp)
    if (storageKey) {
      setPos(p => { try { localStorage.setItem(storageKey + '.pos', JSON.stringify(p)) } catch {} ; return p })
    }
  }, [onMove, storageKey])

  const onDown = (e) => {
    e.preventDefault()
    dragRef.current = { sx: e.clientX, sy: e.clientY, ox: pos.x, oy: pos.y }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
  }

  // Clamp once after first layout (initial pos may be partly off-screen), and
  // detach listeners on unmount (without persisting — persist only on drag end).
  useEffect(() => {
    const h = ref.current?.offsetHeight ?? 0
    setPos(p => clampPos(p.x, p.y, width, h))
    return () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
    }
  }, [width, onMove, onUp])

  return (
    <div
      ref={ref}
      className="fixed z-[60] flex flex-col bg-[#1a1a1a] border border-[#3a3a3a] rounded-lg shadow-2xl"
      style={{ left: pos.x, top: pos.y, width }}
    >
      <div
        onPointerDown={onDown}
        className="flex items-center justify-between px-2.5 h-7 shrink-0 bg-[#222] border-b border-[#000]/40 rounded-t-lg cursor-move select-none"
      >
        <span className="text-[11px] font-medium text-[#ccc] tracking-wide truncate">{title}</span>
        <button
          onPointerDown={e => e.stopPropagation()}
          onClick={onClose}
          className="text-[#666] hover:text-white text-base leading-none w-5 h-5 flex items-center justify-center shrink-0"
          title="關閉"
        >×</button>
      </div>
      {height != null ? (
        <div className="overflow-hidden rounded-b-lg" style={{ height }}>{children}</div>
      ) : (
        <div className="p-2 overflow-y-auto max-h-[70vh]">{children}</div>
      )}
    </div>
  )
}
