import { useRef, useState, useEffect } from 'react'

// Right-click menu for an empty spot on a track (point menu, vs Clip's
// ClipContextMenu). Mirrors ClipContextMenu's look + viewport clamping, and
// self-closes on outside click or Esc. `items` keeps it generic so the menu
// can grow beyond the single "建立音效" action.
export default function PointContextMenu({ x, y, items, onClose }) {
  const menuRef = useRef(null)
  const [pos, setPos] = useState({ x, y })

  // Keep menu inside the viewport.
  useEffect(() => {
    if (!menuRef.current) return
    const rect = menuRef.current.getBoundingClientRect()
    const vw = window.innerWidth, vh = window.innerHeight
    setPos({
      x: x + rect.width > vw ? x - rect.width : x,
      y: y + rect.height > vh ? y - rect.height : y,
    })
  }, [x, y])

  // Outside-click / Esc dismiss.
  useEffect(() => {
    const onDown = (e) => { if (menuRef.current && !menuRef.current.contains(e.target)) onClose() }
    const onKey = (e) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [onClose])

  return (
    <div
      ref={menuRef}
      className="fixed bg-[#2a2a2a] border border-[#444] rounded-lg shadow-2xl z-[9999] py-1 min-w-[140px]"
      style={{ left: pos.x, top: pos.y }}
      onClick={e => e.stopPropagation()}
      onContextMenu={e => e.preventDefault()}
    >
      {items.map((item, i) =>
        item.divider ? (
          <div key={i} className="border-t border-[#3a3a3a] my-1" />
        ) : (
          <button
            key={i}
            onClick={item.action}
            className={`w-full flex items-center justify-between px-3 py-1.5 text-xs hover:bg-[#3a3a3a] ${item.danger ? 'text-red-400' : item.accent ? 'text-[#f97316]' : 'text-[#ccc]'}`}
          >
            <span>{item.label}</span>
          </button>
        )
      )}
    </div>
  )
}
