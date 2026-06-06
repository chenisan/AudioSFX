import * as fs from 'fs'
import * as fsp from 'fs/promises'
import * as path from 'path'
import * as yaml from 'js-yaml'
import { AsyncLocalStorage } from 'node:async_hooks'
import { v4 as uuidv4 } from 'uuid'
import {
  Project, Timeline, Segment, VideoSegment, Track, TrackType,
  Folder, FolderGroups, FolderNamespace,
  inferSegmentKind, isVideoSegment, isAudioSegment,
} from './types'
import { ensureTimeline, createDefaultTimeline } from './migration'
import { getMediaInfo } from '../utils/ffprobe'
import { getDataDir } from '../utils/dataDir'
import { emitProjectChanged } from './projectEvents'

const VIDEO_EXTS = new Set(['.mp4', '.mov', '.avi', '.webm', '.mkv'])
const AUDIO_EXTS = new Set(['.mp3', '.wav', '.aac', '.m4a', '.ogg', '.flac'])
const IMAGE_EXTS = new Set(['.jpg', '.jpeg', '.png', '.gif', '.webp'])

export type AssetType = 'video' | 'audio' | 'image' | 'other'

export interface AssetInfo {
  filename: string
  type: AssetType
  size: number
  duration?: number
  /** stat().mtimeMs — exposed so the AssetPanel UI can offer "newest first"
   * sorting alongside the default filename order. */
  mtimeMs: number
}

function inferAssetType(filename: string): AssetType {
  const ext = path.extname(filename).toLowerCase()
  if (VIDEO_EXTS.has(ext)) return 'video'
  if (AUDIO_EXTS.has(ext)) return 'audio'
  if (IMAGE_EXTS.has(ext)) return 'image'
  return 'other'
}

// Lazy accessors so tests that override VIDEO_ENGINE_DATA_DIR per-case see
// the new value. Capturing at module load froze the directory to whatever
// the env was at first import, breaking any test that imports this module
// then sets the env afterwards. Cheap — getDataDir caches internally.
function projectsDir(): string {
  return path.join(getDataDir(), 'projects')
}

function ensureDir(dir: string) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
}

function projectDir(id: string): string {
  return path.join(projectsDir(), id)
}

function projectFile(id: string): string {
  return path.join(projectDir(id), 'project.yaml')
}

export function getAssetDir(id: string): string {
  return path.join(projectDir(id), 'assets')
}

export function getOutputDir(id: string): string {
  return path.join(projectDir(id), 'outputs')
}

/**
 * One-time migration: backfill `segment.kind` on every clip based on its track
 * type. Returns true if any segment was changed (caller should persist).
 */
function migrateSegmentKinds(timeline: Timeline): boolean {
  let changed = false
  for (const track of timeline.tracks) {
    for (const clip of track.clips) {
      if (!(clip as any).kind) {
        ;(clip as any).kind = inferSegmentKind(track.type, clip)
        changed = true
      }
    }
  }
  return changed
}

/**
 * One-time migration: fold a track's deprecated `eq` field into the `plugins`
 * insert chain (as a single eq plugin). Runs on load; returns true if anything
 * changed so the caller persists. After this runs, EQ lives only in `plugins`.
 */
function migrateTrackEqToPlugins(timeline: Timeline): boolean {
  let changed = false
  for (const track of timeline.tracks) {
    const t = track as any
    if (!t.eq) continue
    if (!Array.isArray(t.plugins)) {
      const bands = Array.isArray(t.eq.bands) ? t.eq.bands : []
      t.plugins = [{ id: 'eq', type: 'eq', enabled: !!t.eq.enabled, params: { bands } }]
    }
    // plugins already present → just drop the stale eq mirror.
    delete t.eq
    changed = true
  }
  return changed
}

// ── Manual-save working copies ───────────────────────────────────────────────
// Edits are staged in memory (writeProject without toDisk) and only flushed to
// project.yaml on an explicit save (flushProject), so the editor doesn't write
// to disk on every mutation. A staged copy shadows the on-disk version for all
// reads until it's flushed or the process restarts.
const workingCopies = new Map<string, Project>()

/** Write the staged working copy (if any) to disk and clear it. */
export async function flushProject(id: string): Promise<Project> {
  return withProjectLock(id, async () => {
    const staged = workingCopies.get(id)
    if (!staged) return readProject(id)          // nothing unsaved → return current
    await writeProject(staged, { toDisk: true }) // persists + clears the working copy
    return staged
  })
}

/** True when there are unsaved (in-memory) edits for this project. */
export function hasUnsaved(id: string): boolean {
  return workingCopies.has(id)
}

/** Manual save: persist the client's full project (authoritative) to disk and
 *  clear the staged working copy. */
export async function saveProjectToDisk(id: string, data: Partial<Project>): Promise<Project> {
  return withProjectLock(id, async () => {
    const base = await readProject(id)
    const merged = { ...base, ...data, id, updatedAt: new Date().toISOString() }
    merged.timeline = ensureTimeline(merged.timeline)
    await writeProject(merged, { toDisk: true })
    return merged
  })
}

function readProjectSync(id: string): Project {
  const staged = workingCopies.get(id)
  if (staged) return staged
  const file = projectFile(id)
  if (!fs.existsSync(file)) throw new Error(`Project not found: ${id}`)
  const raw = fs.readFileSync(file, 'utf8')
  const project = yaml.load(raw) as Project
  project.timeline = ensureTimeline(project.timeline)
  let needsWrite = false
  if ((project as any).storyboard !== undefined) {
    delete (project as any).storyboard
    needsWrite = true
  }
  if (migrateSegmentKinds(project.timeline)) needsWrite = true
  if (migrateTrackEqToPlugins(project.timeline)) needsWrite = true
  if (needsWrite) fs.writeFileSync(file, yaml.dump(project), 'utf8')
  return project
}

async function readProject(id: string): Promise<Project> {
  const staged = workingCopies.get(id)
  if (staged) return staged              // unsaved edits shadow the on-disk copy
  const file = projectFile(id)
  try {
    const raw = await fsp.readFile(file, 'utf8')
    const project = yaml.load(raw) as Project
    project.timeline = ensureTimeline(project.timeline)
    let needsWrite = false
    if ((project as any).storyboard !== undefined) {
      delete (project as any).storyboard
      needsWrite = true
    }
    // One-shot migration: particle clips are deprecated. Drop them from any
    // track so the loader doesn't surface dead clips with empty source.
    for (const tr of project.timeline.tracks) {
      const before = tr.clips?.length ?? 0
      tr.clips = (tr.clips ?? []).filter(c => !(c as any).particleConfig)
      if (tr.clips.length !== before) needsWrite = true
    }
    if (migrateSegmentKinds(project.timeline)) needsWrite = true
    if (migrateTrackEqToPlugins(project.timeline)) needsWrite = true
    // Migration writes are silent: listProjects can trigger one per stale
    // project, and emitting SSE for each spams every connected client with
    // events it would just dedup by updatedAt. The frontend dedups anyway,
    // but skipping the emit avoids the round-trip entirely.
    if (needsWrite) await writeProject(project, { silent: true, toDisk: true })
    return project
  } catch {
    throw new Error(`Project not found: ${id}`)
  }
}

