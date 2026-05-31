import { Router, Request, Response } from 'express'
import * as path from 'path'
import * as fs from 'fs'
import { getAssetDir } from '../core/projectManager'
import { isValidProjectId } from '../utils/projectIdGuard'
import { generateSfx, generateMMAudio, generateV2A, checkServices, ServiceDownError, GenResult } from '../audio/audioGenClient'
import { saveGeneratedAudio } from '../audio/audioOrchestrator'

const router = Router()

// Resolve a project-relative asset filename to an absolute path, rejecting any
// path-traversal. `source` must be a plain filename living in the project's
// assets/ dir (that's where uploads + generated clips live).
function resolveSource(projectId: string, source: unknown): string | null {
  if (typeof source !== 'string' || !source || source !== path.basename(source)) return null
  const abs = path.join(getAssetDir(projectId), source)
  return fs.existsSync(abs) ? abs : null
}

async function land(res: Response, projectId: string, result: GenResult, baseName: string) {
  const saved = await saveGeneratedAudio(projectId, result, baseName, Date.now())
  res.json(saved)
}

function handleError(res: Response, e: unknown) {
  if (e instanceof ServiceDownError) return res.status(503).json({ error: e.message, code: 'service_down' })
  res.status(500).json({ error: e instanceof Error ? e.message : String(e) })
}

// GET /api/audio/health — which inference services are reachable
router.get('/health', async (_req, res) => {
  res.json(await checkServices())
})

// POST /api/audio/sfx — text → SFX (Woosh-DFlow)
//   body: { projectId, prompt, num_steps?, cfg?, seed? }
router.post('/sfx', async (req: Request, res: Response) => {
  const { projectId, prompt, num_steps, cfg, seed } = req.body ?? {}
  if (!isValidProjectId(projectId)) return res.status(400).json({ error: 'projectId (uuid) required' })
  if (typeof prompt !== 'string' || !prompt.trim()) return res.status(400).json({ error: 'prompt required' })
  try {
    const result = await generateSfx({ prompt: prompt.trim(), num_steps, cfg, seed })
    await land(res, projectId, result, prompt)
  } catch (e) { handleError(res, e) }
})

// POST /api/audio/mmaudio — video → synced底聲 (MMAudio)
//   body: { projectId, source, prompt?, duration?, ... }
router.post('/mmaudio', async (req: Request, res: Response) => {
  const { projectId, source, prompt, negative_prompt, duration, num_steps, cfg_strength, seed } = req.body ?? {}
  if (!isValidProjectId(projectId)) return res.status(400).json({ error: 'projectId (uuid) required' })
  const video_path = resolveSource(projectId, source)
  if (!video_path) return res.status(400).json({ error: `source not found in project assets: ${source}` })
  try {
    const result = await generateMMAudio({ video_path, prompt, negative_prompt, duration, num_steps, cfg_strength, seed })
    await land(res, projectId, result, `mmaudio_${path.parse(String(source)).name}`)
  } catch (e) { handleError(res, e) }
})

// POST /api/audio/v2a — video → SFX (Woosh-DVFlow-8s)
//   body: { projectId, source, description?, ... }
router.post('/v2a', async (req: Request, res: Response) => {
  const { projectId, source, start, description, num_steps, cfg, seed } = req.body ?? {}
  if (!isValidProjectId(projectId)) return res.status(400).json({ error: 'projectId (uuid) required' })
  const video_path = resolveSource(projectId, source)
  if (!video_path) return res.status(400).json({ error: `source not found in project assets: ${source}` })
  try {
    const result = await generateV2A({ video_path, start, description, num_steps, cfg, seed })
    const seg = Number.isFinite(start) && start > 0 ? `_${Math.round(start)}s` : ''
    await land(res, projectId, result, `v2a_${path.parse(String(source)).name}${seg}`)
  } catch (e) { handleError(res, e) }
})

export default router
