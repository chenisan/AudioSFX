import { useRef, useCallback } from 'react'

/**
 * A draggable divider for resizing panels.
 * direction: 'horizontal' (drag left/right) | 'vertical' (drag up/down)
 */
export default function Resizer({ direction = 'horizontal', onResize }) {
  const dragging = useRef(false)

  const onMouseDown = useCallback((e) => {
    e.preventDefault()
    dragging.current = true

    const startPos = direction === 'horizontal' ? e.clientX : e.clientY
    document.body.style.cursor = direction === 'horizontal' ? 'col-resize' : 'row-resize'
    document.body.style.userSelect = 'none'

    const onMouseMove = (e) => {
      if (!dragging.current) return
      const currentPos = direction === 'horizontal' ? e.clientX : e.clientY
      const delta = currentPos - startPos
      onResize(delta, currentPos)
    }

    const onMouseUp = () => {
      dragging.current = false
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
      window.removeEventListener('mousemove', onMouseMove)
      window.removeEventListener('mouseup', onMouseUp)
    }

    window.addEventListener('mousemove', onMouseMove)
    window.addEventListener('mouseup', onMouseUp)
  }, [direction, onResize])

  const isH = direction === 'horizontal'

  return (
    <div
      onMouseDown={onMouseDown}
      className={`shrink-0 ${isH ? 'w-1 cursor-col-resize hover:bg-[#6d5efc]/40' : 'h-1 cursor-row-resize hover:bg-[#6d5efc]/40'} bg-[#2a2a2a] transition-colors active:bg-[#6d5efc]/60`}
    />
  )
}