async function writeProject(project: Project, opts: { silent?: boolean; toDisk?: boolean } = {}) {
  // Manual-save default: stage the edit in memory only. The real disk write
  // happens on explicit flush (toDisk: true), on createProject, and on
  // load-time migrations. This is why editing no longer hits project.yaml on
  // every mutation.
  if (!opts.toDisk) {
    workingCopies.set(project.id, project)
    if (!opts.silent) emitProjectChanged({ projectId: project.id, updatedAt: project.updatedAt })
    return
  }
  await fsp.mkdir(projectDir(project.id), { recursive: true })
  await fsp.mkdir(getAssetDir(project.id), { recursive: true })
  await fsp.mkdir(getOutputDir(project.id), { recursive: true })
  await fsp.writeFile(projectFile(project.id), yaml.dump(project), 'utf8')
  workingCopies.delete(project.id)   // flushed → on-disk copy is the source of truth again
  if (opts.silent) return
  emitProjectChanged({ projectId: project.id, updatedAt: project.updatedAt })
}

export async function createProject(
  name: string,
  duration: number,
  timeline: Timeline = createDefaultTimeline(),
  ownerId?: string,
): Promise<Project> {
  await fsp.mkdir(projectsDir(), { recursive: true })
  const id = uuidv4()
  const now = new Date().toISOString()
  const project: Project = {
    id,
    name,
    duration,
    resolution: [1080, 1920],
    timeline,
    createdAt: now,
    updatedAt: now,
    ownerId,
  }
  await writeProject(project, { toDisk: true })   // new project must exist on disk immediately
  return project
}

export async function getProject(id: string): Promise<Project> {
  return readProject(id)
}

export async function updateProject(id: string, updates: Partial<Project>): Promise<Project> {
  return withProjectLock(id, async () => {
    const project = await readProject(id)
    const updated = { ...project, ...updates, id, updatedAt: new Date().toISOString() }
    await writeProject(updated)
    return updated
  })
}

export async function deleteProject(id: string) {
  workingCopies.delete(id)
  const dir = projectDir(id)
  try {
    await fsp.rm(dir, { recursive: true })
  } catch {}
}

export async function listProjects(): Promise<Project[]> {
  await fsp.mkdir(projectsDir(), { recursive: true })
  const entries = await fsp.readdir(projectsDir())
  const projects: Project[] = []
  await Promise.all(entries.map(async (entry) => {
    try {
      const project = await readProject(entry)
      projects.push(project)
    } catch {}
  }))
  return projects.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
}

/**
 * One-shot migration: stamp `ownerId = newOwnerId` on every project.yaml
 * that has no ownerId yet. Idempotent — projects already owned are left
 * alone. Called from server/index.ts on boot, right after the bootstrap
 * admin is materialised so the id exists.
 */
export async function claimUnownedProjects(newOwnerId: string): Promise<{ claimed: number }> {
  await fsp.mkdir(projectsDir(), { recursive: true })
  const entries = await fsp.readdir(projectsDir())
  let claimed = 0
  for (const entry of entries) {
    try {
      const project = await readProject(entry)
      if (project.ownerId) continue
      await writeProject({ ...project, ownerId: newOwnerId })
      claimed++
    } catch {}
  }
  return { claimed }
}

// ── Editing helpers ────────────────────────────────────────────────────────

let _trackCounter = Date.now()
function nextTrackId() { return `track_${++_trackCounter}` }

// Add a track. Optionally seed it with one clip atomically (replaces the
// frontend's old addTrackWithClip path so a fresh-track + first-clip never
// straddle two REST calls).
export async function addTrack(
  projectId: string,
  type: TrackType,
  name?: string,
  initialClip?: Segment,
): Promise<{ project: Project; trackId: string }> {
  return withProjectLock(projectId, async () => {
    const project = await readProject(projectId)
    const tracks = project.timeline.tracks
    const count = tracks.filter(t => t.type === type).length
    const typeNames: Record<TrackType, string> = { video: '影片', text: '文字', audio: '音軌', script: '腳本生成軌' }
    const maxOrder = Math.max(-1, ...tracks.map(t => t.order))
    const order = type === 'audio' ? -1 - count : maxOrder + 1
    const trackId = nextTrackId()
    const newTrack: Track = {
      id: trackId, type, name: name ?? `${typeNames[type]} ${count + 1}`,
      order, clips: [],
    }
    if (initialClip) {
      if (!(initialClip as any).kind) (initialClip as any).kind = inferSegmentKind(type, initialClip)
      newTrack.clips.push(initialClip)
    }
    project.timeline.tracks.push(newTrack)
    fitProjectDuration(project)
    project.updatedAt = new Date().toISOString()
    await writeProject(project)
    return { project, trackId }
  })
}

// Idempotent — returns the existing script track id if one exists, otherwise
// creates a new one. Wrapped under the lock so the read-then-create check is
// atomic (without it, two concurrent ensureScriptTrack calls each see no
// existing track and both create one).
export async function ensureScriptTrack(projectId: string): Promise<{ project: Project; trackId: string }> {
  return withProjectLock(projectId, async () => {
    const project = await readProject(projectId)
    const existing = project.timeline.tracks.find(t => t.type === 'script')
    if (existing) return { project, trackId: existing.id }
    return addTrack(projectId, 'script', '腳本生成軌')
  })
}

// Atomic: spawn a new video track + a single colorFill clip stretching the
// timeline content (or a 10s floor). Mirrors the legacy frontend macro so the
// caller sees one round-trip instead of addTrack + addClip.
export async function addColorFillClip(projectId: string, color = '#000000'): Promise<{ project: Project; trackId: string }> {
  return withProjectLock(projectId, async () => {
    const project = await readProject(projectId)
    const tracks = project.timeline.tracks
    const count = tracks.filter(t => t.type === 'video').length
    const maxOrder = Math.max(-1, ...tracks.map(t => t.order))
    let contentEnd = 0
    for (const t of tracks) {
      for (const c of t.clips) if (c.end > contentEnd) contentEnd = c.end
    }
    const dur = Math.max(5, contentEnd || project.duration || 5)
    const trackId = nextTrackId()
    const clip: any = {
      kind: 'video',
      source: '',
      start: 0,
      end: dur,
      trimStart: 0,
      colorFill: color,
    }
    const newTrack: Track = {
      id: trackId,
      type: 'video',
      name: `底色 ${count}`,
      order: maxOrder + 1,
      clips: [clip],
    }
    project.timeline.tracks.push(newTrack)
    fitProjectDuration(project)
    project.updatedAt = new Date().toISOString()
    await writeProject(project)
    return { project, trackId }
  })
}

// Bulk update multiple tracks' `order` field in one atomic write. Use for
// drag-reorder and swap operations so the frontend doesn't issue racy
// per-track PATCH calls. Tracks not in the orderMap keep their current order.
export async function reorderTracks(
  projectId: string,
  orderMap: { trackId: string; order: number }[],
): Promise<Project> {
  return withProjectLock(projectId, async () => {
    const project = await readProject(projectId)
    const byId = new Map(orderMap.map(o => [o.trackId, o.order]))
    for (const t of project.timeline.tracks) {
      if (byId.has(t.id)) t.order = byId.get(t.id)!
    }
    project.updatedAt = new Date().toISOString()
    await writeProject(project)
    return project
  })
}

