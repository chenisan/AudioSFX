// Frontend helpers for the track effect plugin chain (track.plugins[]).
//
// MIRROR: server/core/ffmpegBuilder.ts `eqFromTrack` is the render-side twin of
// `eqFromTrack` here. Keep the two in sync — same rule decides which EQ the
// preview hears vs. what the export bakes in.
//
// A track carrying audio hosts an ordered chain of plugins applied in array
// order. Each plugin: { id, type, enabled, params }. `enabled` is the single
// on/off source of truth (params hold no enabled flag).

export const DEFAULT_EQ_BANDS = [
  { type: 'lowshelf',  freq: 80,   gain: 0, q: 0.7 },
  { type: 'peaking',   freq: 250,  gain: 0, q: 1.0 },
  { type: 'peaking',   freq: 1000, gain: 0, q: 1.0 },
  { type: 'peaking',   freq: 3500, gain: 0, q: 1.0 },
  { type: 'highshelf', freq: 8000, gain: 0, q: 0.7 },
]

export function getPlugins(track) {
  return Array.isArray(track?.plugins) ? track.plugins : []
}

export function findPlugin(track, type) {
  return getPlugins(track).find(p => p?.type === type)
}

// Fold a track's enabled EQ into {enabled, bands} for the preview engine /
// render, or undefined when there's no enabled eq plugin. Falls back to the
// legacy track.eq field for data that predates the load-time migration.
export function eqFromTrack(track) {
  const plugins = track?.plugins
  if (Array.isArray(plugins)) {
    const p = plugins.find(pl => pl?.type === 'eq' && pl?.enabled)
    if (p?.params?.bands) return { enabled: true, bands: p.params.bands }
    return undefined
  }
  return track?.eq
}

let _idc = 0
export function newPluginId(type) {
  _idc += 1
  return `${type}_${_idc}_${Math.random().toString(36).slice(2, 7)}`
}

// Default plugin instances keyed by type. Compressor/Limiter wired up in Step 2.
export function makeEqPlugin() {
  return {
    id: newPluginId('eq'),
    type: 'eq',
    enabled: true,
    params: { bands: DEFAULT_EQ_BANDS.map(b => ({ ...b })) },
  }
}

export function makeCompressorPlugin() {
  return {
    id: newPluginId('compressor'),
    type: 'compressor',
    enabled: true,
    params: { threshold: -24, ratio: 3, attack: 10, release: 100, knee: 6, makeup: 0 },
  }
}

export function makeLimiterPlugin() {
  return {
    id: newPluginId('limiter'),
    type: 'limiter',
    enabled: true,
    params: { threshold: -1, release: 50 },
  }
}

export function makeReverbPlugin() {
  return {
    id: newPluginId('reverb'),
    type: 'reverb',
    enabled: true,
    // FabFilter Pro-R-inspired set. space in seconds; rest in %; predelay ms.
    params: { predelay: 20, space: 2.0, character: 50, brightness: 60, thickness: 30, width: 80, mix: 25 },
  }
}

// type → factory, for the "add effect" menu.
export function makePlugin(type) {
  if (type === 'eq') return makeEqPlugin()
  if (type === 'compressor') return makeCompressorPlugin()
  if (type === 'limiter') return makeLimiterPlugin()
  if (type === 'reverb') return makeReverbPlugin()
  return null
}

export const PLUGIN_LABELS = {
  eq: 'EQ',
  compressor: '壓縮器',
  limiter: '限幅器',
  reverb: '殘響',
}
