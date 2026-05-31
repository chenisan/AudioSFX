import { useCallback } from 'react'
import { useProjectStore } from '../../stores/projectStore'
import { pxToTime, timeToPx } from '../../utils/timeFormat'

/**
 * Draggable In/Out handles on the timeline ruler. Renders inside the ruler's
 * relative-positioned flex container (which has `overflow-hidden`).
 *
 * Default range = [0, contentEnd]. User-dragged range overrides via
 * project.exportRange. Reset by clicking the × on either handle's tooltip.
 */
export default function ExportRangeBar({ contentEnd, rulerHeight }) {
  // Narrow `s => s.project` to just the export range — drops re-renders on
  // every clip mutation. Triple-equality on the object reference is fine
  // because setExportRange creates a new object on each mutation.
  const range = useProjectStore(s => s.project?.exportRange ?? null)
  const zoom = useProjectStore(s => s.zoom)
  const setExportRange = useProjectStore(s => s.setExportRange)

  const inSec = range?.in ?? 0
  const outSec = range?.out ?? contentEnd

  const startDrag = useCallback((which) => (e) => {
    e.preventDefault()
    e.stopPropagation()
    const startX = e.clientX
    const startTime = which === 'in' ? inSec : outSec
    const otherTime = which === 'in' ? outSec : inSec

    const onMove = (ev) => {
      const dx = ev.clientX - startX
      const dt = pxToTime(dx, zoom)
      let t = startTime + dt
      // Clamp: keep at least 0.5s gap between handles
      if (which === 'in')  t = Math.max(0, Math.min(otherTime - 0.5, t))
      else                  t = Math.max(otherTime + 0.5, Math.min(contentEnd + 30, t))
      const next = which === 'in' ? { in: t, out: outSec } : { in: inSec, out: t }
      setExportRange(next)
    }
    const onUp = () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }, [inSec, outSec, zoom, contentEnd, setExportRange])

  const inPx = timeToPx(inSec, zoom)
  const outPx = timeToPx(outSec, zoom)

  return (
    <>
      {/* In handle */}
      <div
        className="absolute top-0 z-30 cursor-ew-resize group"
        style={{ left: inPx - 6, height: rulerHeight, width: 12 }}
        onMouseDown={startDrag('in')}
        title={`輸出起點 ${formatTime(inSec)}`}
      >
        <div className="absolute top-0 left-1/2 -translate-x-1/2 w-3 h-3 bg-white rotate-45 shadow-[0_0_6px_rgba(255,255,255,0.7)]" />
        <div className="absolute top-0 left-1/2 w-px bg-white/80" style={{ height: rulerHeight }} />
      </div>

      {/* Out handle */}
      <div
        className="absolute top-0 z-30 cursor-ew-resize group"
        style={{ left: outPx - 6, height: rulerHeight, width: 12 }}
        onMouseDown={startDrag('out')}
        title={`輸出終點 ${formatTime(outSec)}`}
      >
        <div className="absolute top-0 left-1/2 -translate-x-1/2 w-3 h-3 bg-white rotate-45 shadow-[0_0_6px_rgba(255,255,255,0.7)]" />
        <div className="absolute top-0 left-1/2 w-px bg-white/80" style={{ height: rulerHeight }} />
      </div>

      {/* Range bar between handles */}
      <div
        className="absolute top-0 bg-white/30 pointer-events-none"
        style={{ left: inPx, width: Math.max(0, outPx - inPx), height: 4 }}
      />
    </>
  )
}

/**
 * Mask overlay shown on the tracks area, dimming time outside the export
 * range. Rendered absolute inside the tracks container.
 */
export function ExportRangeMask({ contentEnd, tracksHeight }) {
  const range = useProjectStore(s => s.project?.exportRange ?? null)
  const zoom = useProjectStore(s => s.zoom)
  if (!range) return null  // no mask when range is default

  const inPx = timeToPx(range.in, zoom)
  const outPx = timeToPx(range.out, zoom)

  return (
    <>
      {/* Left mask (before In) */}
      {inPx > 0 && (
        <div
          className="absolute top-0 left-0 bg-black/50 pointer-events-none z-10"
          style={{ width: inPx, height: tracksHeight }}
        />
      )}
      {/* Right mask (after Out) */}
      <div
        className="absolute top-0 bg-black/50 pointer-events-none z-10"
        style={{ left: outPx, right: 0, height: tracksHeight }}
      />
    </>
  )
}

function formatTime(s) {
  const m = Math.floor(s / 60)
  const sec = Math.floor(s % 60)
  const cs = Math.floor((s - Math.floor(s)) * 100)
  return `${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}.${String(cs).padStart(2, '0')}`
}
