import { useRef, useState, useCallback, useEffect } from 'react'
import { useProjectStore } from '../../stores/projectStore'
import PreviewPanel from './PreviewPanel'

// Floating, draggable, resizable wrapper around PreviewPanel. Replaces the old
// docked preview in the left column — the left column is now all LeftPanel, and
// the video preview lives here as a movable window pinned over the app.
//
// Position/size live in editorUISlice.previewRect (localStorage). A local copy
// drives the gesture for smoothness; we commit to the store only on gesture end
// to avoid a localStorage write per pointermove.

const MIN_W = 200, MIN_H = 150
const DEFAULT_W = 280, DEFAULT_H = 460, MARGIN = 16

function makeDefaultRect() {
  const vw = window.innerWidth, vh = window.innerHeight
  return {
    x: Math.max(MARGIN, vw - DEFAULT_W - MARGIN),
    y: Math.max(MARGIN, vh - DEFAULT_H - MARGIN),
    w: DEFAULT_W,
    h: DEFAULT_H,
  }
}

function clampRect(r) {
  const vw = window.innerWidth, vh = window.innerHeight
  const w = Math.min(Math.max(MIN_W, r.w), vw)
  const h = Math.min(Math.max(MIN_H, r.h), vh)
  const x = Math.min(Math.max(0, r.x), Math.max(0, vw - w))
  const y = Math.min(Math.max(0, r.y), Math.max(0, vh - h))
  return { x, y, w, h }
}

export default function FloatingPreview() {
  const saved = useProjectStore(s => s.previewRect)
  const setPreviewRect = useProjectStore(s => s.setPreviewRect)
  const setPreviewOpen = useProjectStore(s => s.setPreviewOpen)

  const [rect, setRect] = useState(() => clampRect(saved ?? makeDefaultRect()))
  const dragRef = useRef(null)  // { mode: 'move' | 'resize', startX, startY, orig }

  // Re-clamp once on mount in case the saved rect is now off-screen (window
  // shrank since last session).
  useEffect(() => { setRect(r => clampRect(r)) }, [])

  const onPointerMove = useCallback((e) => {
    const d = dragRef.current
    if (!d) return
    const dx = e.clientX - d.startX, dy = e.clientY - d.startY
    if (d.mode === 'move') {
      setRect(clampRect({ ...d.orig, x: d.orig.x + dx, y: d.orig.y + dy }))
    } else {
      setRect(clampRect({ ...d.orig, w: d.orig.w + dx, h: d.orig.h + dy }))
    }
  }, [])

  const endGesture = useCallback(() => {
    if (!dragRef.current) return
    dragRef.current = null
    window.removeEventListener('pointermove', onPointerMove)
    window.removeEventListener('pointerup', endGesture)
    setRect(r => { setPreviewRect(r); return r })
  }, [onPointerMove, setPreviewRect])

  const startGesture = (mode) => (e) => {
    e.preventDefault()
    dragRef.current = { mode, startX: e.clientX, startY: e.clientY, orig: rect }
    window.addEventListener('pointermove', onPointerMove)
    window.addEventListener('pointerup', endGesture)
  }

  // Tidy up listeners if unmounted mid-gesture (e.g. window closed via X).
  useEffect(() => endGesture, [endGesture])

  return (
    <div
      className="fixed z-50 flex flex-col bg-[#0d0d0d] border border-[#333] rounded-lg shadow-2xl overflow-hidden"
      style={{ left: rect.x, top: rect.y, width: rect.w, height: rect.h }}
    >
      {/* Title bar — drag handle */}
      <div
        onPointerDown={startGesture('move')}
        className="flex items-center justify-between px-2 h-6 shrink-0 bg-[#1a1a1a] border-b border-[#2a2a2a] cursor-move select-none"
      >
        <span className="text-[10px] text-[#888] tracking-wide">預覽</span>
        <button
          onPointerDown={e => e.stopPropagation()}
          onClick={() => setPreviewOpen(false)}
          className="text-[#666] hover:text-white text-base leading-none w-4 h-4 flex items-center justify-center"
          title="關閉預覽（可從上方工具列「預覽」重新開啟）"
        >×</button>
      </div>

      {/* Preview body — PreviewPanel fills this and letterboxes via object-contain */}
      <div className="flex-1 min-h-0 overflow-hidden">
        <PreviewPanel />
      </div>

      {/* Resize handle (bottom-right corner) */}
      <div
        onPointerDown={startGesture('resize')}
        className="absolute bottom-0 right-0 w-4 h-4 cursor-nwse-resize flex items-end justify-end p-0.5"
        title="拖曳調整大小"
      >
        <svg width="12" height="12" viewBox="0 0 16 16" className="text-[#555]">
          <path d="M11 15 L15 11 M7 15 L15 7" stroke="currentColor" strokeWidth="1.5" fill="none" />
        </svg>
      </div>
    </div>
  )
}
