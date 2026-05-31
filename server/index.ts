import 'dotenv/config'
import express from 'express'
import cors from 'cors'
import * as path from 'path'
import * as fs from 'fs'

import projectsRouter from './routes/projects'
import assetsRouter from './routes/assets'
import renderRouter from './routes/render'
import previewRouter from './routes/preview'
import settingsRouter from './routes/settings'
import { detectHwAccel } from './utils/hwAccel'
import { requireValidProjectIdParam } from './utils/projectIdGuard'
import { getDataDir } from './utils/dataDir'

const app = express()
const PORT = process.env.PORT ? parseInt(process.env.PORT) : 6301
const DATA_DIR = getDataDir()

// AudioSFX is a local single-machine creative tool — no auth, no accounts.
// CORS is wide open (the loopback-only listen below is the real boundary).
app.use(cors())
// 50mb tolerates large inlined media data URIs.
app.use(express.json({ limit: '50mb' }))

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

// fallthrough: false → missing files 404 instead of next()'ing through to
// the SPA index.html fallback below.
const STATIC_OPTS = { fallthrough: false } as const

// Static file routes serving user data. No auth — single-machine tool.
app.use('/outputs/:projectId', (req, res, next) => {
  if (!UUID_RE.test(req.params.projectId)) return res.status(400).end()
  const dir = path.join(DATA_DIR, 'projects', req.params.projectId, 'outputs')
  express.static(dir, STATIC_OPTS)(req, res, next)
})

app.use('/assets/:projectId', (req, res, next) => {
  if (!UUID_RE.test(req.params.projectId)) return res.status(400).end()
  const dir = path.join(DATA_DIR, 'projects', req.params.projectId, 'assets')
  express.static(dir, STATIC_OPTS)(req, res, next)
})

// Health check — used by monitoring / dev tooling.
app.get('/api/health', (_req, res) => {
  const hw = detectHwAccel()
  res.json({ status: 'ok', version: '1.0.0', hwAccel: hw })
})

// API routes — projectIdGuard at the mount point so inner routers can trust
// req.params.id is a uuid. Routers that take projectId from body / query
// validate at the handler boundary instead.
app.use('/api/projects/:id/assets', requireValidProjectIdParam(), assetsRouter)
app.use('/api/projects', projectsRouter)
app.use('/api/render', renderRouter)
app.use('/api/preview', previewRouter)
app.use('/api/settings', settingsRouter)

// Production: serve frontend static files
// When running from source: __dirname = server/, dist is at ../dist
// When bundled (esbuild): __dirname = dist/server/, frontend is at ../  (= dist/)
const distDir = fs.existsSync(path.join(__dirname, '..', 'dist', 'index.html'))
  ? path.join(__dirname, '..', 'dist')   // source mode
  : path.join(__dirname, '..')            // bundled mode
if (fs.existsSync(path.join(distDir, 'index.html'))) {
  app.use(express.static(distDir))
  // SPA fallback: any non-API route serves index.html
  app.get('*', (_req, res) => {
    res.sendFile(path.join(distDir, 'index.html'))
  })
}

app.listen(PORT, '127.0.0.1', () => {
  const hw = detectHwAccel()
  console.log(`\n🎬 AudioSFX`)
  console.log(`   Backend:  http://localhost:${PORT}`)
  console.log(`   Data dir: ${DATA_DIR}`)
  console.log(`   Encoder:  ${hw.nvenc ? '⚡ h264_nvenc (GPU)' : '🖥  libx264 (CPU)'}\n`)
})

export default app
