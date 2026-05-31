import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'
import * as crypto from 'crypto'
import { getDataDir } from './dataDir'

// AES-256-GCM encrypted secret storage in data/settings.json.
// Encryption key is derived from the host machine (hostname + platform + arch),
// so a settings.json copied to a different machine will not decrypt — even
// though the file format is the same. This is "casual leak protection",
// not a defense against an attacker with full local access.

// Resolved lazily on each read/write — tests swap VIDEO_ENGINE_DATA_DIR
// between cases, and a module-level cache would lock the path to whichever
// dir was current when this module first loaded (causing cross-test bleed).
function settingsPath(): string {
  return path.join(getDataDir(), 'settings.json')
}
const APP_SALT = '13soul-video-engine/v1'
const KDF_ITER = 100_000

interface EncryptedBlob {
  iv: string      // base64
  tag: string     // base64
  data: string    // base64
}

interface SettingsShape {
  secrets?: Record<string, EncryptedBlob>
  [k: string]: any
}

// .env fallback so dev workflow works before SettingsModal UI lands.
const ENV_FALLBACK: Record<string, string> = {
  anthropic: 'ANTHROPIC_API_KEY',
  openai:    'OPENAI_API_KEY',
  kling_ak:  'KLING_ACCESS_KEY',
  kling_sk:  'KLING_SECRET_KEY',
  runway:    'RUNWAY_API_KEY',
  gemini:    'GEMINI_API_KEY',
  seedance:  'SEEDANCE_API_KEY',
}

let cachedKey: Buffer | null = null

function deriveKey(): Buffer {
  if (cachedKey) return cachedKey
  const material = `${os.hostname()}|${os.platform()}|${os.arch()}|${APP_SALT}`
  cachedKey = crypto.pbkdf2Sync(material, APP_SALT, KDF_ITER, 32, 'sha256')
  return cachedKey
}

function readSettings(): SettingsShape {
  try {
    return JSON.parse(fs.readFileSync(settingsPath(), 'utf-8'))
  } catch {
    return {}
  }
}

function writeSettings(s: SettingsShape) {
  const p = settingsPath()
  fs.mkdirSync(path.dirname(p), { recursive: true })
  fs.writeFileSync(p, JSON.stringify(s, null, 2))
}

export function setSecret(name: string, plaintext: string): void {
  if (!plaintext) {
    removeSecret(name)
    return
  }
  const key = deriveKey()
  const iv = crypto.randomBytes(12)
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv)
  const enc = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()
  const blob: EncryptedBlob = {
    iv: iv.toString('base64'),
    tag: tag.toString('base64'),
    data: enc.toString('base64'),
  }
  const s = readSettings()
  s.secrets = { ...(s.secrets ?? {}), [name]: blob }
  writeSettings(s)
}

export function getSecret(name: string): string | undefined {
  const s = readSettings()
  const blob = s.secrets?.[name]
  if (blob) {
    try {
      const key = deriveKey()
      const iv = Buffer.from(blob.iv, 'base64')
      const tag = Buffer.from(blob.tag, 'base64')
      const data = Buffer.from(blob.data, 'base64')
      const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv)
      decipher.setAuthTag(tag)
      const dec = Buffer.concat([decipher.update(data), decipher.final()])
      return dec.toString('utf-8')
    } catch {
      // tampered / wrong machine — fall through to env
    }
  }
  const envName = ENV_FALLBACK[name]
  if (envName && process.env[envName]) return process.env[envName] as string
  return undefined
}

export function hasSecret(name: string): boolean {
  return getSecret(name) !== undefined
}

export function removeSecret(name: string): void {
  const s = readSettings()
  if (s.secrets && name in s.secrets) {
    delete s.secrets[name]
    writeSettings(s)
  }
}

// Returns names of all configured secrets WITHOUT exposing values. Used by
// SettingsModal to show "✓ Configured" badges.
export function listSecretNames(): string[] {
  const s = readSettings()
  const fromFile = Object.keys(s.secrets ?? {})
  const fromEnv = Object.entries(ENV_FALLBACK)
    .filter(([, envName]) => !!process.env[envName])
    .map(([name]) => name)
  return Array.from(new Set([...fromFile, ...fromEnv]))
}

// Diagnostic: which storage layer holds a given secret. Useful for UI
// to distinguish "stored encrypted" vs "from .env (plain)".
export function getSecretSource(name: string): 'settings' | 'env' | 'none' {
  const s = readSettings()
  if (s.secrets?.[name]) {
    // verify it actually decrypts
    try {
      const blob = s.secrets[name]
      const key = deriveKey()
      const iv = Buffer.from(blob.iv, 'base64')
      const tag = Buffer.from(blob.tag, 'base64')
      const data = Buffer.from(blob.data, 'base64')
      const d = crypto.createDecipheriv('aes-256-gcm', key, iv)
      d.setAuthTag(tag)
      d.update(data)
      d.final()
      return 'settings'
    } catch { /* fall through */ }
  }
  if (ENV_FALLBACK[name] && process.env[ENV_FALLBACK[name]]) return 'env'
  return 'none'
}
