import { Router, Request, Response } from 'express'
import * as fs from 'fs'
import * as path from 'path'
import {
  createProject,
  getProject,
  updateProject,
  deleteProject,
  listProjects,
  splitClip,
  duplicateClip,
  rippleDelete,
  importSRT,
  deleteLeftAtPlayhead,
  deleteRightAtPlayhead,
  pasteClipsAt,
  removeClips,
  arrangeClipsTight,
  applyToAllClips,
  updateClipsBatch,
  addTrack,
  removeTrack,
  updateTrack,
  addColorFillClip,
  ensureScriptTrack,
  reorderTracks,
  moveClipToTrack,
  addClip,
  updateClip,
  removeClip,
  createFolder,
  renameFolder,
  deleteFolder,
  moveItemToFolder,
  moveItemsToFolder,
  setFolderCollapsed,
} from '../core/projectManager'
import { TrackType, FolderNamespace } from '../core/types'
import { onProjectChanged } from '../core/projectEvents'
import { requireValidProjectIdParam } from '../utils/projectIdGuard'
import { getDataDir } from '../utils/dataDir'

const router = Router()
const DATA_DIR = getDataDir()

// All `/:id/*` routes use the param as a uuid project-id and splice it into
// filesystem paths (path.join(DATA_DIR, 'projects', :id, ...)), so validate
// at the router boundary rather than at every handler.
router.use('/:id', requireValidProjectIdParam())

// GET /api/projects — single-machine tool, all projects are visible.
router.get('/', async (_req: Request, res: Response) => {
  try {
    const all = await listProjects()
    res.json(all)
  } catch (err: any) {
    res.status(500).json({ error: err.message })
  }
})

// POST /api/projects
router.post('/', async (req: Request, res: Response) => {
  try {
    const { name, duration, timeline } = req.body
    if (!name || typeof name !== 'string' || !name.trim()) {
      return res.status(400).json({ error: 'name is required' }) as any
    }
    const dur = typeof duration === 'number' ? duration : parseFloat(duration ?? '30')
    if (isNaN(dur) || dur <= 0 || dur > 7200) {
      return res.status(400).json({ error: 'duration must be between 1 and 7200 seconds' }) as any
    }
    const project = await createProject(name.trim(), dur, timeline ?? {})
    res.status(201).json(project)
  } catch (err: any) {
    res.status(500).json({ error: err.message })
  }
})

// GET /api/projects/:id/events — SSE stream of project change events.
// Front-end subscribes after loadProject and re-fetches when an external
// mutation (e.g. MCP tool) bumps updatedAt.
router.get('/:id/events', (req: Request, res: Response) => {
  const projectId = req.params.id
  res.setHeader('Content-Type', 'text/event-stream')
  res.setHeader('Cache-Control', 'no-cache')
  res.setHeader('Connection', 'keep-alive')
  res.flushHeaders()

  const keepAlive = setInterval(() => res.write(': ping\n\n'), 15000)
  const unsubscribe = onProjectChanged((ev) => {
    if (ev.projectId !== projectId) return
    res.write(`data: ${JSON.stringify({ type: 'changed', updatedAt: ev.updatedAt })}\n\n`)
  })

  res.on('close', () => {
    clearInterval(keepAlive)
    unsubscribe()
  })
})

// GET /api/projects/:id
router.get('/:id', async (req: Request, res: Response) => {
  try {
    const project = await getProject(req.params.id)
    res.json(project)
  } catch (err: any) {
    res.status(404).json({ error: err.message })
  }
})

// GET /api/projects/:id/cost-log — read full cost log (sketch-generate + video-generate + AI MV)
router.get('/:id/cost-log', async (req: Request, res: Response) => {
  try {
    const file = path.join(DATA_DIR, 'projects', req.params.id, 'ai', 'cost-log.json')
    if (!fs.existsSync(file)) return res.json({ totalUsd: 0, entries: [] })
    const parsed = JSON.parse(fs.readFileSync(file, 'utf-8'))
    if (Array.isArray(parsed)) return res.json({ totalUsd: 0, entries: parsed })
    res.json(parsed)
  } catch (err: any) {
    res.status(500).json({ error: err.message })
  }
})

