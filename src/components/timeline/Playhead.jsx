import { useProjectStore } from '../../stores/projectStore'
import { timeToPx } from '../../utils/timeFormat'

const LABEL_WIDTH = 140

export default function Playhead({ mode = 'full', totalHeight = 0, rulerHeight = 28 }) {
  const playheadTime = useProjectStore(s => s.playheadTime)
  const zoom = useProjectStore(s => s.zoom)
  const setPlayheadTime = useProjectStore(s => s.setPlayheadTime)
  const x = timeToPx(playheadTime, zoom)

  const onMouseDown = (e) => {
    e.preventDefault()
    e.stopPropagation()

    const container = e.currentTarget.closest('[data-timeline-content]')
    if (!container) return
    const rect = container.getBoundingClientRect()

    const onMove = (e) => {
      const x = e.clientX - rect.left + container.scrollLeft - LABEL_WIDTH
      setPlayheadTime(x / zoom)
    }
    const onUp = () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }

  // Handle only — rendered inside the ruler
  if (mode === 'handle') {
    return (
      <div
        className="absolute top-0 z-30 pointer-events-none"
        style={{ left: x, height: rulerHeight }}
      >
        <div
          className="pointer-events-auto cursor-ew-resize absolute"
          style={{ top: 0, transform: 'translateX(-50%)' }}
          onMouseDown={onMouseDown}
        >
          <div
            className="flex items-center justify-center bg-[#6d5efc] rounded-b-[3px]"
            style={{ width: 14, height: 18 }}
          >
            <div className="flex flex-col gap-[2px]">
              <div className="w-[6px] h-[1px] bg-white/50 rounded" />
              <div className="w-[6px] h-[1px] bg-white/50 rounded" />
            </div>
          </div>
        </div>
        {/* Short line through remaining ruler height */}
        <div
          className="absolute bg-[#6d5efc]"
          style={{ width: 1, top: 18, height: rulerHeight - 18, left: -0.5 }}
        />
      </div>
    )
  }

  // Line only — rendered spanning tracks
  if (mode === 'line') {
    return (
      <div
        className="absolute top-0 z-20 pointer-events-none"
        style={{ left: x, height: totalHeight }}
      >
        <div
          className="bg-[#6d5efc]"
          style={{ width: 1, height: totalHeight, marginLeft: -0.5, opacity: 0.9 }}
        />
      </div>
    )
  }

  return null
}
