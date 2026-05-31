// Helpers for the motion-library UI to deep-link back to the original
// reference video and format timestamps. Used by MotionLibraryModal and
// MotionLibraryManager.

const YT_HOST_PATTERNS = [
  /^https?:\/\/(?:www\.|m\.)?youtube\.com\/watch\?[^#]*[?&]?v=([A-Za-z0-9_-]{11})/,
  /^https?:\/\/(?:www\.|m\.)?youtube\.com\/watch\?v=([A-Za-z0-9_-]{11})/,
  /^https?:\/\/youtu\.be\/([A-Za-z0-9_-]{11})/,
  /^https?:\/\/(?:www\.)?youtube\.com\/embed\/([A-Za-z0-9_-]{11})/,
  /^https?:\/\/(?:www\.)?youtube\.com\/shorts\/([A-Za-z0-9_-]{11})/,
]

export function extractYouTubeId(url) {
  if (!url || typeof url !== 'string') return null
  for (const re of YT_HOST_PATTERNS) {
    const m = url.match(re)
    if (m) return m[1]
  }
  return null
}

// Build a YouTube watch URL anchored at `seconds` (uses the short youtu.be
// form for compact display). Returns null when url isn't a recognised
// YouTube URL so the caller can fall back to opening url as-is.
export function youtubeAt(url, seconds) {
  const id = extractYouTubeId(url)
  if (!id) return null
  const t = Number.isFinite(seconds) && seconds > 0 ? Math.floor(seconds) : 0
  return t > 0 ? `https://youtu.be/${id}?t=${t}` : `https://youtu.be/${id}`
}

// "0:47" / "1:23:45" style; returns '' for missing/zero so callers can hide
// the timestamp pill entirely when there's nothing to show.
export function fmtTs(seconds) {
  if (!Number.isFinite(seconds) || seconds < 0) return ''
  const s = Math.floor(seconds)
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const sec = s % 60
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`
  return `${m}:${String(sec).padStart(2, '0')}`
}

// Returns the URL of the source's preview image (server-served) or null when
// the source has no preview. previewSheet is a basename — the REST endpoint
// resolves the real path so the client never sees disk paths.
export function previewUrlFor(sourceId, previewSheet) {
  if (!sourceId || !previewSheet) return null
  return `/api/motion-library/preview/${encodeURIComponent(sourceId)}`
}
