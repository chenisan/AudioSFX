import { Timeline, Track, LegacyTimeline, TextSegment } from './types'

const LEGACY_TRACK_MAP: Array<[string, 'video' | 'text' | 'audio', string, number]> = [
  ['video',   'video', '影片 1', 0],
  ['video_2', 'video', '影片 2', 1],
  ['video_3', 'video', '影片 3', 2],
  ['text_1',  'text',  '文字 1', 3],
  ['text_2',  'text',  '文字 2', 4],
  ['text_3',  'text',  '文字 3', 5],
  ['audio',   'audio', '音樂',   -1],
]

export function isLegacyTimeline(timeline: any): boolean {
  if (!timeline) return true
  if (timeline.tracks && Array.isArray(timeline.tracks)) return false
  return true
}

export function migrateLegacyTimeline(legacy: LegacyTimeline): Timeline {
  let idCounter = 1
  const tracks: Track[] = []

  for (const [key, type, name, order] of LEGACY_TRACK_MAP) {
    const clips = (legacy as any)[key]
    if (clips && clips.length > 0) {
      tracks.push({ id: `track_${idCounter++}`, type, name, order, clips: [...clips] })
    }
  }

  // Handle legacy flat 'texts' array (MCP create_custom_video uses this)
  if (legacy.texts && legacy.texts.length > 0) {
    const byTrack = new Map<number, TextSegment[]>()
    for (const seg of legacy.texts) {
      const t = seg.track ?? 1
      if (!byTrack.has(t)) byTrack.set(t, [])
      byTrack.get(t)!.push(seg)
    }
    for (const [trackNum, segs] of byTrack) {
      tracks.push({
        id: `track_${idCounter++}`,
        type: 'text',
        name: `文字 ${trackNum}`,
        order: 2 + trackNum,
        clips: segs,
      })
    }
  }

  // If empty, provide defaults
  if (tracks.length === 0) {
    return createDefaultTimeline()
  }

  return { tracks }
}

export function createDefaultTimeline(): Timeline {
  return {
    tracks: [
      { id: 'track_1', type: 'video', name: '影片 1', order: 0, clips: [] },
      { id: 'track_2', type: 'audio', name: '音樂', order: -1, clips: [] },
    ],
  }
}

export function ensureTimeline(timeline: any): Timeline {
  if (isLegacyTimeline(timeline)) {
    return migrateLegacyTimeline(timeline ?? {})
  }
  return timeline as Timeline
}
