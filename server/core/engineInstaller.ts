/**
 * In-app weight downloader for the local inference engines.
 *
 * The engines' venvs and multi-GB weights do NOT ship with the installer
 * (weights are CC BY-NC, venvs need a CUDA toolchain). The venv stays a guided
 * manual step (ENGINES.md); the WEIGHTS, however, are just file downloads from
 * the models' OFFICIAL release URLs — so we fetch them here with resume +
 * progress, extract, and drop them where the engine expects.
 *
 * We NEVER re-host the weights: every URL points at the upstream project's own
 * release (SonyResearch/Woosh). MMAudio self-downloads its weights on first run
 * (its own code fetches from HuggingFace), so it has no manifest here — its only
 * install gap is the venv, which isn't auto-buildable.
 *
 * Windows-only (matches the project). Extraction uses the built-in `tar`
 * (bsdtar, auto-detects zip). Streaming download is resumable via HTTP Range.
 */
import { spawn } from 'child_process'
import * as fs from 'fs'
import * as fsp from 'fs/promises'
import * as path from 'path'
import { Readable, Transform } from 'stream'
import { pipeline } from 'stream/promises'
import type { EngineName } from '../services/serviceManager'

export interface WeightAsset {
  /** checkpoints/<dir> — the folder the engine loads from (audiosfx_api.py). */
  dir: string
  /** Official upstream release URL of the per-model zip. */
  url: string
}

const WOOSH_BASE = 'https://github.com/SonyResearch/Woosh/releases/download/v1.0.0'

// Woosh v1.0.0 release assets (verified via `gh release view`). T2A core first
// (AE / CLAP / TextConditionerA / DFlow / Flow) so the fast text→SFX path works
// as early as possible, then the heavier V2A set. ~11GB total.
// KEEP IN SYNC with ENGINES[woosh].requires in serviceManager.ts.
export const WEIGHT_MANIFEST: Record<EngineName, WeightAsset[]> = {
  woosh: [
    { dir: 'Woosh-AE',         url: `${WOOSH_BASE}/Woosh-AE.zip` },
    { dir: 'Woosh-CLAP',       url: `${WOOSH_BASE}/Woosh-CLAP.zip` },
    { dir: 'TextConditionerA', url: `${WOOSH_BASE}/TextConditionerA.zip` },
    { dir: 'Woosh-DFlow',      url: `${WOOSH_BASE}/Woosh-DFlow.zip` },
    { dir: 'Woosh-Flow',       url: `${WOOSH_BASE}/Woosh-Flow.zip` },
    { dir: 'TextConditionerV', url: `${WOOSH_BASE}/TextConditionerV.zip` },
    { dir: 'Woosh-VFlow-8s',   url: `${WOOSH_BASE}/Woosh-VFlow-8s.zip` },
    { dir: 'Woosh-DVFlow-8s',  url: `${WOOSH_BASE}/Woosh-DVFlow-8s.zip` },
  ],
  mmaudio: [], // self-downloads on first run
}

export function hasDownloadableWeights(name: EngineName): boolean {
  return (WEIGHT_MANIFEST[name]?.length ?? 0) > 0
}

export interface InstallProgress {
  phase: 'sizing' | 'download' | 'extract' | 'done'
  /** Current model dir being fetched. */
  file?: string
  fileIndex: number      // 1-based index among assets that needed fetching
  fileCount: number      // how many assets need fetching this run
  fileBytes?: number     // bytes fetched of the current file
  fileTotal?: number     // total bytes of the current file (0 if unknown)
  overallBytes: number
  overallTotal: number   // 0 if sizing failed → fall back to fileIndex/fileCount
  pct: number            // 0–100 overall
  bytesPerSec?: number
}

type OnProgress = (p: InstallProgress) => void

async function headSize(url: string, signal: AbortSignal): Promise<number> {
  try {
    const r = await fetch(url, { method: 'HEAD', redirect: 'follow', signal })
    const len = Number(r.headers.get('content-length') || 0)
    return Number.isFinite(len) ? len : 0
  } catch {
    return 0
  }
}

function extractZip(zip: string, dest: string): Promise<void> {
  // bsdtar (built into Win10+) auto-detects zip and is faster/lighter than
  // Expand-Archive for multi-GB archives.
  return new Promise((resolve, reject) => {
    const child = spawn('tar', ['-xf', zip, '-C', dest], { windowsHide: true })
    let err = ''
    child.stderr.on('data', d => { err += String(d) })
    child.on('error', reject)
    child.on('close', code => (code === 0 ? resolve() : reject(new Error(`tar 解壓失敗（${code}）：${err.trim()}`)))) // eslint-disable-line
  })
}

// After extraction the model files may sit at the temp root, under <dir>/, or
// under checkpoints/<dir>/ (upstream's nested-folder gotcha). Return the folder
// that actually holds the model.
async function locateModelDir(tmp: string, dir: string): Promise<string> {
  const nested = path.join(tmp, 'checkpoints', dir)
  if (fs.existsSync(nested)) return nested
  const direct = path.join(tmp, dir)
  if (fs.existsSync(direct)) return direct
  return tmp // zip root already is the model dir's contents
}

