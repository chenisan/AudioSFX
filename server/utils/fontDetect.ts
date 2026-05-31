import * as fs from 'fs'
import * as path from 'path'

// Bundled-font candidate dirs. Works in:
//   - dev: process.cwd() is project root
//   - Electron packaged: process.resourcesPath
//   - bundled node (esbuild): __dirname walks up to project root
function bundledFontDirs(): string[] {
  const dirs: string[] = []
  const resourcesPath = (process as any).resourcesPath
  if (resourcesPath) dirs.push(path.join(resourcesPath, 'assets', 'fonts'))
  dirs.push(path.join(process.cwd(), 'assets', 'fonts'))
  dirs.push(path.resolve(__dirname, '..', '..', 'assets', 'fonts'))
  return dirs
}

const BUNDLED_FONT_FILES = [
  'NotoSansTC-Bold.ttf',
  'NotoSansTC-Regular.ttf',
  'NotoSansTC-VF.ttf',
]

function buildFontSearchPaths(): string[] {
  const paths: string[] = []
  for (const dir of bundledFontDirs()) {
    for (const name of BUNDLED_FONT_FILES) paths.push(path.join(dir, name))
  }
  paths.push(
    'C:/Windows/Fonts/NotoSansTC-Bold.ttf',
    'C:/Windows/Fonts/NotoSansTC-Regular.ttf',
    'C:/Windows/Fonts/NotoSansTC-Medium.ttf',
    'C:/Windows/Fonts/NotoSansTC-VF.ttf',
    'C:/Windows/Fonts/NotoSansHK-VF.ttf',
    'C:/Windows/Fonts/msyhbd.ttc',
    'C:/Windows/Fonts/msyh.ttc',
    'C:/Windows/Fonts/arial.ttf',
  )
  return paths
}

const FONT_SEARCH_PATHS = buildFontSearchPaths()

let _cachedFontPath: string | null = null

export function detectCjkFont(): string {
  if (_cachedFontPath) return _cachedFontPath

  for (const p of FONT_SEARCH_PATHS) {
    if (fs.existsSync(p)) {
      _cachedFontPath = p
      console.log(`[font] Using font: ${p}`)
      return p
    }
  }

  // Last resort: return a path that ffmpeg can try with fontconfig
  console.warn('[font] WARNING: No CJK font found. Chinese text may not render correctly.')
  console.warn('[font] Install Noto Sans TC and place in assets/fonts/ or C:/Windows/Fonts/')
  _cachedFontPath = 'C:/Windows/Fonts/arial.ttf'
  return _cachedFontPath
}

/**
 * Escape font path for ffmpeg drawtext filter on Windows.
 * Drive letter colon must be escaped: C:/path → C\:/path
 */
export function escapeFontPath(fontPath: string): string {
  return fontPath
    .replace(/\\/g, '/')
    .replace(/^([A-Za-z]):/, '$1\\:')
}
