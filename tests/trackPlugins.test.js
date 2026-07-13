// 音軌效果鏈（track.plugins[]）前端 helper 的單元測試。
//
// 守住 CLAUDE.md「預覽 / 匯出鏡像」第 5 條的**前端側**：
//   src/utils/trackPlugins.js `eqFromTrack`
//     ↔ server/core/ffmpegBuilder.ts 的 EQ 映射（後端側，待加 export 後補測）
// 這裡鎖住 eqFromTrack 的折疊規則與 legacy 遷移 fallback，避免改壞預覽。

import { describe, it, expect } from 'vitest'
import {
  DEFAULT_EQ_BANDS,
  getPlugins,
  findPlugin,
  eqFromTrack,
  makeEqPlugin,
  makeCompressorPlugin,
  makeLimiterPlugin,
  makePlugin,
  PLUGIN_LABELS,
} from '../src/utils/trackPlugins.js'

describe('getPlugins', () => {
  it('回傳 track.plugins 陣列', () => {
    const track = { plugins: [{ id: 'a', type: 'eq', enabled: true, params: {} }] }
    expect(getPlugins(track)).toHaveLength(1)
  })

  it('plugins 缺失 / 非陣列 / track 為空時一律回空陣列', () => {
    expect(getPlugins(undefined)).toEqual([])
    expect(getPlugins(null)).toEqual([])
    expect(getPlugins({})).toEqual([])
    expect(getPlugins({ plugins: 'nope' })).toEqual([])
  })
})

describe('findPlugin', () => {
  const track = {
    plugins: [
      { id: 'e', type: 'eq', enabled: true, params: {} },
      { id: 'c', type: 'compressor', enabled: false, params: {} },
    ],
  }
  it('依 type 找到第一個 plugin（不論 enabled）', () => {
    expect(findPlugin(track, 'eq')?.id).toBe('e')
    expect(findPlugin(track, 'compressor')?.id).toBe('c')
  })
  it('找不到回 undefined', () => {
    expect(findPlugin(track, 'limiter')).toBeUndefined()
    expect(findPlugin({}, 'eq')).toBeUndefined()
  })
})

describe('eqFromTrack（鏡像規則：決定預覽聽到哪組 EQ）', () => {
  it('plugins 內有 enabled 的 eq → 折成 { enabled, bands }', () => {
    const bands = DEFAULT_EQ_BANDS.map(b => ({ ...b, gain: 3 }))
    const track = { plugins: [{ id: 'e', type: 'eq', enabled: true, params: { bands } }] }
    expect(eqFromTrack(track)).toEqual({ enabled: true, bands })
  })

  it('eq 存在但 disabled → undefined（預覽不套）', () => {
    const bands = DEFAULT_EQ_BANDS.map(b => ({ ...b }))
    const track = { plugins: [{ id: 'e', type: 'eq', enabled: false, params: { bands } }] }
    expect(eqFromTrack(track)).toBeUndefined()
  })

  it('plugins 是陣列但無 eq → undefined', () => {
    const track = { plugins: [{ id: 'c', type: 'compressor', enabled: true, params: {} }] }
    expect(eqFromTrack(track)).toBeUndefined()
  })

  it('enabled eq 但 params 無 bands → undefined（資料不完整不硬套）', () => {
    const track = { plugins: [{ id: 'e', type: 'eq', enabled: true, params: {} }] }
    expect(eqFromTrack(track)).toBeUndefined()
  })

  it('legacy fallback：無 plugins 陣列時回退舊的 track.eq', () => {
    const legacy = { enabled: true, bands: [{ type: 'peaking', freq: 1000, gain: 2, q: 1 }] }
    expect(eqFromTrack({ eq: legacy })).toBe(legacy)
  })

  it('track 為空時不丟錯，回 undefined', () => {
    expect(eqFromTrack(undefined)).toBeUndefined()
    expect(eqFromTrack({})).toBeUndefined()
  })
})

describe('makePlugin 工廠', () => {
  it('eq 預設 5 段，結構符合 DEFAULT_EQ_BANDS', () => {
    const p = makeEqPlugin()
    expect(p.type).toBe('eq')
    expect(p.enabled).toBe(true)
    expect(p.params.bands).toHaveLength(5)
    expect(p.params.bands.map(b => b.type)).toEqual([
      'lowshelf', 'peaking', 'peaking', 'peaking', 'highshelf',
    ])
    // 工廠須複製 bands，不可共用同一份參考（改一軌不該動到別軌）
    expect(p.params.bands).not.toBe(DEFAULT_EQ_BANDS)
    expect(p.params.bands[0]).not.toBe(DEFAULT_EQ_BANDS[0])
  })

  it('compressor 預設參數齊全', () => {
    const p = makeCompressorPlugin()
    expect(p.type).toBe('compressor')
    expect(p.params).toMatchObject({
      threshold: -24, ratio: 3, attack: 10, release: 100, knee: 6, makeup: 0,
    })
  })

  it('limiter 預設 ceiling -1dB', () => {
    const p = makeLimiterPlugin()
    expect(p.type).toBe('limiter')
    expect(p.params).toMatchObject({ threshold: -1, release: 50 })
  })

  it('makePlugin(type) 分派到對應工廠，未知型態回 null', () => {
    expect(makePlugin('eq')?.type).toBe('eq')
    expect(makePlugin('compressor')?.type).toBe('compressor')
    expect(makePlugin('limiter')?.type).toBe('limiter')
    expect(makePlugin('reverb')?.type).toBe('reverb')
    expect(makePlugin('nope')).toBeNull()
  })

  it('SFX 型態都有工廠，預設值鏡像 ffmpegBuilder 端', () => {
    const sfx = ['delay', 'distortion', 'filter', 'tremolo', 'chorus', 'flanger', 'gate', 'pitch']
    for (const t of sfx) {
      const p = makePlugin(t)
      expect(p?.type).toBe(t)
      expect(p?.enabled).toBe(true)
      expect(p?.id).toBeTruthy()
    }
    expect(makePlugin('delay').params).toEqual({ time: 350, feedback: 35, mix: 30 })
    expect(makePlugin('distortion').params).toEqual({ drive: 40, tone: 60, output: 0 })
    expect(makePlugin('filter').params).toEqual({ mode: 'lowpass', freq: 1000, q: 0.7 })
    expect(makePlugin('tremolo').params).toEqual({ rate: 5, depth: 50 })
    expect(makePlugin('chorus').params).toEqual({ rate: 0.8, depth: 3, mix: 40 })
    expect(makePlugin('flanger').params).toEqual({ rate: 0.5, depth: 2, feedback: 50, mix: 60 })
    expect(makePlugin('gate').params).toEqual({ threshold: -40, ratio: 4, attack: 5, release: 100 })
    expect(makePlugin('pitch').params).toEqual({ semitones: 0 })
  })

  it('makePlugin 每次回新的 params 物件（不共用預設）', () => {
    const a = makePlugin('delay'), b = makePlugin('delay')
    a.params.time = 999
    expect(b.params.time).toBe(350)
  })

  it('每次產生的 id 不重複', () => {
    const ids = new Set([makeEqPlugin().id, makeEqPlugin().id, makeCompressorPlugin().id])
    expect(ids.size).toBe(3)
  })
})

describe('PLUGIN_LABELS', () => {
  it('涵蓋全部 12 種型態', () => {
    expect(Object.keys(PLUGIN_LABELS).sort()).toEqual([
      'chorus', 'compressor', 'delay', 'distortion', 'eq', 'filter',
      'flanger', 'gate', 'limiter', 'pitch', 'reverb', 'tremolo',
    ])
  })
})