// Move a clip from one track to another at a specific timeline start. Both
// tracks must exist, neither may be locked, and types must match (e.g. text
// can only move to text). Overlap on the destination track snaps the clip
// right past any existing clips it would clash with — same rule as addClip.
export async function moveClipToTrack(
  projectId: string,
  fromTrackId: string,
  clipIndex: number,
  toTrackId: string,
  newStart: number,
): Promise<{ project: Project; newIndex: number }> {
  return withProjectLock(projectId, async () => {
    const project = await readProject(projectId)
    const fromTrack = project.timeline.tracks.find(t => t.id === fromTrackId)
    const toTrack = project.timeline.tracks.find(t => t.id === toTrackId)
    if (!fromTrack) throw new Error(`Track not found: ${fromTrackId}`)
    if (!toTrack) throw new Error(`Track not found: ${toTrackId}`)
    if (fromTrack.locked) throw new Error(`Track is locked: ${fromTrackId}`)
    if (toTrack.locked) throw new Error(`Track is locked: ${toTrackId}`)
    if (fromTrack.type !== toTrack.type) {
      throw new Error(`Track type mismatch: ${fromTrack.type} → ${toTrack.type}`)
    }
    const clip = fromTrack.clips[clipIndex]
    if (!clip) throw new Error(`Clip not found: index ${clipIndex}`)

    const duration = clip.end - clip.start
    let start = Math.max(0, newStart)
    const overlapping = toTrack.clips.filter(c => start < c.end && (start + duration) > c.start)
    if (overlapping.length > 0) {
      start = Math.max(...overlapping.map(c => c.end))
    }

    fromTrack.clips.splice(clipIndex, 1)
    const moved = { ...clip, start, end: start + duration } as Segment
    toTrack.clips.push(moved)
    toTrack.clips.sort((a, b) => a.start - b.start)
    const newIndex = toTrack.clips.findIndex(c => c === moved)
    fitProjectDuration(project)
    project.updatedAt = new Date().toISOString()
    await writeProject(project)
    return { project, newIndex }
  })
}

export async function removeTrack(projectId: string, trackId: string): Promise<Project> {
  return withProjectLock(projectId, async () => {
    const project = await readProject(projectId)
    project.timeline.tracks = project.timeline.tracks.filter(t => t.id !== trackId)
    project.updatedAt = new Date().toISOString()
    await writeProject(project)
    return project
  })
}

// Track fields that updateTrack accepts. Anything outside this set is
// silently dropped on persistence — it stops UI experiments / typos /
// stale callers from leaking arbitrary keys into project.yaml. `id`, `type`,
// `clips`, and `order` are intentionally excluded: the dedicated track / clip
// CRUD functions own those. `id` and `type` shouldn't change after creation;
// `clips` is mutated through addClip / updateClip / etc.; `order` is left
// alone here because reorder is a multi-track operation we don't yet expose.
const TRACK_MUTABLE_KEYS = ['name', 'locked', 'hidden', 'muted', 'volume', 'plugins', 'gapMode', 'heightSize', 'order'] as const
type TrackMutableKey = typeof TRACK_MUTABLE_KEYS[number]

export async function updateTrack(projectId: string, trackId: string, updates: Partial<Track>): Promise<Project> {
  return withProjectLock(projectId, async () => {
    const project = await readProject(projectId)
    const idx = project.timeline.tracks.findIndex(t => t.id === trackId)
    if (idx < 0) throw new Error(`Track not found: ${trackId}`)
    // Allowlist filter — drops any key not in TRACK_MUTABLE_KEYS, including
    // ones with a value of undefined.
    const filtered: Partial<Track> = {}
    for (const k of TRACK_MUTABLE_KEYS) {
      if (k in (updates as Record<string, unknown>)) {
        const v = (updates as any)[k]
        if (v !== undefined) (filtered as any)[k] = v
      }
    }
    project.timeline.tracks[idx] = { ...project.timeline.tracks[idx], ...filtered }
    project.updatedAt = new Date().toISOString()
    await writeProject(project)
    return project
  })
}

// Extend project.duration so the timeline always contains every clip.
// Shrinking is intentional: deleting clips doesn't shrink below a small floor
// so the workspace doesn't collapse to 0.
function fitProjectDuration(project: Project) {
  let maxEnd = 0
  for (const t of project.timeline.tracks) {
    for (const c of t.clips) {
      if (c.end > maxEnd) maxEnd = c.end
    }
  }
  const floor = 10
  project.duration = Math.max(floor, Math.ceil(maxEnd))
}

export async function addClip(projectId: string, trackId: string, clip: Segment): Promise<Project> {
  return withProjectLock(projectId, async () => {
    const project = await readProject(projectId)
    const track = project.timeline.tracks.find(t => t.id === trackId)
    if (!track) throw new Error(`Track not found: ${trackId}`)
    if (track.locked) throw new Error(`Track is locked: ${trackId}`)
    // Ensure discriminant is set even if caller (MCP / REST / older code) didn't supply it
    if (!(clip as any).kind) (clip as any).kind = inferSegmentKind(track.type, clip)
    // Overlap avoidance: mirror frontend addClip snap behaviour so MCP / REST
    // callers cannot create an illegal overlap. Shifts the incoming clip right
    // to start at the end of the last clip it would overlap.
    const _dur = clip.end - clip.start
    const _over = track.clips.filter(c => clip.start < c.end && clip.end > c.start)
    if (_over.length > 0) {
      const _newStart = Math.max(..._over.map(c => c.end))
      ;(clip as any).start = _newStart
      ;(clip as any).end = _newStart + _dur
    }
    track.clips.push(clip)
    track.clips.sort((a, b) => a.start - b.start)
    fitProjectDuration(project)
    project.updatedAt = new Date().toISOString()
    await writeProject(project)
    return project
  })
}

// Union allowlist of every Segment-variant field that updateClip may patch.
// Same purpose as TRACK_MUTABLE_KEYS — block typos / stale callers / UI
// experiments from leaking arbitrary keys into project.yaml. `kind` is
// excluded because the discriminator is set by inferSegmentKind() during
// migration and shouldn't be flipped at runtime.
const CLIP_MUTABLE_KEYS = [
  // Common
  'start', 'end',
  // Video / Audio media
  'source', 'trimStart', 'trimEnd', 'speed', 'volume', 'muted',
  'fadeIn', 'fadeOut', 'sourceDuration',
  // Video render contract
  'transition', 'filter', 'crop', 'scaleAnim', 'overlay',
  'opacityKF', 'objectFit', 'colorFill',
  // Audio
  'volumeKF',
  // Text
  'text', 'track', 'style',
  // Sketch (script tracks)
  'assetId', 'lyric', 'imagePrompt', 'pose', 'svgFilename',
  // AI script linkage (transport-only)
  'aiScriptRef',
] as const

