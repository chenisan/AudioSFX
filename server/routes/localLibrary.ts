import { Router, Request, Response } from 'express'
import * as path from 'path'
import * as fs from 'fs'
import * as crypto from 'crypto'
import { getDataDir } from '../utils/dataDir'
import { scanLocal, resolveLocal, importLocal } from '../core/localLibrary'
import { computeWaveform } from '../core/mediaEngine'
import { isValidProjectId } from '../utils/projectIdGuard'

const PREVIEW_WAVEFORM_BUCKETS = 1200   // lighter than timeline's 8000; inline preview strip

// Thin transport over server/core/localLibrary — the user's own local SFX folder.
// The folder path is stored in settings.json (`localSfxDir`), set via Settings UI.
const router = Router()

function configuredDir(): string {
  try {
    const p = path.join(getDataDir(), 'settings.json')
    if (fs.existsSync(p)) {
      const s = JSON.parse(fs.readFileSync(p, 'utf-8'))
      if (typeof s.localSfxDir === 'string') return s.localSfxDir
    }
  } catch {}
  return process.env.LOCAL_SFX_DIR || ''
}

// GET /api/local-library?refresh=1 — scan the configured folder
router.get('/', (req: Request, res: Response) => {
  res.json(scanLocal(configuredDir(), { refresh: req.query.refresh === '1' }))
})

// GET /api/local-library/file?id=<relpath> — stream a sound for preview
router.get('/file', (req: Request, res: Response) => {
  const abs = resolveLocal(configuredDir(), String(req.query.id ?? ''))
  if (!abs) return res.status(404).json({ error: 'not found' }) as any
  res.sendFile(abs)
})

// GET /api/local-library/waveform?id=<relpath> — peaks JSON for the preview strip
//   (cached under dataDir by file path + mtime; Rust computeWaveform, same as assets)
router.get('/waveform', (req: Request, res: Response) => {
  const abs = resolveLocal(configuredDir(), String(req.query.id ?? ''))
  if (!abs) return res.status(404).json({ error: 'not found' }) as any
  try {
    const stat = fs.statSync(abs)
    const cacheDir = path.join(getDataDir(), 'cache', 'local-waveforms')
    fs.mkdirSync(cacheDir, { recursive: true })
    const key = crypto.createHash('sha1')
      .update(`${abs}:${stat.mtimeMs}:${PREVIEW_WAVEFORM_BUCKETS}`).digest('hex')
    const cachePath = path.join(cacheDir, `${key}.json`)
    if (fs.existsSync(cachePath)) {
      return res.type('application/json').send(fs.readFileSync(cachePath, 'utf-8')) as any
    }
    const result = computeWaveform(abs, PREVIEW_WAVEFORM_BUCKETS)
    fs.writeFileSync(cachePath, JSON.stringify(result))
    res.json(result)
  } catch (e: any) {
    const msg: string = e?.message ?? String(e)
    if (msg.includes('no audio') || msg.includes('audio track')) return res.json(null) as any
    res.status(500).json({ error: msg })
  }
})

// POST /api/local-library/import — copy a local sound into a project's assets
//   body: { projectId, id } → { filename, durationSec }
router.post('/import', async (req: Request, res: Response) => {
  const { projectId, id } = req.body ?? {}
  if (!isValidProjectId(projectId)) return res.status(400).json({ error: 'projectId (uuid) required' }) as any
  if (typeof id !== 'string' || !id) return res.status(400).json({ error: 'id required' }) as any
  try {
    res.json(await importLocal(configuredDir(), projectId, id))
  } catch (e: any) {
    res.status(500).json({ error: e?.message ?? String(e) })
  }
})

export default router