// POST /api/projects/:id/cleanup-ai-files — delete AI-generated files not referenced by timeline.
// Computes the in-use set from project.yaml clip sources, then deletes orphans
// in ai/generated and ai/videos. Dry-run unless ?execute=1.
router.post('/:id/cleanup-ai-files', async (req: Request, res: Response) => {
  try {
    const projectId = req.params.id
    const execute   = req.query.execute === '1'
    const project = await getProject(projectId)

    // Collect all clip.source filenames currently in use
    const inUse = new Set<string>()
    for (const t of project.timeline.tracks ?? []) {
      for (const c of (t.clips ?? []) as any[]) {
        if (c?.source && typeof c.source === 'string') inUse.add(path.basename(c.source))
      }
    }

    const projectDir = path.join(DATA_DIR, 'projects', projectId)
    const dirsToScan = ['ai/generated', 'ai/videos']
    const orphans: { dir: string; name: string; bytes: number }[] = []

    for (const sub of dirsToScan) {
      const dir = path.join(projectDir, sub)
      if (!fs.existsSync(dir)) continue
      for (const entry of fs.readdirSync(dir)) {
        if (inUse.has(entry)) continue
        const full = path.join(dir, entry)
        try {
          const stat = fs.statSync(full)
          if (stat.isFile()) orphans.push({ dir: sub, name: entry, bytes: stat.size })
        } catch {}
      }
    }

    let bytesFreed = 0
    if (execute) {
      for (const o of orphans) {
        try {
          fs.unlinkSync(path.join(projectDir, o.dir, o.name))
          bytesFreed += o.bytes
        } catch (e) {
          console.error('[cleanup] failed to delete', o.name, e)
        }
      }
    }

    res.json({
      orphans,
      orphanCount: orphans.length,
      totalBytes:  orphans.reduce((s, o) => s + o.bytes, 0),
      executed:    execute,
      bytesFreed:  execute ? bytesFreed : 0,
    })
  } catch (err: any) {
    res.status(500).json({ error: err.message })
  }
})

// PUT /api/projects/:id
router.put('/:id', async (req: Request, res: Response) => {
  try {
    const project = await updateProject(req.params.id, req.body)
    res.json(project)
  } catch (err: any) {
    res.status(404).json({ error: err.message })
  }
})

// DELETE /api/projects/:id
router.delete('/:id', async (req: Request, res: Response) => {
  try {
    await deleteProject(req.params.id)
    res.status(204).send()
  } catch (err: any) {
    res.status(404).json({ error: err.message })
  }
})

// POST /api/projects/:id/timeline/split-clip
//
// Frontend was running its own splitClip implementation that didn't update
// trimEnd or split fadeIn/fadeOut between halves; this route is the single
// source of truth and the store calls it instead of mutating locally.
router.post('/:id/timeline/split-clip', async (req: Request, res: Response) => {
  try {
    const { trackId, clipIndex, atTime } = req.body ?? {}
    if (typeof trackId !== 'string' || !trackId.trim()) {
      return res.status(400).json({ error: 'trackId is required' }) as any
    }
    if (!Number.isInteger(clipIndex) || clipIndex < 0) {
      return res.status(400).json({ error: 'clipIndex must be a non-negative integer' }) as any
    }
    if (typeof atTime !== 'number' || !Number.isFinite(atTime)) {
      return res.status(400).json({ error: 'atTime must be a finite number' }) as any
    }
    const project = await splitClip(req.params.id, trackId, clipIndex, atTime)
    res.json(project)
  } catch (err: any) {
    res.status(400).json({ error: err.message })
  }
})

// POST /api/projects/:id/timeline/delete-left-at-playhead
// POST /api/projects/:id/timeline/delete-right-at-playhead
function playheadDeleteRoute(fn: typeof deleteLeftAtPlayhead) {
  return async (req: Request, res: Response) => {
    try {
      const { trackId, clipIndex, atTime } = req.body ?? {}
      if (typeof trackId !== 'string' || !trackId.trim()) {
        return res.status(400).json({ error: 'trackId is required' }) as any
      }
      if (!Number.isInteger(clipIndex) || clipIndex < 0) {
        return res.status(400).json({ error: 'clipIndex must be a non-negative integer' }) as any
      }
      if (typeof atTime !== 'number' || !Number.isFinite(atTime)) {
        return res.status(400).json({ error: 'atTime must be a finite number' }) as any
      }
      const project = await fn(req.params.id, trackId, clipIndex, atTime)
      res.json(project)
    } catch (err: any) {
      res.status(400).json({ error: err.message })
    }
  }
}
router.post('/:id/timeline/delete-left-at-playhead', playheadDeleteRoute(deleteLeftAtPlayhead))
router.post('/:id/timeline/delete-right-at-playhead', playheadDeleteRoute(deleteRightAtPlayhead))