export async function updateClip(projectId: string, trackId: string, clipIndex: number, updates: Partial<Segment>): Promise<Project> {
  return withProjectLock(projectId, async () => {
    const project = await readProject(projectId)
    const track = project.timeline.tracks.find(t => t.id === trackId)
    if (!track) throw new Error(`Track not found: ${trackId}`)
    if (track.locked) throw new Error(`Track is locked: ${trackId}`)
    if (!track.clips[clipIndex]) throw new Error(`Clip not found: index ${clipIndex}`)

    // Allowlist filter — drop unknown keys before merge.
    const filtered: Record<string, unknown> = {}
    for (const k of CLIP_MUTABLE_KEYS) {
      if (k in (updates as Record<string, unknown>)) {
        const v = (updates as any)[k]
        if (v !== undefined) filtered[k] = v
      }
    }

    // Shallow-merge across the Segment union; TS cannot narrow Partial<Segment>
    // back into a single variant after spread, so we cast at the assignment site.
    track.clips[clipIndex] = { ...track.clips[clipIndex], ...filtered } as Segment
    fitProjectDuration(project)
    project.updatedAt = new Date().toISOString()
    await writeProject(project)
    return project
  })
}

export async function removeClip(projectId: string, trackId: string, clipIndex: number): Promise<Project> {
  return withProjectLock(projectId, async () => {
    const project = await readProject(projectId)
    const track = project.timeline.tracks.find(t => t.id === trackId)
    if (!track) throw new Error(`Track not found: ${trackId}`)
    if (track.locked) throw new Error(`Track is locked: ${trackId}`)
    track.clips.splice(clipIndex, 1)
    fitProjectDuration(project)
    project.updatedAt = new Date().toISOString()
    await writeProject(project)
    return project
  })
}

// Remove every clip from a track without touching the track itself.
export async function clearTrack(projectId: string, trackId: string): Promise<Project> {
  return withProjectLock(projectId, async () => {
    const project = await readProject(projectId)
    const track = project.timeline.tracks.find(t => t.id === trackId)
    if (!track) throw new Error(`Track not found: ${trackId}`)
    if (track.locked) throw new Error(`Track is locked: ${trackId}`)
    track.clips = []
    fitProjectDuration(project)
    project.updatedAt = new Date().toISOString()
    await writeProject(project)
    return project
  })
}

// Apply individual patches to multiple clips in a single atomic read+write.
// Each op targets one clip by { trackId, clipIndex } and provides a partial
// patch (same allowlist as updateClip). Ops for locked tracks are skipped.
export async function updateClipsBatch(
  projectId: string,
  ops: { trackId: string; clipIndex: number; updates: Partial<Segment> }[],
): Promise<{ project: Project; count: number }> {
  return withProjectLock(projectId, async () => {
    const project = await readProject(projectId)
    let applied = 0
    for (const op of ops) {
      const track = project.timeline.tracks.find(t => t.id === op.trackId)
      if (!track || track.locked) continue
      const clip = track.clips[op.clipIndex]
      if (!clip) continue
      // Apply allowed fields only (mirrors updateClip allowlist)
      const filtered: any = {}
      for (const k of CLIP_MUTABLE_KEYS) {
        if (k in (op.updates as Record<string, unknown>)) {
          const v = (op.updates as any)[k]
          if (v !== undefined) filtered[k] = v
        }
      }
      track.clips[op.clipIndex] = { ...clip, ...filtered }
      applied++
    }
    fitProjectDuration(project)
    project.updatedAt = new Date().toISOString()
    await writeProject(project)
    return { project, count: applied }
  })
}

// Merge a property patch onto every clip in a track (shallow-merge like
// updateClip). Use for bulk audio / effect / transform changes without
// calling set_clip_* N times.
export async function applyToAllClips(projectId: string, trackId: string, updates: Partial<Segment>): Promise<{ project: Project; count: number }> {
  return withProjectLock(projectId, async () => {
    const project = await readProject(projectId)
    const track = project.timeline.tracks.find(t => t.id === trackId)
    if (!track) throw new Error(`Track not found: ${trackId}`)
    if (track.locked) throw new Error(`Track is locked: ${trackId}`)
    const count = track.clips.length
    track.clips = track.clips.map(c => ({ ...c, ...updates }) as Segment)
    fitProjectDuration(project)
    project.updatedAt = new Date().toISOString()
    await writeProject(project)
    return { project, count }
  })
}

// Per-project async mutex. We chain promises by projectId so concurrent calls
// to mutating helpers serialize their read-modify-write cycle on project.yaml.
// Without this, parallel mutators (orchestrator publishing N scripts at once,
// or an MCP batch operation racing with a UI edit) read the same baseline
// yaml, each modifies its own slice, then writes — and only the last write
// wins, silently losing the other updates.
//
// Re-entrant by async chain: if a function already running under the lock
// (e.g. ensureScriptTrack, slideshowService) calls another locked function
// (addTrack), the inner call sees the lock is already held by the same
// async chain and runs inline instead of deadlocking. AsyncLocalStorage
// gives us per-async-chain ownership tracking.
const projectLocks = new Map<string, Promise<unknown>>()
const lockOwnership = new AsyncLocalStorage<Set<string>>()

function withProjectLock<T>(projectId: string, fn: () => Promise<T>): Promise<T> {
  const held = lockOwnership.getStore()
  if (held?.has(projectId)) {
    // Same async chain already holds this project's lock — just run fn
    // inline. Without this branch, ensureScriptTrack -> addTrack would
    // wait forever for itself.
    return fn()
  }
  const nextHeld = new Set(held ?? [])
  nextHeld.add(projectId)

  const prev = projectLocks.get(projectId) ?? Promise.resolve()
  const runUnderLock = () => lockOwnership.run(nextHeld, fn)
  // Chain regardless of prev outcome — one failed lock holder shouldn't poison
  // every subsequent caller for this project.
  const next: Promise<T> = prev.then(runUnderLock, runUnderLock)
  projectLocks.set(projectId, next)
  // Cleanup so the map doesn't grow unbounded; only clear if we're still the
  // latest holder (a newer caller may have already overwritten the entry).
  next.finally(() => {
    if (projectLocks.get(projectId) === next) projectLocks.delete(projectId)
  }).catch(() => {})
  return next
}

// Propagate a script's freshly-published asset filename to every timeline clip
// that references it via `aiScriptRef`. Without this, regenerating a script
// rewrites meta.previewFilename + drops the previous file from assets/, but
// existing clips still pin the deleted filename in `source` — preview goes
// blank, render reads a missing file. Called from publishMediaToAssets after
// the new asset is in place. Returns the number of clips touched (0 = no-op,
// no project.yaml write happens).
//
// Optionally accepts the new asset's duration so the same write also fills
// `sourceDuration` on the clip. Without that field set, the frontend's
// resize-end clamps to Infinity (user can drag the tail forever past the
// actual playable content) — the asset-imported drop path already sets it,
// the AI-publish path used to skip it.
//
// Serialized per-project so a batch publish (N parallel scripts) doesn't lose
// updates to the read-modify-write race.
export function syncClipSourceForScript(
  projectId: string,
  scriptId: string,
  newFilename: string,
  newSourceDuration?: number,
): Promise<number> {
  return withProjectLock(projectId, async () => {
    let project: Project
    try {
      project = await readProject(projectId)
    } catch {
      // Project might have been deleted while a publish was in flight — treat
      // as no-op rather than failing the publish.
      return 0
    }
    let touched = 0
    for (const track of project.timeline.tracks) {
      for (const clip of track.clips as Segment[]) {
        if ((clip as VideoSegment).aiScriptRef !== scriptId) continue
        let changed = false
        if ((clip as VideoSegment).source !== newFilename) {
          ;(clip as VideoSegment).source = newFilename
          changed = true
        }
        if (typeof newSourceDuration === 'number' && (clip as VideoSegment).sourceDuration !== newSourceDuration) {
          ;(clip as VideoSegment).sourceDuration = newSourceDuration
          changed = true
        }
        if (changed) touched++
      }
    }
    if (touched === 0) return 0
    project.updatedAt = new Date().toISOString()
    await writeProject(project)
    return touched
  })
}

