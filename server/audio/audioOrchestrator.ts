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

/**
 * @param stamp  caller-supplied timestamp (ms) for a unique filename — passed
 *               in rather than read here so this stays pure/testable.
 */
export async function saveGeneratedAudio(
  projectId: string,
  result: GenResult,
  baseName: string,
  stamp: number,
): Promise<SavedAudio> {
  const dir = getAssetDir(projectId)
  await fs.mkdir(dir, { recursive: true })
  const filename = `${slugify(baseName)}_${stamp}.${result.ext}`
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