async function rmrf(p: string): Promise<void> {
  await fsp.rm(p, { recursive: true, force: true }).catch(() => {})
}

/**
 * Download + install any missing weights for `name`. Idempotent: model dirs
 * already present are skipped, and partial `.part` files resume. Throws on
 * error; aborting `signal` cancels cleanly (leaving `.part` for next resume).
 */
export async function installWeights(
  name: EngineName,
  opts: { onProgress: OnProgress; signal: AbortSignal },
): Promise<void> {
  const { onProgress, signal } = opts
  const assets = WEIGHT_MANIFEST[name] ?? []
  const engineDir = path.join(process.cwd(), 'engines', name)
  const ckptDir = path.join(engineDir, 'checkpoints')
  const dlDir = path.join(ckptDir, '_dl')

  const pending = assets.filter(a => !fs.existsSync(path.join(ckptDir, a.dir)))
  if (pending.length === 0) {
    onProgress({ phase: 'done', fileIndex: 0, fileCount: 0, overallBytes: 0, overallTotal: 0, pct: 100 })
    return
  }
  await fsp.mkdir(dlDir, { recursive: true })

  // Size pass so the overall bar is meaningful (best-effort; 0 → count-based).
  onProgress({ phase: 'sizing', fileIndex: 0, fileCount: pending.length, overallBytes: 0, overallTotal: 0, pct: 0 })
  const sizes: number[] = []
  for (const a of pending) {
    if (signal.aborted) throw new Error('已取消')
    sizes.push(await headSize(a.url, signal))
  }
  const overallTotal = sizes.reduce((s, n) => s + n, 0)

  let completedBytes = 0
  let lastTs = Date.now()
  let lastBytes = 0
  let speed = 0

  for (let i = 0; i < pending.length; i++) {
    if (signal.aborted) throw new Error('已取消')
    const a = pending[i]
    const partPath = path.join(dlDir, `${a.dir}.zip.part`)
    const zipPath = path.join(dlDir, `${a.dir}.zip`)
    const fileTotalHint = sizes[i]

    const emit = (phase: InstallProgress['phase'], fileBytes: number, fileTotal: number) => {
      const overallBytes = completedBytes + fileBytes
      const pct = overallTotal > 0
        ? Math.min(100, Math.round((overallBytes / overallTotal) * 100))
        : Math.round((i / pending.length) * 100)
      onProgress({
        phase, file: a.dir, fileIndex: i + 1, fileCount: pending.length,
        fileBytes, fileTotal, overallBytes, overallTotal, pct, bytesPerSec: speed,
      })
    }

    // ── Download (resume from any existing .part) ──
    const existing = fs.existsSync(partPath) ? (await fsp.stat(partPath)).size : 0
    const res = await fetch(a.url, {
      redirect: 'follow', signal,
      headers: existing > 0 ? { Range: `bytes=${existing}-` } : {},
    })
    if (!res.ok && res.status !== 206) throw new Error(`下載 ${a.dir} 失敗：HTTP ${res.status}`)
    if (!res.body) throw new Error(`下載 ${a.dir} 失敗：無回應內容`)
    const append = res.status === 206
    const remaining = Number(res.headers.get('content-length') || 0)
    const fileTotal = (append ? existing : 0) + remaining || fileTotalHint
    let fileBytes = append ? existing : 0

    const counter = new Transform({
      transform(chunk, _enc, cb) {
        fileBytes += chunk.length
        const now = Date.now()
        if (now - lastTs >= 500) {
          speed = ((fileBytes - lastBytes) / (now - lastTs)) * 1000
          lastTs = now; lastBytes = fileBytes
          emit('download', fileBytes, fileTotal)
        }
        cb(null, chunk)
      },
    })
    const out = fs.createWriteStream(partPath, { flags: append ? 'a' : 'w' })
    await pipeline(Readable.fromWeb(res.body as any), counter, out, { signal })
    emit('download', fileBytes, fileTotal)

    // ── Extract + place ──
    emit('extract', fileTotal || fileBytes, fileTotal || fileBytes)
    await fsp.rename(partPath, zipPath)
    const tmp = path.join(dlDir, `${a.dir}__x`)
    await rmrf(tmp)
    await fsp.mkdir(tmp, { recursive: true })
    await extractZip(zipPath, tmp)
    const src = await locateModelDir(tmp, a.dir)
    await fsp.rename(src, path.join(ckptDir, a.dir))
    await rmrf(tmp)
    await rmrf(zipPath)

    completedBytes += fileTotal || fileBytes
    lastBytes = 0; lastTs = Date.now()
  }

  await rmrf(dlDir)
  onProgress({ phase: 'done', fileIndex: pending.length, fileCount: pending.length, overallBytes: overallTotal, overallTotal, pct: 100 })
}
