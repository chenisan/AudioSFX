import { Router, Request, Response } from 'express'
import * as fs from 'fs'
import * as path from 'path'
import multer from 'multer'
import ffmpeg from 'fluent-ffmpeg'
import ffmpegStatic from 'ffmpeg-static'
import { getProject } from '../core/projectManager'
import { getAssetDir } from '../core/projectManager'
import { getMediaInfo } from '../utils/ffprobe'
import { computeWaveform, generateThumbnailStrip } from '../core/mediaEngine'
import { sanitizeFilename } from '../utils/pathSafety'
import { transcodeToMp4, transcodeToM4a } from '../core/mediaTranscode'

/** Resolve ffmpeg binary path: env var first (Electron packaged), then ffmpeg-static. */
function getFfmpegPath(): string {
  if (process.env.FFMPEG_PATH) return process.env.FFMPEG_PATH
  return (ffmpegStatic as any) ?? 'ffmpeg'
}

/**
 * Resolve ffprobe:
 *   1. FFPROBE_PATH env var
 *   2. sibling file next to ffmpeg-static's ffmpeg binary (if user drops ffprobe there)
 *   3. system PATH (same as fluent-ffmpeg default)
 */
function getFfprobePath(): string {
  if (process.env.FFPROBE_PATH) return process.env.FFPROBE_PATH
  try {
    const ffm = ffmpegStatic as any
    if (typeof ffm === 'string' && ffm) {
      const exe = process.platform === 'win32' ? 'ffprobe.exe' : 'ffprobe'
      const sibling = path.join(path.dirname(ffm), exe)
      if (fs.existsSync(sibling)) return sibling
    }
  } catch {}
  return 'ffprobe'
}

/** Number of peaks to request from the Rust engine for a given audio. */
const WAVEFORM_BUCKETS = 8000

/** Thumbnail strip height in pixels (source aspect ratio preserved). */
const THUMB_STRIP_HEIGHT = 90

function ensureCacheDir(assetDir: string): string {
  const cacheDir = path.join(assetDir, '.cache')
  if (!fs.existsSync(cacheDir)) fs.mkdirSync(cacheDir, { recursive: true })
  return cacheDir
}

/** Reject path traversal attempts. Returns null if the name is unsafe. */
function safeParamFilename(name: string): string | null {
  if (!name) return null
  if (name.includes('..') || name.includes('/') || name.includes('\\') || name.includes('\0')) return null
  return name
}

const router = Router({ mergeParams: true })

// Multer: save to project assets dir
const upload = multer({
  storage: multer.diskStorage({
    destination: (req, _file, cb) => {
      const assetDir = getAssetDir(req.params.id)
      if (!fs.existsSync(assetDir)) fs.mkdirSync(assetDir, { recursive: true })
      cb(null, assetDir)
    },
    filename: (_req, file, cb) => {
      cb(null, sanitizeFilename(file.originalname, `asset_${Date.now()}`))
    },
  }),
  limits: { fileSize: 500 * 1024 * 1024 }, // 500MB
})

// GET /api/projects/:id/assets
router.get('/', async (req: Request, res: Response) => {
  try {
    const assetDir = getAssetDir(req.params.id)
    if (!fs.existsSync(assetDir)) return res.json([]) as any

    // Skip hidden files/dirs (like .cache)
    const files = fs.readdirSync(assetDir, { withFileTypes: true })
      .filter(d => d.isFile() && !d.name.startsWith('.'))
      .map(d => d.name)
    const assets = await Promise.all(
      files.map(async filename => {
        const filePath = path.join(assetDir, filename)
        const stat = fs.statSync(filePath)
        const ext = path.extname(filename).toLowerCase()
        const type = ['.mp4', '.mov', '.avi', '.webm'].includes(ext) ? 'video'
          : ['.mp3', '.wav', '.aac', '.m4a', '.ogg'].includes(ext) ? 'audio'
          : ['.jpg', '.jpeg', '.png', '.gif', '.webp'].includes(ext) ? 'image'
          : 'other'

        let duration: number | undefined
        if (type === 'video' || type === 'audio') {
          try {
            const info = await getMediaInfo(filePath)
            duration = info.duration
          } catch {}
        }

        return { filename, type, size: stat.size, duration }
      })
    )

    res.json(assets)
  } catch (err: any) {
    res.status(500).json({ error: err.message })
  }
})

// POST /api/projects/:id/assets (upload)
router.post('/', upload.single('file'), (req: Request, res: Response) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' }) as any
    res.status(201).json({ filename: req.file.filename, size: req.file.size })
  } catch (err: any) {
    res.status(500).json({ error: err.message })
  }
})

