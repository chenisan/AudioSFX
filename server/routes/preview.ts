import { Router, Request, Response } from 'express'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import { getProject } from '../core/projectManager'
import { renderPreviewFrame } from '../core/renderer'
import { isValidProjectId } from '../utils/projectIdGuard'

const router = Router()

// GET /api/preview/frame?project_id=xxx&time=5.0
router.get('/frame', async (req: Request, res: Response) => {
  const { project_id, time } = req.query

  if (!isValidProjectId(project_id) || !time) {
    return res.status(400).json({ error: 'project_id (uuid) and time are required' }) as any
  }

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'audiosfx-preview-'))

  try {
    const project = await getProject(String(project_id))
    const timeSeconds = parseFloat(String(time))

    const jpegBuffer = await renderPreviewFrame(project, timeSeconds, tmpDir)

    res.setHeader('Content-Type', 'image/jpeg')
    res.setHeader('Cache-Control', 'no-store')
    res.send(jpegBuffer)
  } catch (err: any) {
    res.status(500).json({ error: err.message })
  } finally {
    try { fs.rmSync(tmpDir, { recursive: true }) } catch {}
  }
})

export default router