// Shift all clips in a track so they are packed back-to-back starting at
// `fromTime` (default 0), eliminating any gaps.
export async function arrangeClipsTight(projectId: string, trackId: string, fromTime = 0): Promise<Project> {
  return withProjectLock(projectId, async () => {
    const project = await readProject(projectId)
    const track = project.timeline.tracks.find(t => t.id === trackId)
    if (!track) throw new Error(`Track not found: ${trackId}`)
    if (track.locked) throw new Error(`Track is locked: ${trackId}`)
    const sorted = [...track.clips].sort((a, b) => a.start - b.start)
    let cursor = Math.max(0, fromTime)
    for (const c of sorted) {
      const dur = c.end - c.start
      c.start = cursor
      c.end = cursor + dur
      cursor += dur
    }
    track.clips = sorted
    fitProjectDuration(project)
    project.updatedAt = new Date().toISOString()
    await writeProject(project)
    return project
  })
}

// ── Phase A editing macros ─────────────────────────────────────────────────
//
// These are LLM-friendly shortcuts built on top of the primitives above.
// Each one is a single atomic file-write so the MCP caller sees one step.

// Cut a clip at timeline time `atTime` into two clips. trimStart/trimEnd
// math preserves which source frames each half references.
export async function splitClip(projectId: string, trackId: string, clipIndex: number, atTime: number): Promise<Project> {
  return withProjectLock(projectId, async () => {
    const project = await readProject(projectId)
    const track = project.timeline.tracks.find(t => t.id === trackId)
    if (!track) throw new Error(`Track not found: ${trackId}`)
    if (track.locked) throw new Error(`Track is locked: ${trackId}`)
    const origRaw = track.clips[clipIndex]
    if (!origRaw) throw new Error(`Clip not found: index ${clipIndex}`)
    if (atTime <= origRaw.start || atTime >= origRaw.end) {
      throw new Error(`Split time ${atTime} must be strictly inside clip [${origRaw.start}, ${origRaw.end}]`)
    }
    // splitClip is only meaningful for VideoSegment (has trimStart/trimEnd/fade)
    if (!isVideoSegment(origRaw) && !isAudioSegment(origRaw)) {
      throw new Error(`splitClip not supported for kind=${(origRaw as any).kind ?? 'unknown'}`)
    }
    const orig = origRaw as VideoSegment

    const origTrimStart = orig.trimStart ?? 0
    // speed≠1 means 1 timeline second covers `speed` source seconds, so the
    // default trim window and the split point both have to scale by speed.
    // Without this, splitting a 2× clip in the middle of the timeline would
    // pick the source midpoint (wrong) instead of source 2/3 (right).
    const speed = orig.speed ?? 1
    const origTrimEnd = orig.trimEnd ?? origTrimStart + (orig.end - orig.start) * speed
    if (origTrimEnd <= origTrimStart) {
      throw new Error(`Refusing to split: clip already has invalid trim range [${origTrimStart}, ${origTrimEnd}]`)
    }
    const splitOffset = atTime - orig.start
    const midTrim = origTrimStart + splitOffset * speed
    if (midTrim <= origTrimStart || midTrim >= origTrimEnd) {
      throw new Error(`Split would produce invalid trim halves (mid=${midTrim} outside [${origTrimStart}, ${origTrimEnd}])`)
    }

    const left = { ...orig, end: atTime, trimStart: origTrimStart, trimEnd: midTrim }
    const right = { ...orig, start: atTime, trimStart: midTrim, trimEnd: origTrimEnd }
    // Fade-out belongs to the right half, fade-in stays with the left.
    if (orig.fadeOut) { delete left.fadeOut }
    if (orig.fadeIn) { delete right.fadeIn }
    // Transition (clip → next clip on the track) belongs to the right half:
    // left now flows directly into right (same source, continuous frames),
    // so any xfade/fade-black/wipe between them would insert an unwanted
    // black flash or self-crossfade at the split point.
    if (orig.transition) { delete (left as any).transition }

    track.clips.splice(clipIndex, 1, left, right)
    fitProjectDuration(project)
    project.updatedAt = new Date().toISOString()
    await writeProject(project)
    return project
  })
}

// Remove a batch of clips identified by { trackId, clipIndex } refs in a
// single atomic write. Indices on each track are sorted descending before
// splicing so earlier removals don't corrupt later positions on the same track.
export async function removeClips(
  projectId: string,
  refs: { trackId: string; clipIndex: number }[],
): Promise<Project> {
  return withProjectLock(projectId, async () => {
    const project = await readProject(projectId)
    const byTrack = new Map<string, number[]>()
    for (const { trackId, clipIndex } of refs) {
      if (!byTrack.has(trackId)) byTrack.set(trackId, [])
      byTrack.get(trackId)!.push(clipIndex)
    }
    for (const [trackId, indices] of byTrack) {
      const track = project.timeline.tracks.find(t => t.id === trackId)
      if (!track || track.locked) continue
      const sorted = [...new Set(indices)].sort((a, b) => b - a)
      for (const i of sorted) {
        if (i >= 0 && i < track.clips.length) track.clips.splice(i, 1)
      }
    }
    fitProjectDuration(project)
    project.updatedAt = new Date().toISOString()
    await writeProject(project)
    return project
  })
}

// Paste a block of clips at `atTime`, preserving relative offsets between them.
// If the block would overlap existing clips, the entire block shifts right to
// start after the last overlapping clip — the same block-level snap the
// frontend clipboard applies.
export async function pasteClipsAt(
  projectId: string, trackId: string, atTime: number, clipSpecs: Partial<Segment>[],
): Promise<Project> {
  return withProjectLock(projectId, async () => {
    const project = await readProject(projectId)
    const track = project.timeline.tracks.find(t => t.id === trackId)
    if (!track) throw new Error(`Track not found: ${trackId}`)
    if (track.locked) throw new Error(`Track is locked: ${trackId}`)
    if (clipSpecs.length === 0) return project

    const baseStart = Math.min(...clipSpecs.map(c => c.start ?? 0))
    const anchor = Math.max(0, atTime)
    const placed = clipSpecs.map(c => {
      const offset = (c.start ?? 0) - baseStart
      const dur = (c.end ?? 0) - (c.start ?? 0)
      return { ...c, start: anchor + offset, end: anchor + offset + dur }
    })

    const blockStart = Math.min(...placed.map(p => p.start))
    const blockEnd   = Math.max(...placed.map(p => p.end))
    const blockOver  = track.clips.filter(c => blockStart < c.end && blockEnd > c.start)
    const shift = blockOver.length > 0 ? Math.max(...blockOver.map(c => c.end)) - blockStart : 0

    const finalClips = placed.map(p => ({
      ...p,
      start: p.start + shift,
      end:   p.end   + shift,
      kind:  (p as any).kind ?? inferSegmentKind(track.type, p as Segment),
    }))
    track.clips.push(...(finalClips as Segment[]))
    track.clips.sort((a, b) => a.start - b.start)
    fitProjectDuration(project)
    project.updatedAt = new Date().toISOString()
    await writeProject(project)
    return project
  })
}