// POST /api/projects/:id/timeline/paste-clips
router.post('/:id/timeline/paste-clips', async (req: Request, res: Response) => {
  try {
    const { trackId, atTime, clips } = req.body ?? {}
    if (typeof trackId !== 'string' || !trackId.trim()) {
      return res.status(400).json({ error: 'trackId is required' }) as any
    }
    if (typeof atTime !== 'number' || !Number.isFinite(atTime)) {
      return res.status(400).json({ error: 'atTime must be a finite number' }) as any
    }
    if (!Array.isArray(clips)) {
      return res.status(400).json({ error: 'clips must be an array' }) as any
    }
    const project = await pasteClipsAt(req.params.id, trackId, atTime, clips)
    res.json(project)
  } catch (err: any) {
    res.status(400).json({ error: err.message })
  }
})

// POST /api/projects/:id/timeline/update-clips-batch
router.post('/:id/timeline/update-clips-batch', async (req: Request, res: Response) => {
  try {
    const { ops } = req.body ?? {}
    if (!Array.isArray(ops) || ops.length === 0) {
      return res.status(400).json({ error: 'ops must be a non-empty array' }) as any
    }
    const { project, count } = await updateClipsBatch(req.params.id, ops)
    res.json({ project, count })
  } catch (err: any) {
    res.status(400).json({ error: err.message })
  }
})

// POST /api/projects/:id/timeline/arrange-clips-tight
router.post('/:id/timeline/arrange-clips-tight', async (req: Request, res: Response) => {
  try {
    const { trackId, fromTime } = req.body ?? {}
    if (typeof trackId !== 'string' || !trackId.trim()) {
      return res.status(400).json({ error: 'trackId is required' }) as any
    }
    const project = await arrangeClipsTight(req.params.id, trackId, fromTime ?? 0)
    res.json(project)
  } catch (err: any) {
    res.status(400).json({ error: err.message })
  }
})

// POST /api/projects/:id/timeline/apply-to-all-clips
router.post('/:id/timeline/apply-to-all-clips', async (req: Request, res: Response) => {
  try {
    const { trackId, updates } = req.body ?? {}
    if (typeof trackId !== 'string' || !trackId.trim()) {
      return res.status(400).json({ error: 'trackId is required' }) as any
    }
    if (!updates || typeof updates !== 'object' || Array.isArray(updates)) {
      return res.status(400).json({ error: 'updates must be an object' }) as any
    }
    const { project, count } = await applyToAllClips(req.params.id, trackId, updates)
    res.json({ project, count })
  } catch (err: any) {
    res.status(400).json({ error: err.message })
  }
})

// POST /api/projects/:id/timeline/remove-clips
router.post('/:id/timeline/remove-clips', async (req: Request, res: Response) => {
  try {
    const { refs } = req.body ?? {}
    if (!Array.isArray(refs) || refs.length === 0) {
      return res.status(400).json({ error: 'refs must be a non-empty array' }) as any
    }
    const project = await removeClips(req.params.id, refs)
    res.json(project)
  } catch (err: any) {
    res.status(400).json({ error: err.message })
  }
})

// POST /api/projects/:id/timeline/import-srt
router.post('/:id/timeline/import-srt', async (req: Request, res: Response) => {
  try {
    const { srtContent, trackId } = req.body ?? {}
    if (typeof srtContent !== 'string' || !srtContent.trim()) {
      return res.status(400).json({ error: 'srtContent is required' }) as any
    }
    const { project, count } = await importSRT(req.params.id, srtContent, trackId)
    res.json({ project, count })
  } catch (err: any) {
    res.status(400).json({ error: err.message })
  }
})

