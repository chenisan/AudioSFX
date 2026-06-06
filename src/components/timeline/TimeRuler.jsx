import { useMemo, memo } from 'react'
import { useProjectStore } from '../../stores/projectStore'
import { useShallow } from 'zustand/react/shallow'
import { timeToPx } from '../../utils/timeFormat'

const TRACK_LABEL_W = 80

export default memo(function TimeRuler() {
  // Narrowed from `s => s.project` so a clip rename (which mutates project.id
  // identity but not duration/tracks) doesn't bust the ticks useMemo and
  // re-render up to 1500 tick divs. tracks subscription uses useShallow so
  // adding/removing a track flips identity but a clip move on one track
  // doesn't re-trigger contentEnd recompute unless the actual end-times
  // shifted (the .reduce below depends on c.end values, not refs).
  const projectDuration = useProjectStore(s => s.project?.duration ?? 0)
  const tracks = useProjectStore(useShallow(s => s.project?.timeline?.tracks ?? []))
  const zoom = useProjectStore(s => s.zoom)
  const setPlayheadTime = useProjectStore(s => s.setPlayheadTime)
  if (!projectDuration && tracks.length === 0) return null

  // Use content end if it exceeds project.duration
  const contentEnd = tracks.reduce((max, t) => {
    for (const c of (t.clips ?? [])) { if (c.end > max) max = c.end }
    return max
  }, 0)
  const duration = Math.max(projectDuration, contentEnd + 10)
  const totalWidth = timeToPx(duration, zoom)

  // Major tick interval (labelled)
  const majorInterval = zoom >= 100 ? 1 : zoom >= 40 ? 1 : zoom >= 20 ? 2 : 5
  // Sub-tick interval (smaller marks between majors)
  const subInterval = zoom >= 100 ? 0.2 : zoom >= 40 ? 0.5 : zoom >= 20 ? 1 : 1

  // eslint-disable-next-line react-hooks/exhaustive-deps
  const ticks = useMemo(() => {
    const arr = []
    for (let t = 0; t <= duration; t = Math.round((t + subInterval) * 100) / 100) {
      const isMajor = Math.abs(t - Math.round(t / majorInterval) * majorInterval) < 0.001
      arr.push({ t, isMajor })
    }
    return arr
  }, [duration, subInterval, majorInterval])

  const handleClick = (e) => {
    const rect = e.currentTarget.getBoundingClientRect()
    setPlayheadTime((e.clientX - rect.left) / zoom)
  }

  return (
    <div
      className="relative select-none cursor-pointer bg-gradient-to-b from-[#1d1d20] to-[#161618]"
      style={{ width: totalWidth, height: 32, minWidth: '100%' }}
      onClick={handleClick}
    >
      {ticks.map(({ t, isMajor }) => {
        const x = timeToPx(t, zoom)
        // Three-level hierarchy: minute (indigo, tallest) > second/major
        // (bright, medium) > sub-tick (dim, short). Ticks are bottom-aligned so
        // labels sit cleanly in the top band.
        const isMinute = t > 0 && Math.abs(t % 60) < 0.001
        const tickH = isMinute ? 20 : isMajor ? 13 : 6
        const tickColor = isMinute ? 'bg-[#6d5efc]' : isMajor ? 'bg-[#6f6f78]' : 'bg-[#393940]'
        return (
          <div key={t} className="absolute top-0 bottom-0" style={{ left: x }}>
            {/* Tick — grows up from the baseline */}
            <div className={`absolute bottom-0 w-px ${tickColor}`} style={{ height: tickH }} />
            {/* Label in the top band */}
            {isMajor && t > 0 && (
              <span
                className={`absolute top-[3px] left-1 font-mono text-[10px] whitespace-nowrap tabular-nums tracking-tight ${
                  isMinute ? 'text-[#9b8dff] font-semibold' : 'text-[#aaabb2]'
                }`}
              >
                {formatRulerLabel(t)}
              </span>
            )}
          </div>
        )
      })}
      {/* Baseline */}
      <div className="absolute left-0 right-0 bottom-0 h-px bg-[#000]/50" />
    </div>
  )
})

function formatRulerLabel(t) {
  const m = Math.floor(t / 60)
  const s = Math.floor(t % 60)
  if (m > 0) {
    return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
  }
  return `00:${String(s).padStart(2, '0')}`
}
