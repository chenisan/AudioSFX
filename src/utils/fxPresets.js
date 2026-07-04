// Effect-chain presets for the track inspector (the amp-head preset rail).
//
// A preset is a named template of a plugin chain (array of {type, enabled,
// params}, ids stripped). Built-ins ship in code; user presets live in
// localStorage. Applying a preset clones the chain with fresh ids so it becomes
// an ordinary track.plugins[] value — nothing preset-specific touches the
// render contract / project.yaml.

import { newPluginId } from './trackPlugins'

const LS_KEY = '13soul.fxPresets'

// ── Built-in chains ────────────────────────────────────────────────────────
const eq = (bands) => ({ type: 'eq', enabled: true, params: { bands } })
const comp = (p) => ({ type: 'compressor', enabled: true, params: p })
const lim = (p = { threshold: -1, release: 50 }) => ({ type: 'limiter', enabled: true, params: p })

export const BUILTIN_PRESETS = [
  {
    name: '人聲 Vocal',
    builtin: true,
    chain: [
      eq([
        { type: 'lowshelf',  freq: 90,   gain: -3, q: 0.7 },  // trim rumble
        { type: 'peaking',   freq: 250,  gain: -2, q: 1.0 },  // de-mud
        { type: 'peaking',   freq: 1000, gain: 0,  q: 1.0 },
        { type: 'peaking',   freq: 3500, gain: 3,  q: 1.2 },  // presence
        { type: 'highshelf', freq: 8000, gain: 2,  q: 0.7 },  // air
      ]),
      comp({ threshold: -20, ratio: 3, attack: 8, release: 120, knee: 6, makeup: 2 }),
      lim(),
    ],
  },
  {
    name: '音樂 Music',
    builtin: true,
    chain: [
      eq([
        { type: 'lowshelf',  freq: 80,    gain: 1,   q: 0.7 },
        { type: 'peaking',   freq: 250,   gain: 0,   q: 1.0 },
        { type: 'peaking',   freq: 1000,  gain: 0,   q: 1.0 },
        { type: 'peaking',   freq: 3500,  gain: 1,   q: 1.0 },
        { type: 'highshelf', freq: 10000, gain: 1.5, q: 0.7 },  // gentle smile
      ]),
      lim({ threshold: -1, release: 80 }),
    ],
  },
  {
    name: 'SFX 音效',
    builtin: true,
    chain: [
      comp({ threshold: -18, ratio: 4, attack: 3, release: 80, knee: 3, makeup: 1 }),  // punch
      lim({ threshold: -1, release: 30 }),
    ],
  },
]

// ── User presets (localStorage) ────────────────────────────────────────────
function loadUser() {
  try {
    const raw = localStorage.getItem(LS_KEY)
    const arr = raw ? JSON.parse(raw) : []
    return Array.isArray(arr) ? arr : []
  } catch { return [] }
}
function saveUser(list) {
  try { localStorage.setItem(LS_KEY, JSON.stringify(list)) } catch {}
}

// Strip ids; keep type/enabled/params so the chain is a clean template.
export function normalizeChain(plugins) {
  return (Array.isArray(plugins) ? plugins : []).map(p => ({
    type: p.type,
    enabled: p.enabled !== false,
    params: p.params ?? {},
  }))
}

export function listPresets() {
  const user = loadUser().map(p => ({ name: p.name, builtin: false }))
  return [...BUILTIN_PRESETS.map(p => ({ name: p.name, builtin: true })), ...user]
}

export function isBuiltin(name) {
  return BUILTIN_PRESETS.some(p => p.name === name)
}

export function getPresetChain(name) {
  const b = BUILTIN_PRESETS.find(p => p.name === name)
  if (b) return b.chain
  const u = loadUser().find(p => p.name === name)
  return u?.chain ?? null
}

export function saveUserPreset(name, plugins) {
  const list = loadUser().filter(p => p.name !== name)
  list.push({ name, chain: normalizeChain(plugins) })
  saveUser(list)
}

export function deleteUserPreset(name) {
  saveUser(loadUser().filter(p => p.name !== name))
}

// Clone a preset chain into a fresh track.plugins[] value (new ids).
export function instantiate(chain) {
  return (chain ?? []).map(p => ({
    id: newPluginId(p.type),
    type: p.type,
    enabled: p.enabled !== false,
    params: JSON.parse(JSON.stringify(p.params ?? {})),
  }))
}

// Compare a live chain to a preset template (ignoring ids) — drives the dirty *.
export function chainMatches(plugins, name) {
  const chain = getPresetChain(name)
  if (!chain) return false
  return JSON.stringify(normalizeChain(plugins)) === JSON.stringify(normalizeChain(chain))
}