// POST /api/projects/:id/timeline/duplicate-clip
router.post('/:id/timeline/duplicate-clip', async (req: Request, res: Response) => {
  try {
    const { trackId, clipIndex } = req.body ?? {}
    if (typeof trackId !== 'string' || !trackId.trim()) {
      return res.status(400).json({ error: 'trackId is required' }) as any
    }
    if (!Number.isInteger(clipIndex) || clipIndex < 0) {
      return res.status(400).json({ error: 'clipIndex must be a non-negative integer' }) as any
    }
    const project = await duplicateClip(req.params.id, trackId, clipIndex)
    res.json(project)
  } catch (err: any) {
    res.status(400).json({ error: err.message })
  }
})

// POST /api/projects/:id/timeline/ripple-delete
router.post('/:id/timeline/ripple-delete', async (req: Request, res: Response) => {
  try {
    const { trackId, clipIndex } = req.body ?? {}
    if (typeof trackId !== 'string' || !trackId.trim()) {
      return res.status(400).json({ error: 'trackId is required' }) as any
    }
    if (!Number.isInteger(clipIndex) || clipIndex < 0) {
      return res.status(400).json({ error: 'clipIndex must be a non-negative integer' }) as any
    }
    const project = await rippleDelete(req.params.id, trackId, clipIndex)
    res.json(project)
  } catch (err: any) {
    res.status(400).json({ error: err.message })
  }
})

// ── Track / clip CRUD ─────────────────────────────────────────────────────
//
// These endpoints replace the frontend's pure-state addTrack/addClip/updateClip
// path. Every UI mutation now goes through here so project.yaml on disk stays
// in sync with the editor — without that sync, REST ops like split/delete
// hit a stale yaml and 400 with "Track not found" / "Clip not found".

const VALID_TRACK_TYPES: TrackType[] = ['video', 'text', 'audio', 'script']

// POST /api/projects/:id/timeline/tracks  — add track (optional initialClip)
router.post('/:id/timeline/tracks', async (req: Request, res: Response) => {
  try {
    const { type, name, initialClip } = req.body ?? {}
    if (!VALID_TRACK_TYPES.includes(type)) {
      return res.status(400).json({ error: `type must be one of ${VALID_TRACK_TYPES.join(', ')}` }) as any
    }
    if (name !== undefined && typeof name !== 'string') {
      return res.status(400).json({ error: 'name must be a string' }) as any
    }
    if (initialClip !== undefined && (typeof initialClip !== 'object' || initialClip === null)) {
      return res.status(400).json({ error: 'initialClip must be an object' }) as any
    }
    const { project, trackId } = await addTrack(req.params.id, type, name, initialClip)
    res.status(201).json({ project, trackId })
  } catch (err: any) {
    res.status(400).json({ error: err.message })
  }
})

// POST /api/projects/:id/timeline/tracks/reorder  — bulk reorder
// Defined before /tracks/:trackId so Express doesn't match "reorder" as a trackId.
router.post('/:id/timeline/tracks/reorder', async (req: Request, res: Response) => {
  try {
    const { orderMap } = req.body ?? {}
    if (!Array.isArray(orderMap)) {
      return res.status(400).json({ error: 'orderMap must be an array of {trackId, order}' }) as any
    }
    for (const o of orderMap) {
      if (typeof o?.trackId !== 'string' || typeof o?.order !== 'number') {
        return res.status(400).json({ error: 'each entry must have string trackId and number order' }) as any
      }
    }
    const project = await reorderTracks(req.params.id, orderMap)
    res.json(project)
  } catch (err: any) {
    res.status(400).json({ error: err.message })
  }
})

// POST /api/projects/:id/timeline/tracks/color-fill  — add solid-color video track
router.post('/:id/timeline/tracks/color-fill', async (req: Request, res: Response) => {
  try {
    const { color } = req.body ?? {}
    if (color !== undefined && typeof color !== 'string') {
      return res.status(400).json({ error: 'color must be a hex string' }) as any
    }
    const { project, trackId } = await addColorFillClip(req.params.id, color)
    res.status(201).json({ project, trackId })
  } catch (err: any) {
    res.status(400).json({ error: err.message })
  }
})

