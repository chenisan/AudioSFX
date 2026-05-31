import * as path from 'path'

export function sanitizeFilename(name: string, fallback = 'file'): string {
  const normalized = String(name ?? '').replace(/\\/g, '/')
  const base = (normalized.split('/').pop() ?? '').replace(/\0/g, '').trim()
  const cleaned = base.replace(/[<>:"/\\|?*\x00-\x1F]/g, '_')
  if (!cleaned || cleaned === '.' || cleaned === '..') return fallback
  return cleaned
}

export function resolveUnderRoot(root: string, relativePath: string): string | null {
  if (!relativePath || relativePath.includes('\0')) return null

  let decoded = relativePath
  try { decoded = decodeURIComponent(relativePath) } catch {}
  if (path.isAbsolute(decoded)) return null

  const rootAbs = path.resolve(root)
  const candidate = path.resolve(rootAbs, decoded)
  const rel = path.relative(rootAbs, candidate)
  // rel === '' means candidate IS the root directory — reject so callers
  // who fs.readFileSync the result don't blow up with EISDIR. Any legitimate
  // file under root has at least one path segment of relative offset.
  if (rel === '') return null
  if (!rel.startsWith('..') && !path.isAbsolute(rel)) return candidate
  return null
}
