// User's local SFX folder (e.g. D:\sfx_sample with Sonniss/99sounds packs).
//
// NOT bundled with AudioSFX and NOT in git — the user points the app at a folder
// of their own sounds. Same model as the bundled CC0 library: a read-only SOURCE
// of assets. Importing copies a file into the project's assets/ dir, where it
// becomes an ordinary audio asset (生成單位 vs 剪輯單位 separation preserved).
import * as path from 'path'
import * as fs from 'fs'
import * as fsp from 'fs/promises'
import { getAssetDir } from './projectManager'
import { getMediaInfo } from '../utils/ffprobe'

const AUDIO = new Set(['.wav', '.aif', '.aiff', '.mp3', '.ogg', '.flac', '.m4a', '.aac'])
const MAX_ITEMS = 8000   // cap JSON size for huge libraries (e.g. full Sonniss archive)

export interface LocalItem { id: string; name: string; category: string }
export interface LocalScan {
  dir: string
  available: boolean
  count: number
  truncated: boolean
  categories: { id: string; count: number }[]
  items: LocalItem[]
}

function walk(root: string, dir: string, out: { items: LocalItem[]; truncated: boolean }) {
  let entries: fs.Dirent[]
  try { entries = fs.readdirSync(dir, { withFileTypes: true }) } catch { return }
  for (const e of entries) {
    if (out.items.length >= MAX_ITEMS) { out.truncated = true; return }
    if (e.name.startsWith('.')) continue
    const full = path.join(dir, e.name)
    if (e.isDirectory()) {
      walk(root, full, out)
      if (out.truncated) return
    } else if (AUDIO.has(path.extname(e.name).toLowerCase())) {
      const rel = path.relative(root, full)
      const parent = path.basename(path.dirname(full))
      out.items.push({
        id: rel.split(path.sep).join('/'),                 // forward-slash relpath
        name: e.name.replace(/\.[^.]+$/, ''),
        category: parent && parent !== '.' ? parent : '(root)',
      })
    }
  }
}

let _cache: { dir: string; at: number; scan: LocalScan } | null = null

export function scanLocal(root: string, opts: { refresh?: boolean } = {}): LocalScan {
  const empty = (dir: string, available: boolean): LocalScan =>
    ({ dir, available, count: 0, truncated: false, categories: [], items: [] })
  if (!root) return empty('', false)
  const abs = path.resolve(root)
  if (!fs.existsSync(abs)) return empty(abs, false)
  if (!opts.refresh && _cache && _cache.dir === abs && Date.now() - _cache.at < 60_000) {
    return _cache.scan
  }
  const out = { items: [] as LocalItem[], truncated: false }
  walk(abs, abs, out)
  const catMap: Record<string, number> = {}
  for (const it of out.items) catMap[it.category] = (catMap[it.category] || 0) + 1
  const categories = Object.entries(catMap)
    .map(([id, count]) => ({ id, count }))
    .sort((a, b) => a.id.localeCompare(b.id))
  const scan: LocalScan = {
    dir: abs, available: true, count: out.items.length,
    truncated: out.truncated, categories, items: out.items,
  }
  _cache = { dir: abs, at: Date.now(), scan }
  return scan
}

/** Resolve a relpath id within root, guarding against traversal. */
export function resolveLocal(root: string, id: string): string | null {
  if (!root || typeof id !== 'string' || !id) return null
  const abs = path.resolve(root)
  const target = path.resolve(abs, id)
  if (target !== abs && !target.startsWith(abs + path.sep)) return null
  if (!fs.existsSync(target) || !fs.statSync(target).isFile()) return null
  return target
}

export async function importLocal(
  root: string, projectId: string, id: string
): Promise<{ filename: string; durationSec?: number }> {
  const src = resolveLocal(root, id)
  if (!src) throw new Error('file not found in local library')
  const dir = getAssetDir(projectId)
  await fsp.mkdir(dir, { recursive: true })
  let filename = path.basename(src)
  let dest = path.join(dir, filename)
  if (fs.existsSync(dest)) {
    const ext = path.extname(filename)
    const base = filename.slice(0, filename.length - ext.length)
    let i = 1
    while (fs.existsSync(path.join(dir, `${base}_${i}${ext}`))) i++
    filename = `${base}_${i}${ext}`
    dest = path.join(dir, filename)
  }
  await fsp.copyFile(src, dest)
  let durationSec: number | undefined
  try { durationSec = (await getMediaInfo(dest)).duration } catch {}
  return { filename, durationSec }
}