// POST /api/projects/:id/timeline/tracks/ensure-script  — idempotent script track
router.post('/:id/timeline/tracks/ensure-script', async (req: Request, res: Response) => {
  try {
    const { project, trackId } = await ensureScriptTrack(req.params.id)
    res.json({ project, trackId })
  } catch (err: any) {
    res.status(400).json({ error: err.message })
  }
})

// PATCH /api/projects/:id/timeline/tracks/:trackId  — name / locked / hidden / muted / heightSize / gapMode / order
router.patch('/:id/timeline/tracks/:trackId', async (req: Request, res: Response) => {
  try {
    const updates = req.body ?? {}
    if (typeof updates !== 'object' || updates === null || Array.isArray(updates)) {
      return res.status(400).json({ error: 'body must be an object of track field updates' }) as any
    }
    const project = await updateTrack(req.params.id, req.params.trackId, updates)
    res.json(project)
  } catch (err: any) {
    res.status(400).json({ error: err.message })
  }
})

// DELETE /api/projects/:id/timeline/tracks/:trackId  — remove track + its clips
router.delete('/:id/timeline/tracks/:trackId', async (req: Request, res: Response) => {
  try {
    const project = await removeTrack(req.params.id, req.params.trackId)
    res.json(project)
  } catch (err: any) {
    res.status(400).json({ error: err.message })
  }
})

// POST /api/projects/:id/timeline/tracks/:trackId/clips  — add clip
router.post('/:id/timeline/tracks/:trackId/clips', async (req: Request, res: Response) => {
  try {
    const clip = req.body
    if (!clip || typeof clip !== 'object' || Array.isArray(clip)) {
      return res.status(400).json({ error: 'body must be a clip object' }) as any
    }
    if (typeof clip.start !== 'number' || typeof clip.end !== 'number') {
      return res.status(400).json({ error: 'clip.start and clip.end must be numbers' }) as any
    }
    const project = await addClip(req.params.id, req.params.trackId, clip)
    res.status(201).json(project)
  } catch (err: any) {
    res.status(400).json({ error: err.message })
  }
})

// PATCH /api/projects/:id/timeline/tracks/:trackId/clips/:idx  — update clip fields
router.patch('/:id/timeline/tracks/:trackId/clips/:idx', async (req: Request, res: Response) => {
  try {
    const idx = parseInt(req.params.idx, 10)
    if (!Number.isInteger(idx) || idx < 0) {
      return res.status(400).json({ error: 'idx must be a non-negative integer' }) as any
    }
    const updates = req.body ?? {}
    if (typeof updates !== 'object' || Array.isArray(updates)) {
      return res.status(400).json({ error: 'body must be an object' }) as any
    }
    const project = await updateClip(req.params.id, req.params.trackId, idx, updates)
    res.json(project)
  } catch (err: any) {
    res.status(400).json({ error: err.message })
  }
})

// DELETE /api/projects/:id/timeline/tracks/:trackId/clips/:idx  — remove clip
router.delete('/:id/timeline/tracks/:trackId/clips/:idx', async (req: Request, res: Response) => {
  try {
    const idx = parseInt(req.params.idx, 10)
    if (!Number.isInteger(idx) || idx < 0) {
      return res.status(400).json({ error: 'idx must be a non-negative integer' }) as any
    }
    const project = await removeClip(req.params.id, req.params.trackId, idx)
    res.json(project)
  } catch (err: any) {
    res.status(400).json({ error: err.message })
  }
})

// POST /api/projects/:id/timeline/clips/move-to-track  — cross-track move
router.post('/:id/timeline/clips/move-to-track', async (req: Request, res: Response) => {
  try {
    const { fromTrackId, clipIndex, toTrackId, newStart } = req.body ?? {}
    if (typeof fromTrackId !== 'string' || !fromTrackId.trim()) {
      return res.status(400).json({ error: 'fromTrackId is required' }) as any
    }
    if (typeof toTrackId !== 'string' || !toTrackId.trim()) {
      return res.status(400).json({ error: 'toTrackId is required' }) as any
    }
    if (!Number.isInteger(clipIndex) || clipIndex < 0) {
      return res.status(400).json({ error: 'clipIndex must be a non-negative integer' }) as any
    }
    if (typeof newStart !== 'number' || !Number.isFinite(newStart)) {
      return res.status(400).json({ error: 'newStart must be a finite number' }) as any
    }
    const { project, newIndex } = await moveClipToTrack(req.params.id, fromTrackId, clipIndex, toTrackId, newStart)
    res.json({ project, newIndex })
  } catch (err: any) {
    res.status(400).json({ error: err.message })
  }
})

