import { Router, Request, Response } from 'express'
import { ENGINES, isEngine, startService, stopService, statusOf, readVram } from '../services/serviceManager'
import { installWeights } from '../core/engineInstaller'
import { setupSse } from '../utils/sse'

const router = Router()

// GET /api/services — status of every inference service + current VRAM
router.get('/', async (_req: Request, res: Response) => {
  const now = Date.now()
  const names = Object.keys(ENGINES) as Array<keyof typeof ENGINES>
  const [engines, vram] = await Promise.all([
    Promise.all(names.map(n => statusOf(n, now))),
    readVram(),
  ])
  res.json({ engines, vram })
})

// POST /api/services/:name/start
router.post('/:name/start', (req: Request, res: Response) => {
  const { name } = req.params
  if (!isEngine(name)) return res.status(404).json({ error: 'unknown service' })
  try {
    startService(name, Date.now())
    res.json({ ok: true, state: 'starting' })
  } catch (e) {
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) })
  }
})

// POST /api/services/:name/stop
router.post('/:name/stop', async (req: Request, res: Response) => {
  const { name } = req.params
  if (!isEngine(name)) return res.status(404).json({ error: 'unknown service' })
  await stopService(name)
  res.json({ ok: true, state: 'stopped' })
})

// GET /api/services/:name/install — SSE stream of the weight download/extract.
// EventSource is GET-only; closing it (client side) aborts the transfer, which
// leaves resumable .part files behind. Weights come from the model's official
// release; the venv is NOT installed here (guided step, see ENGINES.md).
router.get('/:name/install', (req: Request, res: Response) => {
  const { name } = req.params
  if (!isEngine(name)) return res.status(404).json({ error: 'unknown service' })
  const sse = setupSse(res)
  const ac = new AbortController()
  res.on('close', () => ac.abort())
  installWeights(name, { signal: ac.signal, onProgress: (p) => sse.send(p) })
    .then(() => { sse.send({ status: 'done', phase: 'done', pct: 100 }); sse.close() })
    .catch((e) => {
      if (!ac.signal.aborted) sse.send({ status: 'error', error: e instanceof Error ? e.message : String(e) })
      sse.close()
    })
})

export default router
