/**
 * Lands generated audio into the project's asset dir (so it shows up like any
 * imported asset and is served at /assets/<projectId>/<filename>) and probes
 * its duration so the UI can place an aligned clip without a refresh round-trip.
 */
import * as fs from 'fs/promises'
import * as path from 'path'
import { getAssetDir } from '../core/projectManager'
import { getMediaInfo } from '../utils/ffprobe'
import type { GenResult } from './audioGenClient'

export interface SavedAudio {
  filename: string
  durationSec: number
  genSeconds: number | null
}

function slugify(name: string): string {
  const s = (name || 'sfx').trim().toLowerCase().replace(/[^\w一-鿿]+/g, '_').replace(/^_+|_+$/g, '')
  return (s || 'sfx').slice(0, 40)
}

// User-supplied filename: keep it recognizable (preserve case, no timestamp)
// while staying path/ffmpeg-safe. Drops any typed extension, maps unsafe chars
// to '_', no spaces.
function sanitizeName(name: string): string {
  const s = (name || '').trim()
    .replace(/\.[a-zA-Z0-9]{1,4}$/, '')          // drop a typed extension (e.g. ".mp3")
    .replace(/[^\w一-鿿.-]+/g, '_')               // keep word/CJK/dot/dash; others → _
    .replace(/^[_.]+|[_.]+$/g, '')                // trim leading/trailing _ or .
  return s.slice(0, 60)
}

async function pathExists(p: string): Promise<boolean> {
  try { await fs.access(p); return true } catch { return false }
}

// Resolve `<base>.<ext>`, appending `-2`, `-3`… on collision so a user-named
// file never silently overwrites an earlier one.
async function uniqueName(dir: string, base: string, ext: string): Promise<string> {
  let candidate = `${base}.${ext}`
  let n = 2
  while (await pathExists(path.join(dir, candidate))) {
    candidate = `${base}-${n}.${ext}`
    n++
  }
  return candidate
}

/**
 * @param stamp  caller-supplied timestamp (ms) for a unique auto filename —
 *               passed in rather than read here so the auto path stays testable.
 * @param opts.exactName  when true, `baseName` is a user-chosen filename: use it
 *               verbatim (sanitized, case preserved, no timestamp), deduped on
 *               collision. When false/omitted, auto-name as `<slug>_<stamp>`.
 */
export async function saveGeneratedAudio(
  projectId: string,
  result: GenResult,
  baseName: string,
  stamp: number,
  opts?: { exactName?: boolean },
): Promise<SavedAudio> {
  const dir = getAssetDir(projectId)
  await fs.mkdir(dir, { recursive: true })
  const filename = opts?.exactName
    ? await uniqueName(dir, sanitizeName(baseName) || 'sfx', result.ext)
    : `${slugify(baseName)}_${stamp}.${result.ext}`
  const abs = path.join(dir, filename)
  await fs.writeFile(abs, result.buf)

  // Prefer the duration the service reported; otherwise probe (e.g. text-SFX).
  let durationSec = result.durationSec ?? 0
  if (!durationSec) {
    try {
      durationSec = (await getMediaInfo(abs)).duration || 0
    } catch {
      durationSec = 0
    }
  }
  return { filename, durationSec, genSeconds: result.genSeconds }
}
