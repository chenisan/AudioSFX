/**
 * Format seconds to MM:SS.x display
 */
export function formatTime(seconds) {
  const m = Math.floor(seconds / 60)
  const s = Math.floor(seconds % 60)
  const ds = Math.floor((seconds % 1) * 10)
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${ds}`
}

/**
 * Format seconds to HH:MM:SS:FF timecode (30fps)
 */
export function formatTimecode(seconds, fps = 30) {
  const abs = Math.max(0, seconds)
  const h = Math.floor(abs / 3600)
  const m = Math.floor((abs % 3600) / 60)
  const s = Math.floor(abs % 60)
  const f = Math.floor((abs % 1) * fps)
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}:${String(f).padStart(2, '0')}`
}

/**
 * Format seconds to MM:SS (no decimals)
 */
export function formatTimeShort(seconds) {
  const m = Math.floor(seconds / 60)
  const s = Math.floor(seconds % 60)
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
}

/**
 * Convert pixel offset to time (seconds)
 */
export function pxToTime(px, zoom) {
  return px / zoom
}

/**
 * Convert time (seconds) to pixel offset
 */
export function timeToPx(time, zoom) {
  return time * zoom
}
