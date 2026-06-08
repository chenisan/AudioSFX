import { Router } from 'express'
import * as path from 'path'
import * as fs from 'fs'
import { detectHwAccel } from '../utils/hwAccel'
import { detectWhisper } from '../utils/whisper'
import { setSecret, removeSecret, getSecretSource } from '../utils/secretStore'
import { getDataDir } from '../utils/dataDir'

// Secret keys the UI knows about. Used for status reporting and validation
// of POST /secret. Must match ENV_FALLBACK keys in secretStore.ts.
// AudioSFX only consumes 'openai' (live transcription session minting).
const KNOWN_SECRETS = ['openai'] as const
type SecretName = typeof KNOWN_SECRETS[number]

const router = Router()
const DATA_DIR = getDataDir()
const SETTINGS_PATH = path.join(DATA_DIR, 'settings.json')

interface AppSettings {
  hwEncoding: boolean
  hwDecoding: boolean
  gpuPreview: boolean
  proxyEnabled: boolean
  storagePath: string
  whisperPath: string
  whisperModelPath: string
  whisperLanguage: string
  setupComplete: boolean
  /** LeftPanel tab ids the user has chosen to hide. Empty = show all. */
  hiddenLeftTabs: string[]
  /** Local SFX folder the user browses in the「本機」tab. '' = not configured. */
  localSfxDir: string
}

const DEFAULTS: AppSettings = {
  hwEncoding: true,
  hwDecoding: true,
  gpuPreview: true,
  proxyEnabled: false,
  storagePath: DATA_DIR,
  whisperPath: '',
  whisperModelPath: '',
  whisperLanguage: 'zh',
  setupComplete: true,
  hiddenLeftTabs: [],
  localSfxDir: '',
}

function readSettings(): AppSettings {
  try {
    if (fs.existsSync(SETTINGS_PATH)) {
      const raw = JSON.parse(fs.readFileSync(SETTINGS_PATH, 'utf-8'))
      return { ...DEFAULTS, ...raw }
    }
  } catch {}
  return { ...DEFAULTS }
}

function writeSettings(settings: AppSettings) {
  fs.mkdirSync(path.dirname(SETTINGS_PATH), { recursive: true })
  fs.writeFileSync(SETTINGS_PATH, JSON.stringify(settings, null, 2))
}

// GET /api/settings — return current settings + hardware capabilities + secret status
router.get('/', (_req, res) => {
  const settings = readSettings()
  const hw = detectHwAccel()

  // Calculate storage size
  let storageSize = 0
  const projectsDir = path.join(DATA_DIR, 'projects')
  try {
    if (fs.existsSync(projectsDir)) {
      storageSize = getDirSize(projectsDir)
    }
  } catch {}

  // Secret status — never expose values, only "where stored".
  const secretStatus: Record<string, 'settings' | 'env' | 'none'> = {}
  for (const name of KNOWN_SECRETS) {
    secretStatus[name] = getSecretSource(name)
  }

  res.json({
    settings,
    capabilities: {
      nvenc: hw.nvenc,
      cuvid: hw.cuvid,
      whisper: detectWhisper(settings.whisperPath || undefined),
    },
    storageSize,
    storagePath: DATA_DIR,
    secrets: secretStatus,
  })
})

// POST /api/settings/secret — store / overwrite a secret. Admin-only:
// AI API keys are app-wide credentials the owner pays for; non-admin
// customers shouldn't see or rotate them.
//   body: { name: 'anthropic'|..., value: 'sk-...' }
router.post('/secret', (req, res) => {
  const { name, value } = req.body ?? {}
  if (!name || typeof name !== 'string' || !KNOWN_SECRETS.includes(name as SecretName)) {
    return res.status(400).json({ error: `Unknown secret name. Allowed: ${KNOWN_SECRETS.join(', ')}` }) as any
  }
  if (typeof value !== 'string' || !value.trim()) {
    return res.status(400).json({ error: 'value (non-empty string) required' }) as any
  }
  setSecret(name, value.trim())
  res.json({ message: `Secret "${name}" stored (encrypted)`, source: getSecretSource(name) })
})

// DELETE /api/settings/secret/:name — remove an encrypted secret (env still wins if set)
router.delete('/secret/:name', (req, res) => {
  const { name } = req.params
  if (!KNOWN_SECRETS.includes(name as SecretName)) {
    return res.status(400).json({ error: 'unknown secret name' }) as any
  }
  removeSecret(name)
  res.json({ message: `Secret "${name}" removed`, source: getSecretSource(name) })
})

// PUT /api/settings — update settings
router.put('/', (req, res) => {
  const current = readSettings()
  const updated = { ...current, ...req.body }
  writeSettings(updated)
  res.json({ settings: updated })
})

// DELETE /api/settings/cache — clear render cache
router.delete('/cache', (_req, res) => {
  const projectsDir = path.join(DATA_DIR, 'projects')
  let cleared = 0
  try {
    if (fs.existsSync(projectsDir)) {
      for (const pid of fs.readdirSync(projectsDir)) {
        const outputsDir = path.join(projectsDir, pid, 'outputs')
        if (fs.existsSync(outputsDir)) {
          for (const f of fs.readdirSync(outputsDir)) {
            fs.unlinkSync(path.join(outputsDir, f))
            cleared++
          }
        }
      }
    }
  } catch {}
  res.json({ cleared })
})

function getDirSize(dir: string): number {
  let total = 0
  try {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name)
      if (entry.isDirectory()) {
        total += getDirSize(full)
      } else {
        total += fs.statSync(full).size
      }
    }
  } catch {}
  return total
}

export default router