// Remove the portion of a clip that is to the LEFT of `atTime`. The surviving
// right portion has its start advanced and trimStart adjusted accordingly.
// fadeIn is dropped because it belonged to the discarded left segment.
export async function deleteLeftAtPlayhead(
  projectId: string, trackId: string, clipIndex: number, atTime: number,
): Promise<Project> {
  return withProjectLock(projectId, async () => {
    const project = await readProject(projectId)
    const track = project.timeline.tracks.find(t => t.id === trackId)
    if (!track) throw new Error(`Track not found: ${trackId}`)
    if (track.locked) throw new Error(`Track is locked: ${trackId}`)
    const orig = track.clips[clipIndex]
    if (!orig) throw new Error(`Clip not found: index ${clipIndex}`)
    if (atTime <= orig.start || atTime >= orig.end) {
      throw new Error(`atTime ${atTime} must be strictly inside clip [${orig.start}, ${orig.end}]`)
    }
    const offset = atTime - orig.start
    const updated: any = { ...orig, start: atTime }
    if (isVideoSegment(orig) || isAudioSegment(orig)) {
      // speed≠1: 1 timeline second covers `speed` source seconds, so the trim
      // advance has to scale by speed (mirrors splitClip).
      const speed = (orig as VideoSegment).speed ?? 1
      updated.trimStart = (orig.trimStart ?? 0) + offset * speed
      delete updated.fadeIn
    }
    track.clips[clipIndex] = updated as Segment
    fitProjectDuration(project)
    project.updatedAt = new Date().toISOString()
    await writeProject(project)
    return project
  })
}

// Remove the portion of a clip that is to the RIGHT of `atTime`. The surviving
// left portion has its end clamped and trimEnd adjusted accordingly.
// fadeOut is dropped because it belonged to the discarded right segment.
export async function deleteRightAtPlayhead(
  projectId: string, trackId: string, clipIndex: number, atTime: number,
): Promise<Project> {
  return withProjectLock(projectId, async () => {
    const project = await readProject(projectId)
    const track = project.timeline.tracks.find(t => t.id === trackId)
    if (!track) throw new Error(`Track not found: ${trackId}`)
    if (track.locked) throw new Error(`Track is locked: ${trackId}`)
    const orig = track.clips[clipIndex]
    if (!orig) throw new Error(`Clip not found: index ${clipIndex}`)
    if (atTime <= orig.start || atTime >= orig.end) {
      throw new Error(`atTime ${atTime} must be strictly inside clip [${orig.start}, ${orig.end}]`)
    }
    const updated: any = { ...orig, end: atTime }
    if (isVideoSegment(orig) || isAudioSegment(orig)) {
      const speed = (orig as VideoSegment).speed ?? 1
      const origTrimEnd = orig.trimEnd ?? (orig.trimStart ?? 0) + (orig.end - orig.start) * speed
      updated.trimEnd = origTrimEnd - (orig.end - atTime) * speed
      delete updated.fadeOut
    }
    track.clips[clipIndex] = updated as Segment
    fitProjectDuration(project)
    project.updatedAt = new Date().toISOString()
    await writeProject(project)
    return project
  })
}

// Auto-slice an asset into fixed-duration segments and insert them sequentially
// on a track. Returns the updated project + count of segments created.
// If duration is not supplied it is probed from the asset file.
export async function splitClipEvenly(
  projectId: string,
  trackId: string,
  source: string,
  segmentDuration: number,
  options: { fromTime?: number; sourceDuration?: number; maxSegments?: number } = {},
): Promise<{ project: Project; count: number; sourceDuration: number }> {
  if (segmentDuration <= 0) throw new Error(`segment_duration must be > 0, got ${segmentDuration}`)

  return withProjectLock(projectId, async () => {
    const project = await readProject(projectId)
    const track = project.timeline.tracks.find(t => t.id === trackId)
    if (!track) throw new Error(`Track not found: ${trackId}`)
    if (track.locked) throw new Error(`Track is locked: ${trackId}`)

    let srcDur = options.sourceDuration
    if (srcDur == null) {
      const filePath = path.join(getAssetDir(projectId), source)
      try {
        const info = await getMediaInfo(filePath)
        srcDur = info.duration
      } catch (err: any) {
        throw new Error(`Cannot probe asset "${source}": ${err?.message ?? err}`)
      }
    }
    if (!srcDur || srcDur <= 0) throw new Error(`Asset "${source}" has no usable duration`)

    const fromTime = options.fromTime ?? 0
    const maxSeg = options.maxSegments ?? Infinity
    const full = Math.min(Math.floor(srcDur / segmentDuration), maxSeg)
    const remainder = srcDur - full * segmentDuration
    const hasTail = remainder > 0.05 && full < maxSeg

    for (let i = 0; i < full; i++) {
      const seg: VideoSegment = {
        kind: 'video',
        source,
        start: fromTime + i * segmentDuration,
        end: fromTime + (i + 1) * segmentDuration,
        trimStart: i * segmentDuration,
        trimEnd: (i + 1) * segmentDuration,
      }
      track.clips.push(seg)
    }
    if (hasTail) {
      const seg: VideoSegment = {
        kind: 'video',
        source,
        start: fromTime + full * segmentDuration,
        end: fromTime + full * segmentDuration + remainder,
        trimStart: full * segmentDuration,
        trimEnd: srcDur,
      }
      track.clips.push(seg)
    }
    track.clips.sort((a, b) => a.start - b.start)

    fitProjectDuration(project)
    project.updatedAt = new Date().toISOString()
    await writeProject(project)
    return { project, count: full + (hasTail ? 1 : 0), sourceDuration: srcDur }
  })
}

// Move a clip to a new timeline start, preserving its duration. Optionally
// relocate to a different track (must be same type or text).
export async function moveClip(
  projectId: string,
  trackId: string,
  clipIndex: number,
  newStart: number,
  targetTrackId?: string,
): Promise<Project> {
  return withProjectLock(projectId, async () => {
    const project = await readProject(projectId)
    const srcTrack = project.timeline.tracks.find(t => t.id === trackId)
    if (!srcTrack) throw new Error(`Track not found: ${trackId}`)
    const clip = srcTrack.clips[clipIndex]
    if (!clip) throw new Error(`Clip not found: index ${clipIndex}`)
    if (srcTrack.locked) throw new Error(`Track is locked: ${trackId}`)

    const duration = clip.end - clip.start
    const newStartClamped = Math.max(0, newStart)
    const moved = { ...clip, start: newStartClamped, end: newStartClamped + duration }

    let dstTrack = srcTrack
    if (targetTrackId && targetTrackId !== trackId) {
      const t = project.timeline.tracks.find(x => x.id === targetTrackId)
      if (!t) throw new Error(`Target track not found: ${targetTrackId}`)
      if (t.locked) throw new Error(`Target track is locked: ${targetTrackId}`)
      if (t.type !== srcTrack.type && t.type !== 'text') {
        throw new Error(`Cannot move ${srcTrack.type} clip to ${t.type} track`)
      }
      dstTrack = t
    }

    srcTrack.clips.splice(clipIndex, 1)
    dstTrack.clips.push(moved)
    dstTrack.clips.sort((a, b) => a.start - b.start)

    fitProjectDuration(project)
    project.updatedAt = new Date().toISOString()
    await writeProject(project)
    return project
  })
}

