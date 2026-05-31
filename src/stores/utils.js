// @ts-check
/**
 * Pure helpers shared by store slices. No state, no side effects.
 *
 * If you need a helper here, ensure it has no React or zustand dependency
 * — they're meant to be unit-testable in isolation.
 */

/** @typedef {import('../../server/core/types').Track} Track */
/** @typedef {import('../../server/core/types').Timeline} Timeline */
/** @typedef {import('../../server/core/types').VideoSegment} VideoSegment */
/** @typedef {import('../../server/core/types').TextSegment} TextSegment */
/** @typedef {import('../../server/core/types').AudioSegment} AudioSegment */
/** @typedef {import('../../server/core/types').SketchClip} SketchClip */
/** @typedef {VideoSegment | TextSegment | AudioSegment | SketchClip} Segment */

export const DEFAULT_ZOOM = 50  // px per second
export const MAX_UNDO = 50

export const ASPECT_RATIOS = [
  { id: '9:16',   w: 9,  h: 16,  label: '9:16',    icon: '▯' },
  { id: '16:9',   w: 16, h: 9,   label: '16:9',    icon: '▭' },
  { id: '4:3',    w: 4,  h: 3,   label: '4:3',     icon: '▭' },
  { id: '1:1',    w: 1,  h: 1,   label: '1:1',     icon: '□' },
  { id: '3:4',    w: 3,  h: 4,   label: '3:4',     icon: '▯' },
  { id: '2.35:1', w: 235,h: 100, label: '2.35:1',  icon: '▬' },
  { id: '1.85:1', w: 185,h: 100, label: '1.85:1',  icon: '▬' },
  { id: '2:1',    w: 2,  h: 1,   label: '2:1',     icon: '▬' },
]

export const EXPORT_RESOLUTIONS = [
  { id: '540p',  label: '540p',         scale: 540 },
  { id: '720p',  label: '720p',         scale: 720 },
  { id: '1080p', label: '1080p Full HD', scale: 1080 },
  { id: '2k',    label: '1440p 2K',     scale: 1440 },
  { id: '4k',    label: '2160p 4K',     scale: 2160 },
]

export const TRACK_TYPE_NAMES = {
  video: '影片', text: '文字', audio: '音樂', script: '腳本生成軌',
}

let trackIdCounter = 0
export function nextTrackId() {
  return `track_${Date.now()}_${++trackIdCounter}`
}

/**
 * @param {Timeline} timeline
 * @param {string} trackId
 * @returns {Track | undefined}
 */
export function findTrack(timeline, trackId) {
  return timeline.tracks.find(t => t.id === trackId)
}

/**
 * @param {Timeline} timeline
 * @param {string} trackId
 * @param {(clips: Segment[]) => Segment[]} fn
 * @returns {Timeline}
 */
export function updateTrackClips(timeline, trackId, fn) {
  return {
    tracks: timeline.tracks.map(t =>
      t.id === trackId ? { ...t, clips: fn([...t.clips]) } : t
    ),
  }
}

export function trackCountByType(timeline, type) {
  return timeline.tracks.filter(t => t.type === type).length
}

/**
 * Deep clone timeline for undo snapshots.
 *
 * structuredClone is ~3–5× faster than JSON-roundtrip on the timeline shape
 * (no functions, just nested plain data) and is supported in every runtime
 * we ship to (modern browsers, Node ≥17, Electron ≥21). On a 100+-clip
 * project this saves 5–20ms per undo push, which stacks on every clip
 * add/move/split.
 */
export function cloneTimeline(tl) {
  return structuredClone(tl)
}

/**
 * Repack clips so they are contiguous (no gaps), preserving order by start.
 * Optionally skip a specific index (e.g. the clip currently being resized).
 */
export function repackClips(clips, skipIndex = -1) {
  const indexed = clips.map((c, i) => ({ c, i })).sort((a, b) => a.c.start - b.c.start)
  let cursor = 0
  for (const { c, i } of indexed) {
    if (i === skipIndex) {
      cursor = Math.max(cursor, c.end)
      continue
    }
    const dur = c.end - c.start
    if (c.start > cursor + 0.001) {
      clips[i] = { ...clips[i], start: cursor, end: cursor + dur }
    }
    cursor = clips[i].end
  }
  return clips
}
