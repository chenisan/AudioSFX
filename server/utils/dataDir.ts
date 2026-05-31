import * as path from 'path'

let _cached: string | null = null

/**
 * Returns the absolute path to the data directory.
 * Priority:
 *   1. VIDEO_ENGINE_DATA_DIR (explicit override — dev/test/CI)
 *   2. ELECTRON_USER_DATA_DIR (set by electron/main.js on packaged builds)
 *   3. process.cwd() + '/data' (dev mode default)
 */
export function getDataDir(): string {
  if (_cached) return _cached
  const explicit = process.env.VIDEO_ENGINE_DATA_DIR
  const electronUserData = process.env.ELECTRON_USER_DATA_DIR
  _cached = path.resolve(
    explicit
    ?? electronUserData
    ?? path.join(process.cwd(), 'data')
  )
  return _cached
}

/** Reset cache — for tests that mutate env vars between cases. */
export function _resetDataDirCache(): void {
  _cached = null
}