// ── UI folder grouping ────────────────────────────────────────────────────
// Folders are pure organisational metadata living on project.folderGroups.
// Same flat schema across asset / script / sketch / track namespaces, so one
// route set covers every panel.

const VALID_NAMESPACES = new Set<FolderNamespace>(['asset', 'script', 'sketch', 'track'])

function checkNs(req: Request, res: Response): FolderNamespace | null {
  const ns = req.params.ns as FolderNamespace
  if (!VALID_NAMESPACES.has(ns)) {
    res.status(400).json({ error: `unknown namespace: ${ns}` })
    return null
  }
  return ns
}

router.post('/:id/folders/:ns', async (req: Request, res: Response) => {
  const ns = checkNs(req, res); if (!ns) return
  try {
    const { name } = req.body ?? {}
    if (typeof name !== 'string') {
      return res.status(400).json({ error: 'name must be a string' }) as any
    }
    const { project, folder } = await createFolder(req.params.id, ns, name)
    res.status(201).json({ project, folder })
  } catch (err: any) {
    res.status(400).json({ error: err.message })
  }
})

router.patch('/:id/folders/:ns/:folderId', async (req: Request, res: Response) => {
  const ns = checkNs(req, res); if (!ns) return
  try {
    const { name, collapsed } = req.body ?? {}
    let project
    if (typeof name === 'string') {
      project = await renameFolder(req.params.id, ns, req.params.folderId, name)
    }
    if (typeof collapsed === 'boolean') {
      project = await setFolderCollapsed(req.params.id, ns, req.params.folderId, collapsed)
    }
    if (!project) return res.status(400).json({ error: 'no recognised field to update' }) as any
    res.json(project)
  } catch (err: any) {
    res.status(400).json({ error: err.message })
  }
})

router.delete('/:id/folders/:ns/:folderId', async (req: Request, res: Response) => {
  const ns = checkNs(req, res); if (!ns) return
  try {
    const project = await deleteFolder(req.params.id, ns, req.params.folderId)
    res.json(project)
  } catch (err: any) {
    res.status(400).json({ error: err.message })
  }
})

router.post('/:id/folders/:ns/move-item', async (req: Request, res: Response) => {
  const ns = checkNs(req, res); if (!ns) return
  try {
    const { itemId, folderId } = req.body ?? {}
    if (typeof itemId !== 'string' || !itemId) {
      return res.status(400).json({ error: 'itemId must be a non-empty string' }) as any
    }
    if (folderId !== null && folderId !== undefined && typeof folderId !== 'string') {
      return res.status(400).json({ error: 'folderId must be a string or null' }) as any
    }
    const project = await moveItemToFolder(req.params.id, ns, itemId, folderId ?? null)
    res.json(project)
  } catch (err: any) {
    res.status(400).json({ error: err.message })
  }
})

// Bulk move. Body: { itemIds: string[], folderId: string|null }
//                or { itemIds: string[], createFolderName: string }
router.post('/:id/folders/:ns/move-items', async (req: Request, res: Response) => {
  const ns = checkNs(req, res); if (!ns) return
  try {
    const { itemIds, folderId, createFolderName } = req.body ?? {}
    if (!Array.isArray(itemIds) || itemIds.length === 0 || itemIds.some((x: any) => typeof x !== 'string')) {
      return res.status(400).json({ error: 'itemIds must be a non-empty string array' }) as any
    }
    if (folderId !== null && folderId !== undefined && typeof folderId !== 'string') {
      return res.status(400).json({ error: 'folderId must be a string or null' }) as any
    }
    if (createFolderName !== undefined && typeof createFolderName !== 'string') {
      return res.status(400).json({ error: 'createFolderName must be a string' }) as any
    }
    const result = await moveItemsToFolder(req.params.id, ns, itemIds, folderId ?? null, createFolderName)
    res.json(result)
  } catch (err: any) {
    res.status(400).json({ error: err.message })
  }
})

export default router
