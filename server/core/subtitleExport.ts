import { Project, TextSegment } from './types'

/** SRT timestamp: `HH:MM:SS,mmm` (comma before milliseconds). */
function srtTime(seconds: number): string {
  const total = Math.max(0, seconds)
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = Math.floor(total % 60)
  const ms = Math.floor((total - Math.floor(total)) * 1000)
  return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')},${ms.toString().padStart(3, '0')}`
}

/**
 * Merge every text track's clips into one SRT document, ordered by start time.
 * Hidden tracks are still included — the user authored the subtitles and an
 * export should reflect everything they've written, not the current view state.
 */
export function buildSrt(project: Project): string {
  const segments: TextSegment[] = project.timeline.tracks
    .filter(t => t.type === 'text')
    .flatMap(t => (t.clips ?? []) as TextSegment[])
    .filter(s => (s.text ?? '').trim().length > 0 && s.end > s.start)
    .sort((a, b) => a.start - b.start)

  return segments
    .map((seg, i) => `${i + 1}\n${srtTime(seg.start)} --> ${srtTime(seg.end)}\n${seg.text}`)
    .join('\n\n') + (segments.length > 0 ? '\n' : '')
}
