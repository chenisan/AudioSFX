import { Router, Request, Response } from 'express'
import { getProject } from '../core/projectManager'
import { renderProject } from '../core/renderer'
import { RenderProgress } from '../core/types'
import { isValidProjectId } from '../utils/projectIdGuard'

const router = Router()

// POST /api/render
// Streams progress via Server-Sent Events (SSE)
router.post('/', async (req: Request, res: Response) => {
  const { project_id, quality = 'high', fps, videoBitrate, audioBitrate, format, outputDir, startSec, endSec } = req.body

  if (!isValidProjectId(project_id)) {
    return res.status(400).json({ error: 'project_id (uuid) is required' }) as any
  }

  // Resolve the project up-front so the render block below can reuse the
  // same fetch (avoids double-read).
  let project
  try {
    project = await getProject(project_id)
  } catch (e: any) {
    return res.status(404).json({ error: 'project_not_found', detail: e?.message }) as any
  }

  // AudioSFX is non-commercial / single-machine — no tier gate, no watermark.
  const applyWatermark = false

  // Set up SSE
  res.setHeader('Content-Type', 'text/event-stream')
  res.setHeader('Cache-Control', 'no-cache')
  res.setHeader('Connection', 'keep-alive')
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.flushHeaders()

  // Wrap every res.write so a closed client doesn't blow up the request
  // handler with ERR_STREAM_WRITE_AFTER_END (which then re-throws inside
  // the catch block and crashes the whole render). Mirrors the same
  // pattern used in workflowRun.ts after the same bug bit there.
  const send = (data: RenderProgress) => {
    try { res.write(`data: ${JSON.stringify(data)}\n\n`) } catch {}
  }

  const keepAlive = setInterval(() => {
    try { res.write(': ping\n\n') } catch {}
  }, 15000)

  // Tear down the keep-alive timer the moment the client disconnects so the
  // setInterval doesn't keep firing harmless-but-noisy writes for the rest
  // of the (possibly long-running) render.
  res.on('close', () => clearInterval(keepAlive))

  try {
    send({ status: 'rendering', progress: 0, message: '開始渲染...' })

    const result = await renderProject(project, { quality, fps, videoBitrate, audioBitrate, format, outputDir, startSec, endSec, applyWatermark }, (progress) => {
      send(progress)
    })

    send({
      status: 'done',
      progress: 100,
      message: outputDir ? `渲染完成！已儲存至 ${result.outputPath}` : '渲染完成！',
      output: outputDir ? null : result.relativePath,
      outputPath: outputDir ? result.outputPath : undefined,
    })
  } catch (err: any) {
    console.error('[render] Error:', err)
    send({
      status: 'error',
      progress: 0,
      message: '渲染失敗',
      error: err.message,
    })
  } finally {
    clearInterval(keepAlive)
    try { res.end() } catch {}
  }
})

export default router