// POST /api/projects/:id/assets/:name/transcode  — webm → mp4 (video+audio) or m4a (audio-only)
router.post('/:name/transcode', async (req: Request, res: Response) => {
  const name = safeParamFilename(req.params.name)
  if (!name) return res.status(400).json({ error: 'Invalid filename' }) as any

  const target = req.body?.target
  if (target !== 'mp4' && target !== 'm4a') {
    return res.status(400).json({ error: 'target must be "mp4" or "m4a"' }) as any
  }

  const assetDir = getAssetDir(req.params.id)
  const sourcePath = path.join(assetDir, name)
  if (!fs.existsSync(sourcePath)) return res.status(404).json({ error: 'Source asset not found' }) as any

  const baseNoExt = name.replace(/\.[^.]+$/, '')
  const outputName = `${baseNoExt}.${target}`
  if (outputName === name) {
    return res.status(400).json({ error: 'Source already has target extension' }) as any
  }
  const outputPath = path.join(assetDir, outputName)

  try {
    if (target === 'mp4') {
      await transcodeToMp4(sourcePath, outputPath, getFfmpegPath())
    } else {
      await transcodeToM4a(sourcePath, outputPath, getFfmpegPath())
    }
    const size = fs.statSync(outputPath).size
    res.status(201).json({ filename: outputName, size })
  } catch (err: any) {
    res.status(500).json({ error: err.message })
  }
})

// GET /api/projects/:id/assets/thumbnail/:name  — video thumbnail (JPEG, cached)
router.get('/thumbnail/:name', async (req: Request, res: Response) => {
  const name = safeParamFilename(req.params.name)
  if (!name) return res.status(400).json({ error: 'Invalid filename' }) as any

  const assetDir = getAssetDir(req.params.id)
  const sourcePath = path.join(assetDir, name)
  if (!fs.existsSync(sourcePath)) return res.status(404).json({ error: 'Not found' }) as any

  const cacheDir = ensureCacheDir(assetDir)
  const thumbPath = path.join(cacheDir, `${name}.thumb.jpg`)

  if (fs.existsSync(thumbPath)) return res.sendFile(thumbPath) as any

  try {
    await new Promise<void>((resolve, reject) => {
      ffmpeg(sourcePath)
        .seekInput(1)
        .frames(1)
        .size('160x284')   // 9:16 ratio thumbnail
        .outputOptions(['-y'])
        .output(thumbPath)
        .on('end', () => resolve())
        .on('error', (err: Error) => reject(err))
        .run()
    })
    res.sendFile(thumbPath)
  } catch (err: any) {
    res.status(500).json({ error: err.message })
  }
})

// GET /api/projects/:id/assets/waveform/:name  — audio waveform (PNG, cached)
router.get('/waveform/:name', async (req: Request, res: Response) => {
  const name = safeParamFilename(req.params.name)
  if (!name) return res.status(400).json({ error: 'Invalid filename' }) as any

  const assetDir = getAssetDir(req.params.id)
  const sourcePath = path.join(assetDir, name)
  if (!fs.existsSync(sourcePath)) return res.status(404).json({ error: 'Not found' }) as any

  const cacheDir = ensureCacheDir(assetDir)
  const wavePath = path.join(cacheDir, `${name}.wave.png`)

  if (fs.existsSync(wavePath)) return res.sendFile(wavePath) as any

  try {
    await new Promise<void>((resolve, reject) => {
      ffmpeg(sourcePath)
        .complexFilter('compand,showwavespic=s=200x40:colors=#22c55e')
        .frames(1)
        .outputOptions(['-y'])
        .output(wavePath)
        .on('end', () => resolve())
        .on('error', (err: Error) => reject(err))
        .run()
    })
    res.sendFile(wavePath)
  } catch (err: any) {
    res.status(500).json({ error: err.message })
  }
})

