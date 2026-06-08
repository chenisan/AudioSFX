// Bundled CC0 SFX library (Kenney.nl, public domain).
//
// The library ships read-only inside the app (repo `assets/sfx-library/` in dev;
// `resources/sfx-library/` in the packaged build, via SFX_LIBRARY_DIR set by
// electron/main.js). It's a SOURCE of assets — importing an item copies the file
// into a project's assets/ dir, where it becomes an ordinary audio asset and
// follows the normal asset → timeline clip path. Nothing library-specific lands
// in the project schema (生成單位 vs 剪輯單位 separation).
import * as path from 'path'
import * as fs from 'fs'
import * as fsp from 'fs/promises'
import { getAssetDir } from './projectManager'

export interface SfxLibraryItem {
  id: string
  name: string
  category: string
  tags: string[]
  file: string
  durationSec?: number
}

export interface SfxLibraryCategory { id: string; zh: string; en: string }

export interface SfxLibraryManifest {
  version: number
  license: string
  source: string
  url: string
  categories: SfxLibraryCategory[]
  items: SfxLibraryItem[]
}

let _dir: string | null = null
export function getLibraryDir(): string {
  if (_dir) return _dir
  _dir = path.resolve(
    process.env.SFX_LIBRARY_DIR
    ?? path.join(process.cwd(), 'assets', 'sfx-library')
  )
  return _dir
}

let _manifest: SfxLibraryManifest | null = null
export function getManifest(): SfxLibraryManifest {
  if (_manifest) return _manifest
  const p = path.join(getLibraryDir(), 'manifest.json')
  _manifest = JSON.parse(fs.readFileSync(p, 'utf-8')) as SfxLibraryManifest
  return _manifest
}

let _index: Map<string, SfxLibraryItem> | null = null
function itemById(id: string): SfxLibraryItem | undefined {
  if (!_index) {
    _index = new Map()
    for (const it of getManifest().items) _index.set(it.id, it)
  }
  return _index.get(id)
}

/** Resolve a manifest id to its on-disk file, guarding against traversal. */
export function resolveLibraryFile(id: string): { item: SfxLibraryItem; abs: string } | null {
  const item = itemById(id)
  if (!item) return null
  const filesDir = path.join(getLibraryDir(), 'files')
  const abs = path.resolve(filesDir, item.file)
  // item.file is from our own manifest, but double-check containment anyway.
  if (abs !== path.join(filesDir, path.basename(item.file))) return null
  if (!fs.existsSync(abs)) return null
  return { item, abs }
}

/** Copy a library sound into a project's assets/ dir → becomes a normal asset. */
export async function importToProject(
  projectId: string,
  id: string
): Promise<{ filename: string; durationSec?: number; name: string }> {
  const r = resolveLibraryFile(id)
  if (!r) throw new Error(`unknown sfx library id: ${id}`)
  const dir = getAssetDir(projectId)
  await fsp.mkdir(dir, { recursive: true })
  await fsp.copyFile(r.abs, path.join(dir, r.item.file))
  return { filename: r.item.file, durationSec: r.item.durationSec, name: r.item.name }
}