// Clone a clip. If `atTime` is omitted, the copy is placed immediately after
// the original (touching its end).
export async function duplicateClip(
  projectId: string,
  trackId: string,
  clipIndex: number,
  atTime?: number,
): Promise<Project> {
  return withProjectLock(projectId, async () => {
    const project = await readProject(projectId)
    const track = project.timeline.tracks.find(t => t.id === trackId)
    if (!track) throw new Error(`Track not found: ${trackId}`)
    if (track.locked) throw new Error(`Track is locked: ${trackId}`)
    const orig = track.clips[clipIndex]
    if (!orig) throw new Error(`Clip not found: index ${clipIndex}`)

    const duration = orig.end - orig.start
    const start = atTime != null ? Math.max(0, atTime) : orig.end
    const copy = { ...orig, start, end: start + duration }
    track.clips.push(copy)
    track.clips.sort((a, b) => a.start - b.start)

    fitProjectDuration(project)
    project.updatedAt = new Date().toISOString()
    await writeProject(project)
    return project
  })
}

// Remove a clip and shift all later clips on the same track left by its
// duration — classic ripple delete.
export async function rippleDelete(
  projectId: string,
  trackId: string,
  clipIndex: number,
): Promise<Project> {
  return withProjectLock(projectId, async () => {
    const project = await readProject(projectId)
    const track = project.timeline.tracks.find(t => t.id === trackId)
    if (!track) throw new Error(`Track not found: ${trackId}`)
    if (track.locked) throw new Error(`Track is locked: ${trackId}`)
    const orig = track.clips[clipIndex]
    if (!orig) throw new Error(`Clip not found: index ${clipIndex}`)

    const shift = orig.end - orig.start
    const pivot = orig.end
    track.clips.splice(clipIndex, 1)
    for (const c of track.clips) {
      if (c.start >= pivot - 0.0001) {
        c.start = Math.max(0, c.start - shift)
        c.end = Math.max(0, c.end - shift)
      }
    }
    track.clips.sort((a, b) => a.start - b.start)

    fitProjectDuration(project)
    project.updatedAt = new Date().toISOString()
    await writeProject(project)
    return project
  })
}

export async function importSRT(projectId: string, srtContent: string, trackId?: string): Promise<{ project: Project; count: number }> {
  const cues = parseSRT(srtContent)
  if (cues.length === 0) return { project: await readProject(projectId), count: 0 }

  return withProjectLock(projectId, async () => {
    const project = await readProject(projectId)

    let targetTrackId = trackId
    if (!targetTrackId) {
      const count = project.timeline.tracks.filter(t => t.type === 'text').length
      const maxOrder = Math.max(-1, ...project.timeline.tracks.map(t => t.order))
      const newTrack = {
        id: nextTrackId(), type: 'text' as const, name: `字幕 ${count + 1}`,
        order: maxOrder + 1, clips: [] as any[],
      }
      targetTrackId = newTrack.id
      project.timeline.tracks.push(newTrack)
    }

    const track = project.timeline.tracks.find(t => t.id === targetTrackId)
    if (!track) throw new Error(`Track not found: ${targetTrackId}`)

    for (const cue of cues) {
      track.clips.push({
        text: cue.text,
        start: cue.start,
        end: cue.end,
        style: {
          fontSize: 42,
          color: '#ffffff',
          fontWeight: 'bold',
          position: { x: '50%', y: '85%' },
          shadow: { offsetX: 1, offsetY: 1, blur: 3, color: 'rgba(0,0,0,0.8)' },
        },
      })
    }

    project.updatedAt = new Date().toISOString()
    await writeProject(project)
    return { project, count: cues.length }
  })
}

// In-memory ffprobe cache. Keyed by `${absolutePath}|${mtimeMs}` so a file
// being overwritten with new content (same path, new mtime) invalidates the
// cached duration. AssetPanel calls listAssets on mount + after every upload,
// so without this cache a 30-asset project paid 30 native-probe round-trips
// per refresh. Probe cost is small per call but adds 30–90ms of latency to
// flows that already feel slow (heavy upload sessions).
const probeCache = new Map<string, number>()

export async function listAssets(projectId: string): Promise<AssetInfo[]> {
  const dir = getAssetDir(projectId)
  try {
    const entries = await fsp.readdir(dir, { withFileTypes: true })
    const files = entries
      .filter(e => e.isFile() && !e.name.startsWith('.'))
      .map(e => e.name)
    const results = await Promise.all(files.map(async (filename): Promise<AssetInfo> => {
      const filePath = path.join(dir, filename)
      const stat = await fsp.stat(filePath)
      const type = inferAssetType(filename)
      let duration: number | undefined
      if (type === 'video' || type === 'audio') {
        const cacheKey = `${filePath}|${stat.mtimeMs}`
        const hit = probeCache.get(cacheKey)
        if (hit != null) {
          duration = hit
        } else {
          try {
            const info = await getMediaInfo(filePath)
            duration = info.duration
            if (typeof duration === 'number') probeCache.set(cacheKey, duration)
          } catch {}
        }
      }
      return { filename, type, size: stat.size, duration, mtimeMs: stat.mtimeMs }
    }))
    return results
  } catch {
    return []
  }
}

export async function copyAssetFromPath(projectId: string, sourcePath: string): Promise<string> {
  const dir = getAssetDir(projectId)
  await fsp.mkdir(dir, { recursive: true })
  const filename = path.basename(sourcePath)
  const dest = path.join(dir, filename)
  await fsp.copyFile(sourcePath, dest)
  return filename
}

// Simple SRT parser (server-side)
export function parseSRT(content: string) {
  const normalized = content.replace(/\r\n/g, '\n').replace(/\r/g, '\n').trim()
  const blocks = normalized.split(/\n\n+/)
  const cues: { index: number; start: number; end: number; text: string }[] = []

  for (const block of blocks) {
    const lines = block.trim().split('\n')
    if (lines.length < 2) continue
    let tsLineIdx = -1
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].includes('-->')) { tsLineIdx = i; break }
    }
    if (tsLineIdx < 0) continue
    const tsParts = lines[tsLineIdx].split('-->')
    if (tsParts.length < 2) continue
    const start = parseSrtTimestamp(tsParts[0].trim())
    const end = parseSrtTimestamp(tsParts[1].trim())
    if (start === null || end === null) continue
    const text = lines.slice(tsLineIdx + 1).join('\n').trim()
    if (!text) continue
    cues.push({ index: cues.length + 1, start, end, text })
  }
  return cues
}

function parseSrtTimestamp(ts: string): number | null {
  const cleaned = ts.replace(',', '.')
  const match = cleaned.match(/(\d{1,2}):(\d{2}):(\d{2})(?:\.(\d{1,3}))?/)
  if (!match) return null
  const h = parseInt(match[1], 10)
  const m = parseInt(match[2], 10)
  const s = parseInt(match[3], 10)
  const ms = match[4] ? parseInt(match[4].padEnd(3, '0'), 10) : 0
  return h * 3600 + m * 60 + s + ms / 1000
}

