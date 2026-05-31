const SNAP_THRESHOLD_PX = 8

/**
 * Given a candidate time and a list of snap points (in seconds),
 * return the snapped time if within threshold, else the original.
 */
export function snapToPoints(candidateTime, snapPoints, zoom) {
  const candidatePx = candidateTime * zoom
  for (const point of snapPoints) {
    const pointPx = point * zoom
    if (Math.abs(candidatePx - pointPx) <= SNAP_THRESHOLD_PX) {
      return { time: point, snapped: true }
    }
  }
  return { time: candidateTime, snapped: false }
}

/**
 * Collect all clip edge times from the timeline as snap points.
 * Also includes 0 and duration.
 */
export function collectSnapPoints(timeline, duration, excludeTrack = null, excludeIndex = null) {
  const points = new Set([0, duration])

  for (const track of (timeline.tracks ?? [])) {
    track.clips.forEach((clip, i) => {
      if (track.id === excludeTrack && i === excludeIndex) return
      points.add(clip.start)
      points.add(clip.end)
    })
  }

  return [...points].sort((a, b) => a - b)
}
