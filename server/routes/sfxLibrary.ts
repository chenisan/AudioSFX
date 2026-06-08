import { Router, Request, Response } from 'express'
import { getManifest, resolveLibraryFile, importToProject } from '../core/sfxLibrary'
import { isValidProjectId } from '../utils/projectIdGuard'

// Thin transport over server/core/sfxLibrary — bundled CC0 SFX library.
const router = Router()

// GET /api/sfx-library — full manifest (categories + items)
router.get('/', (_req: Request, res: Response) => {
  try {
    res.json(getManifest())
  } catch (e: any) {
    res.status(503).json({ error: 'sfx library unavailable', detail: e?.message })
  }
})

// GET /api/sfx-library/file/:id — stream a sound for preview (id validated
// against the manifest, so no path traversal is possible)
router.get('/file/:id', (req: Request, res: Response) => {
  const r = resolveLibraryFile(req.params.id)
  if (!r) return res.status(404).json({ error: 'not found' }) as any
  res.type('audio/ogg')
  res.sendFile(r.abs)
})

// POST /api/sfx-library/import — copy a library sound into a project's assets
//   body: { projectId, id } → { filename, durationSec, name }
router.post('/import', async (req: Request, res: Response) => {
  const { projectId, id } = req.body ?? {}
  if (!isValidProjectId(projectId)) return res.status(400).json({ error: 'projectId (uuid) required' }) as any
  if (typeof id !== 'string' || !id) return res.status(400).json({ error: 'id required' }) as any
  try {
    res.json(await importToProject(projectId, id))
  } catch (e: any) {
    res.status(500).json({ error: e?.message ?? String(e) })
  }
})

export default router