// ── UI folder grouping (asset / script / sketch / track) ────────────────────
//
// All four panels share the same flat-folder data model: a list of
// { id, name, itemIds, collapsed? } per namespace. Items can live in 0 or 1
// folder; the panel buckets uncategorised items in a "未分類" group at render
// time, so we never have to actively maintain it on writes.
//
// itemIds are the panel's existing stable ids (filename / scriptId / sketchId
// / trackId), which means the folder structure is robust to moves of the
// underlying data (clips moving between tracks doesn't touch assetFolders;
// renaming a folder doesn't touch the assets directory). It's also robust to
// item *deletion*: a stale id sitting in a folder simply doesn't render and
// gets cleaned up on next folder write — we treat folder lists as advisory.

const VALID_NS = new Set<FolderNamespace>(['asset', 'script', 'sketch', 'track'])

function ensureFolderGroups(project: Project): FolderGroups {
  if (!project.folderGroups) project.folderGroups = {}
  return project.folderGroups
}

function ensureFolderList(project: Project, ns: FolderNamespace): Folder[] {
  const groups = ensureFolderGroups(project)
  if (!groups[ns]) groups[ns] = []
  return groups[ns]!
}

function checkNamespace(ns: FolderNamespace) {
  if (!VALID_NS.has(ns)) throw new Error(`Unknown folder namespace: ${ns}`)
}

export async function createFolder(
  projectId: string, ns: FolderNamespace, name: string,
): Promise<{ project: Project; folder: Folder }> {
  checkNamespace(ns)
  const trimmed = name?.trim()
  if (!trimmed) throw new Error('Folder name is required')
  return withProjectLock(projectId, async () => {
    const project = await readProject(projectId)
    const folders = ensureFolderList(project, ns)
    const folder: Folder = { id: `f_${uuidv4().slice(0, 8)}`, name: trimmed, itemIds: [] }
    folders.push(folder)
    project.updatedAt = new Date().toISOString()
    await writeProject(project)
    return { project, folder }
  })
}

export async function renameFolder(
  projectId: string, ns: FolderNamespace, folderId: string, name: string,
): Promise<Project> {
  checkNamespace(ns)
  const trimmed = name?.trim()
  if (!trimmed) throw new Error('Folder name is required')
  return withProjectLock(projectId, async () => {
    const project = await readProject(projectId)
    const folders = ensureFolderList(project, ns)
    const folder = folders.find(f => f.id === folderId)
    if (!folder) throw new Error(`Folder not found: ${folderId}`)
    folder.name = trimmed
    project.updatedAt = new Date().toISOString()
    await writeProject(project)
    return project
  })
}

export async function deleteFolder(
  projectId: string, ns: FolderNamespace, folderId: string,
): Promise<Project> {
  checkNamespace(ns)
  return withProjectLock(projectId, async () => {
    const project = await readProject(projectId)
    const folders = ensureFolderList(project, ns)
    const idx = folders.findIndex(f => f.id === folderId)
    if (idx >= 0) folders.splice(idx, 1)
    // Items previously in this folder now appear in 未分類 automatically —
    // no per-item rewrite needed because items don't carry a folderId.
    project.updatedAt = new Date().toISOString()
    await writeProject(project)
    return project
  })
}

// Move an item to `folderId`, or null/undefined to remove from any folder
// (uncategorised). Removes the item from its current folder first so an item
// is never in two places.
export async function moveItemToFolder(
  projectId: string, ns: FolderNamespace, itemId: string, folderId: string | null,
): Promise<Project> {
  checkNamespace(ns)
  if (!itemId) throw new Error('itemId is required')
  return withProjectLock(projectId, async () => {
    const project = await readProject(projectId)
    const folders = ensureFolderList(project, ns)
    for (const f of folders) {
      const i = f.itemIds.indexOf(itemId)
      if (i >= 0) f.itemIds.splice(i, 1)
    }
    if (folderId) {
      const target = folders.find(f => f.id === folderId)
      if (!target) throw new Error(`Folder not found: ${folderId}`)
      target.itemIds.push(itemId)
    }
    project.updatedAt = new Date().toISOString()
    await writeProject(project)
    return project
  })
}

// Bulk variant. Single lock, single write, single SSE — used by the panel's
// "select mode" so a 10-item move doesn't fan out to 10 round-trips.
// `folderId === null` removes all listed items from any folder. Caller may
// also pass `createFolderName`: a new folder with that name is created in the
// same write and the items go into it (saves one extra POST + race window
// between create and move when the user clicks "+ 新資料夾(含選取)").
export async function moveItemsToFolder(
  projectId: string, ns: FolderNamespace, itemIds: string[], folderId: string | null,
  createFolderName?: string,
): Promise<{ project: Project; folder: Folder | null }> {
  checkNamespace(ns)
  if (!Array.isArray(itemIds) || itemIds.length === 0) throw new Error('itemIds is required')
  return withProjectLock(projectId, async () => {
    const project = await readProject(projectId)
    const folders = ensureFolderList(project, ns)

    // Pre-create folder so items can land directly in it. We don't allow both
    // folderId and createFolderName — caller picks one.
    let target: Folder | null = null
    if (createFolderName) {
      if (folderId) throw new Error('Pass either folderId or createFolderName, not both')
      const trimmed = createFolderName.trim()
      if (!trimmed) throw new Error('createFolderName is empty')
      target = { id: `f_${uuidv4().slice(0, 8)}`, name: trimmed, itemIds: [] }
      folders.push(target)
    } else if (folderId) {
      target = folders.find(f => f.id === folderId) ?? null
      if (!target) throw new Error(`Folder not found: ${folderId}`)
    }

    // Remove every input id from any existing folder, then push to target.
    const idSet = new Set(itemIds)
    for (const f of folders) {
      f.itemIds = f.itemIds.filter(id => !idSet.has(id))
    }
    if (target) {
      // Preserve caller-supplied order rather than insertion order from
      // pre-existing folders, so users see items in the order they selected.
      target.itemIds.push(...itemIds)
    }

    project.updatedAt = new Date().toISOString()
    await writeProject(project)
    return { project, folder: target }
  })
}

export async function setFolderCollapsed(
  projectId: string, ns: FolderNamespace, folderId: string, collapsed: boolean,
): Promise<Project> {
  checkNamespace(ns)
  return withProjectLock(projectId, async () => {
    const project = await readProject(projectId)
    const folders = ensureFolderList(project, ns)
    const folder = folders.find(f => f.id === folderId)
    if (!folder) throw new Error(`Folder not found: ${folderId}`)
    folder.collapsed = !!collapsed
    project.updatedAt = new Date().toISOString()
    await writeProject(project, { silent: true })   // collapse state shouldn't fire SSE
    return project
  })
}

export async function getStatus(id: string): Promise<{ id: string; name: string; outputs: string[] }> {
  const project = await readProject(id)
  const outputDir = getOutputDir(id)
  let outputs: string[] = []
  try {
    const files = await fsp.readdir(outputDir)
    outputs = files.filter(f => f.endsWith('.mp4'))
  } catch {}
  return { id, name: project.name, outputs }
}
