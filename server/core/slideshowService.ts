import * as path from 'path'
import {
  createProject,
  updateProject,
  getProject,
  addTrack,
  addClip,
  copyAssetFromPath,
} from './projectManager'
import type { Project } from './types'

export interface SlideSpec {
  file: string
  duration: number
  zh?: string
  en?: string
}

export interface SlideshowOptions {
  name: string
  slidesDir: string
  slides: SlideSpec[]
  aspectRatio?: string
  fadeDuration?: number
}

export interface SlideshowResult {
  project: Project
  totalDuration: number
}

export async function assembleSlideshow(opts: SlideshowOptions): Promise<SlideshowResult> {
  const { name, slidesDir, slides, aspectRatio = '16:9', fadeDuration = 0.4 } = opts

  const totalDuration = slides.reduce((s, sl) => s + sl.duration, 0)
  const project = await createProject(name, totalDuration)
  const pid = project.id

  await updateProject(pid, { aspectRatio } as any)

  const tracks = (await getProject(pid)).timeline.tracks
  const videoTrack = tracks.find(t => t.type === 'video')!

  const { project: zhProject, trackId: zhTrackId } = await addTrack(pid, 'text', '中文字幕')
  const zhTrack = zhProject.timeline.tracks.find(t => t.id === zhTrackId)!
  const { project: enProject, trackId: enTrackId } = await addTrack(pid, 'text', 'English')
  const enTrack = enProject.timeline.tracks.find(t => t.id === enTrackId)!

  const videoClips: any[] = []
  const zhClips: any[]    = []
  const enClips: any[]    = []

  let cursor = 0
  for (const sl of slides) {
    const start = +cursor.toFixed(3)
    const end   = +(cursor + sl.duration).toFixed(3)
    const fd    = fadeDuration

    let filename = sl.file
    try {
      filename = await copyAssetFromPath(pid, path.join(slidesDir, sl.file))
    } catch {
      // File not found — keep original name; render will skip the missing asset
    }

    videoClips.push({
      start, end, source: filename,
      ...(fd > 0 ? {
        fadeIn:  { type: 'fade', color: null, duration: fd },
        fadeOut: { type: 'fade', color: null, duration: fd },
      } : {}),
    })

    if (sl.zh) {
      zhClips.push({ start, end, text: sl.zh, style: {
        fontSize: 38, color: '#ffffff', fontWeight: 'bold',
        fontFamily: 'Noto Sans TC', position: { x: '50%', y: '82%' },
      }})
    }
    if (sl.en) {
      enClips.push({ start, end, text: sl.en, style: {
        fontSize: 26, color: '#cccccc', fontWeight: 'normal',
        fontFamily: 'Noto Sans TC', position: { x: '50%', y: '90%' },
      }})
    }

    cursor += sl.duration
  }

  for (const c of videoClips) await addClip(pid, videoTrack.id, c)
  for (const c of zhClips)    await addClip(pid, zhTrack.id, c)
  for (const c of enClips)    await addClip(pid, enTrack.id, c)

  const finalProject = await getProject(pid)
  return { project: finalProject, totalDuration }
}
