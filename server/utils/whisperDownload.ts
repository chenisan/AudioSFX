import * as fs from 'fs'
import * as fsp from 'fs/promises'
import * as path from 'path'
import * as https from 'https'
import * as http from 'http'
import { execSync } from 'child_process'
import { getDataDir } from './dataDir'

const WHISPER_VERSION = 'v1.8.4'
const REPO = 'ggml-org/whisper.cpp'

const BINARY_URLS: Record<string, string> = {
  cpu: `https://github.com/${REPO}/releases/download/${WHISPER_VERSION}/whisper-bin-x64.zip`,
  cuda: `https://github.com/${REPO}/releases/download/${WHISPER_VERSION}/whisper-cublas-12.4.0-bin-x64.zip`,
}

const MODEL_BASE_URL = `https://huggingface.co/ggerganov/whisper.cpp/resolve/main`
const MODELS: Record<string, { file: string; size: string }> = {
  base:   { file: 'ggml-base.bin',   size: '142 MB' },
  small:  { file: 'ggml-small.bin',  size: '466 MB' },
  medium: { file: 'ggml-medium.bin', size: '1.5 GB' },
}

/** Get the directory where whisper binary and models are stored */
export function getWhisperDir(): string {
  // In Electron: userData/whisper, otherwise: data/whisper
  return path.join(getDataDir(), 'whisper')
}

/** Get the expected whisper binary path.
 *  Prefers `bin/Release/whisper-cli.exe` (real binary + DLLs) over `bin/whisper-cli.exe`
 *  (which may be a 28KB deprecation-warning stub in recent whisper.cpp releases).
 */
export function getWhisperBinPath(): string {
  const binDir = path.join(getWhisperDir(), 'bin')
  const releaseBin = path.join(binDir, 'Release', 'whisper-cli.exe')
  if (fs.existsSync(releaseBin)) return releaseBin
  return path.join(binDir, 'whisper-cli.exe')
}

/** Get the expected model path */
export function getModelPath(model: string = 'base'): string {
  const m = MODELS[model] || MODELS.base
  return path.join(getWhisperDir(), 'models', m.file)
}

/** Check if whisper binary is installed */
export function isWhisperInstalled(): boolean {
  const binPath = getWhisperBinPath()
  if (!fs.existsSync(binPath)) return false
  try {
    execSync(`"${binPath}" --version`, { timeout: 5000, stdio: 'pipe' })
    return true
  } catch (e: any) {
    // whisper-cli may exit non-zero but still be functional
    return e.status != null && e.status <= 1 && !!(e.stdout || e.stderr)
  }
}

/** Check if a model is downloaded */
export function isModelDownloaded(model: string = 'base'): boolean {
  return fs.existsSync(getModelPath(model))
}

/** Get full status */
export function getWhisperStatus() {
  const binPath = getWhisperBinPath()
  const installed = isWhisperInstalled()
  const models = Object.entries(MODELS).map(([id, m]) => ({
    id,
    file: m.file,
    size: m.size,
    downloaded: fs.existsSync(getModelPath(id)),
    path: getModelPath(id),
  }))
  return { installed, binPath, models, version: WHISPER_VERSION }
}

/** Download a file with progress callback, following redirects */
function downloadFile(url: string, dest: string, onProgress?: (pct: number) => void): Promise<void> {
  return new Promise((resolve, reject) => {
    const dir = path.dirname(dest)
    fs.mkdirSync(dir, { recursive: true })
    const file = fs.createWriteStream(dest)

    const get = (u: string, redirects = 0) => {
      if (redirects > 5) return reject(new Error('Too many redirects'))
      const mod = u.startsWith('https') ? https : http
      mod.get(u, (res) => {
        if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          return get(res.headers.location, redirects + 1)
        }
        if (res.statusCode !== 200) {
          file.close()
          fs.unlinkSync(dest)
          return reject(new Error(`Download failed: HTTP ${res.statusCode}`))
        }
        const total = parseInt(res.headers['content-length'] || '0', 10)
        let downloaded = 0
        res.on('data', (chunk: Buffer) => {
          downloaded += chunk.length
          if (total > 0 && onProgress) onProgress(Math.round((downloaded / total) * 100))
        })
        res.pipe(file)
        file.on('finish', () => { file.close(); resolve() })
      }).on('error', (err) => { file.close(); fs.unlinkSync(dest); reject(err) })
    }
    get(url)
  })
}

/** Download and extract whisper binary */
export async function downloadWhisperBinary(
  variant: 'cpu' | 'cuda' = 'cpu',
  onProgress?: (pct: number) => void
): Promise<string> {
  const whisperDir = getWhisperDir()
  const binDir = path.join(whisperDir, 'bin')
  const zipPath = path.join(whisperDir, 'whisper-bin.zip')

  await fsp.mkdir(binDir, { recursive: true })

  // Download zip
  const url = BINARY_URLS[variant]
  await downloadFile(url, zipPath, onProgress)

  // Extract using tar (Windows 10+ has tar built-in for zip)
  try {
    execSync(`tar -xf "${zipPath}" -C "${binDir}"`, { stdio: 'pipe' })
  } catch {
    // Fallback: try PowerShell
    execSync(
      `powershell -command "Expand-Archive -Path '${zipPath}' -DestinationPath '${binDir}' -Force"`,
      { stdio: 'pipe' }
    )
  }

  // Clean up zip
  await fsp.unlink(zipPath).catch(() => {})

  // Find the whisper-cli.exe (might be in a subdirectory)
  const binPath = getWhisperBinPath()
  if (!fs.existsSync(binPath)) {
    // Search for it in extracted contents
    const findBin = (dir: string): string | null => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name)
        if (entry.isDirectory()) {
          const found = findBin(full)
          if (found) return found
        } else if (entry.name === 'whisper-cli.exe' || entry.name === 'main.exe') {
          return full
        }
      }
      return null
    }
    const found = findBin(binDir)
    if (found && found !== binPath) {
      // Move to expected location
      await fsp.rename(found, binPath)
    }
  }

  if (!fs.existsSync(binPath)) {
    throw new Error('whisper-cli.exe not found after extraction')
  }

  return binPath
}

/** Download a whisper model */
export async function downloadModel(
  model: string = 'base',
  onProgress?: (pct: number) => void
): Promise<string> {
  const m = MODELS[model]
  if (!m) throw new Error(`Unknown model: ${model}. Available: ${Object.keys(MODELS).join(', ')}`)

  const modelPath = getModelPath(model)
  await fsp.mkdir(path.dirname(modelPath), { recursive: true })

  const url = `${MODEL_BASE_URL}/${m.file}`
  await downloadFile(url, modelPath, onProgress)

  return modelPath
}