// GET /api/projects/:id/assets/waveform-data/:name  — waveform peaks as JSON (cached, Rust)
router.get('/waveform-data/:name', async (req: Request, res: Response) => {
  const name = safeParamFilename(req.params.name)
  if (!name) return res.status(400).json({ error: 'Invalid filename' }) as any

  const assetDir = getAssetDir(req.params.id)
  const sourcePath = path.join(assetDir, name)
  if (!fs.existsSync(sourcePath)) return res.status(404).json({ error: 'Not found' }) as any

  const cacheDir = ensureCacheDir(assetDir)
  const peaksPath = path.join(cacheDir, `${name}.peaks.json`)
  const srcStat = fs.statSync(sourcePath)

  // Cache hit only if cache is newer than source AND has the current schema
  if (fs.existsSync(peaksPath)) {
    const cacheStat = fs.statSync(peaksPath)
    if (cacheStat.mtimeMs >= srcStat.mtimeMs) {
      try {
        const cached = JSON.parse(fs.readFileSync(peaksPath, 'utf-8'))
        // Validate current schema: must have peaksMin/peaksMax/bucketCount/duration
        if (cached?.peaksMin && cached?.peaksMax && cached?.bucketCount && cached?.duration) {
          return res.json(cached) as any
        }
      } catch {}
      // Stale or invalid — fall through to regenerate
    }
  }

  try {
    const result = computeWaveform(sourcePath, WAVEFORM_BUCKETS)
    fs.writeFileSync(peaksPath, JSON.stringify(result))
    res.json(result)
  } catch (err: any) {
    const msg: string = err.message ?? ''
    if (msg.includes('no audio') || msg.includes('audio track')) {
      return res.json(null) as any
    }
    res.status(500).json({ error: msg })
  }
})

// GET /api/projects/:id/assets/thumbstrip/:name  — timeline thumbnail strip manifest (cached)
router.get('/thumbstrip/:name', async (req: Request, res: Response) => {
  const name = safeParamFilename(req.params.name)
  if (!name) return res.status(400).json({ error: 'Invalid filename' }) as any

  const assetDir = getAssetDir(req.params.id)
  const sourcePath = path.join(assetDir, name)
  if (!fs.existsSync(sourcePath)) return res.status(404).json({ error: 'Not found' }) as any

  const cacheDir = ensureCacheDir(assetDir)
  const stripDir = path.join(cacheDir, `${name}.thumbstrip`)
  const manifestPath = path.join(stripDir, 'manifest.json')
  const srcStat = fs.statSync(sourcePath)

  // Cache hit only if manifest is newer than source
  if (fs.existsSync(manifestPath)) {
    const mStat = fs.statSync(manifestPath)
    if (mStat.mtimeMs >= srcStat.mtimeMs) {
      return res.json(JSON.parse(fs.readFileSync(manifestPath, 'utf-8'))) as any
    }
  }

  try {
    if (!fs.existsSync(stripDir)) fs.mkdirSync(stripDir, { recursive: true })
    const result = generateThumbnailStrip({
      videoPath: sourcePath,
      outputDir: stripDir,
      ffmpegPath: getFfmpegPath(),
      ffprobePath: getFfprobePath(),
      height: THUMB_STRIP_HEIGHT,
    })
    // Return a simplified manifest (without absolute outputDir)
    const manifest = {
      durationSec: result.durationSec,
      count: result.count,
      width: result.width,
      height: result.height,
      files: result.files,
    }
    res.json(manifest)
  } catch (err: any) {
    res.status(500).json({ error: err.message })
  }
})

// GET /api/projects/:id/assets/thumbstrip/:name/:file  — serve a single thumb jpg
router.get('/thumbstrip/:name/:file', (req: Request, res: Response) => {
  const name = safeParamFilename(req.params.name)
  const file = safeParamFilename(req.params.file)
  if (!name || !file) return res.status(400).json({ error: 'Invalid name' }) as any
  if (!/^thumb_\d{4}\.jpg$/.test(file)) return res.status(400).json({ error: 'Invalid file' }) as any

  const assetDir = getAssetDir(req.params.id)
  const filePath = path.join(assetDir, '.cache', `${name}.thumbstrip`, file)
  if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'Not found' }) as any

  res.type('image/jpeg')
  res.sendFile(filePath)
})

// DELETE /api/projects/:id/assets/:name
router.delete('/:name', (req: Request, res: Response) => {
  try {
    const name = safeParamFilename(req.params.name)
    if (!name) return res.status(400).json({ error: 'Invalid filename' }) as any

    const assetDir = getAssetDir(req.params.id)
    const filePath = path.join(assetDir, name)
    if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'File not found' }) as any
    fs.unlinkSync(filePath)
    // Clean up cached thumbnails / waveforms / peaks / thumbstrip
    const cacheDir = path.join(assetDir, '.cache')
    for (const suffix of ['.thumb.jpg', '.wave.png', '.peaks.json']) {
      try { fs.unlinkSync(path.join(cacheDir, name + suffix)) } catch {}
    }
    const stripDir = path.join(cacheDir, `${name}.thumbstrip`)
    try { fs.rmSync(stripDir, { recursive: true, force: true }) } catch {}
    res.status(204).send()
  } catch (err: any) {
    res.status(500).json({ error: err.message })
  }
})

export default router
