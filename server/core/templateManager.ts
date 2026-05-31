import * as fs from 'fs'
import * as path from 'path'
import * as yaml from 'js-yaml'
import { Template, Timeline, TextSegment, Segment } from './types'
import { createProject } from './projectManager'
import { Project } from './types'
import { ensureTimeline } from './migration'

const TEMPLATES_DIR = process.env.VIDEO_ENGINE_TEMPLATES_DIR ?? path.join(process.cwd(), 'templates')

function templateFile(id: string): string {
  return path.join(TEMPLATES_DIR, `${id}.yaml`)
}

export function listTemplates(): Template[] {
  if (!fs.existsSync(TEMPLATES_DIR)) return []
  return fs.readdirSync(TEMPLATES_DIR)
    .filter(f => f.endsWith('.yaml'))
    .map(f => {
      const raw = fs.readFileSync(path.join(TEMPLATES_DIR, f), 'utf8')
      const tpl = yaml.load(raw) as any
      const id = f.replace('.yaml', '')
      return normalizeTemplate(id, tpl)
    })
}

export function getTemplate(id: string): Template {
  const file = templateFile(id)
  if (!fs.existsSync(file)) throw new Error(`Template not found: ${id}`)
  const raw = fs.readFileSync(file, 'utf8')
  const tpl = yaml.load(raw) as any
  return normalizeTemplate(id, tpl)
}

function normalizeTemplate(id: string, raw: any): Template {
  // Extract placeholder keys from the template
  const yamlStr = JSON.stringify(raw)
  const matches = yamlStr.match(/\{\{(\w+)\}\}/g) ?? []
  const placeholders = [...new Set(matches.map(m => m.replace(/[{}]/g, '')))]

  return {
    id,
    name: raw.name ?? id,
    description: raw.description ?? '',
    duration: raw.duration ?? 30,
    resolution: raw.resolution,
    tracks: ensureTimeline(raw.tracks ?? {}),
    placeholders,
  }
}

/**
 * Fill template placeholders with provided values.
 * {{key}} → value
 */
function fillPlaceholders(obj: any, values: Record<string, string>): any {
  if (typeof obj === 'string') {
    let result = obj
    for (const [key, val] of Object.entries(values)) {
      result = result.replace(new RegExp(`\\{\\{${key}\\}\\}`, 'g'), val)
    }
    return result
  }
  if (Array.isArray(obj)) {
    return obj.map(item => fillPlaceholders(item, values))
  }
  if (obj && typeof obj === 'object') {
    const result: any = {}
    for (const [k, v] of Object.entries(obj)) {
      result[k] = fillPlaceholders(v, values)
    }
    return result
  }
  return obj
}

export async function createFromTemplate(
  templateId: string,
  options: {
    placeholders?: Record<string, string>
    audioSource?: string
    videoSources?: string[]
  }
): Promise<Project> {
  const template = getTemplate(templateId)
  const { placeholders = {}, audioSource, videoSources } = options

  let tracks = fillPlaceholders(template.tracks, placeholders) as Timeline
  tracks = ensureTimeline(tracks)

  // Override audio/video sources if provided
  if (audioSource) {
    const audioTrack = tracks.tracks.find(t => t.type === 'audio')
    if (audioTrack && audioTrack.clips.length > 0) {
      audioTrack.clips[0] = { ...audioTrack.clips[0], source: audioSource } as Segment
    }
  }
  if (videoSources) {
    const videoTrack = tracks.tracks.find(t => t.type === 'video')
    if (videoTrack) {
      videoTrack.clips = videoTrack.clips.map((v, i) =>
        videoSources[i] ? ({ ...v, source: videoSources[i] } as Segment) : v
      )
    }
  }

  const name = `${template.name} — ${new Date().toLocaleString()}`
  return await createProject(name, template.duration, tracks)
}

export function saveAsTemplate(project: Project, templateName: string, description: string = ''): Template {
  if (!fs.existsSync(TEMPLATES_DIR)) fs.mkdirSync(TEMPLATES_DIR, { recursive: true })

  const id = templateName.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '')
  const tpl = {
    name: templateName,
    description,
    duration: project.duration,
    resolution: project.resolution,
    tracks: project.timeline,
  }

  fs.writeFileSync(templateFile(id), yaml.dump(tpl), 'utf8')
  return normalizeTemplate(id, tpl)
}
