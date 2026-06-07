import { useRef, useState, useCallback, useEffect } from 'react'

// Generic draggable floating window. Title bar drags; X closes. Content-sized
// (pass a width; height follows children, capped at 70vh with scroll). Position
// is local/session state — dragged during use, not persisted. Used by the track
// FX editor to pop EQ / dynamics panels out of the inline insert list.

const MARGIN = 8

function clampPos(x, y, w, h) {
  const vw = window.innerWidth, vh = window.innerHeight
  return {
    x: Math.min(Math.max(0, x), Math.max(0, vw - w)),
    y: Math.min(Math.max(0, y), Math.max(0, vh - h)),
  }
}

export default function FloatingWindow({ title, onClose, children, width = 320, initialX, initialY }) {
  const ref = useRef(null)
  const [pos, setPos] = useState(() => ({
    x: initialX ?? Math.max(MARGIN, (window.innerWidth - width) / 2),
    y: initialY ?? 120,
  }))
  const dragRef = useRef(null)  // { sx, sy, ox, oy }

  const onMove = useCallback((e) => {
    const d = dragRef.current
    if (!d) return
    const h = ref.current?.offsetHeight ?? 0
    setPos(clampPos(d.ox + (e.clientX - d.sx), d.oy + (e.clientY - d.sy), width, h))
  }, [width])

  const onUp = useCallback(() => {
    dragRef.current = null
    window.removeEventListener('pointermove', onMove)
    window.removeEventListener('pointerup', onUp)
  }, [onMove])

  const onDown = (e) => {
    e.preventDefault()
    dragRef.current = { sx: e.clientX, sy: e.clientY, ox: pos.x, oy: pos.y }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
  }

  // Clamp once after first layout (in case the default/initial pos is partly
  // off-screen), and clean up listeners on unmount.
  useEffect(() => {
    const h = ref.current?.offsetHeight ?? 0
    setPos(p => clampPos(p.x, p.y, width, h))
    return onUp
  }, [width, onUp])

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
      <div className="p-2 overflow-y-auto max-h-[70vh]">
        {children}
      </div>
    </div>
  )
}
