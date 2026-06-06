import { useRef, useState } from 'react'
import { useProjectStore } from '../../stores/projectStore'
import { getPlugins, makeEqPlugin, PLUGIN_LABELS } from '../../utils/trackPlugins'
import TrackEqPanel from './TrackEqPanel'

// Track effect-chain editor (flyout in the track ⋯more menu). Owns the
// track.plugins array and ALL persistence; child param panels (TrackEqPanel,
// later Compressor/Limiter) are stateless and just emit param changes.
//
// Structural ops (toggle / add / remove / reorder) persist immediately. Param
// drags go through setTrackPluginsLive (store only, live preview) + a debounced
// setTrackPlugins commit — same pattern the per-track EQ used.
export default function TrackFxPanel({ track }) {
  const setTrackPlugins = useProjectStore(s => s.setTrackPlugins)
  const setTrackPluginsLive = useProjectStore(s => s.setTrackPluginsLive)
  const [expandedId, setExpandedId] = useState(null)
  const [showAdd, setShowAdd] = useState(false)
  const timerRef = useRef(null)

  const plugins = getPlugins(track)

  // Immediate persist (structural changes).
  const commit = (next) => {
    setTrackPluginsLive(track.id, next)
    setTrackPlugins(track.id, next)
  }
  // Live + debounced persist (param drags).
  const liveCommit = (next) => {
    setTrackPluginsLive(track.id, next)
    if (timerRef.current) clearTimeout(timerRef.current)
    timerRef.current = setTimeout(() => setTrackPlugins(track.id, next), 300)
  }

  const setParams = (id, params, persist) => {
    const next = plugins.map(p => (p.id === id ? { ...p, params } : p))
    ;(persist ? commit : liveCommit)(next)
  }
  const toggle = (id) => commit(plugins.map(p => (p.id === id ? { ...p, enabled: !p.enabled } : p)))
  const remove = (id) => {
    commit(plugins.filter(p => p.id !== id))
    if (expandedId === id) setExpandedId(null)
  }
  const move = (id, dir) => {
    const i = plugins.findIndex(p => p.id === id)
    const j = i + dir
    if (i < 0 || j < 0 || j >= plugins.length) return
    const next = plugins.slice()
    ;[next[i], next[j]] = [next[j], next[i]]
    commit(next)
  }
  const add = (type) => {
    const plugin = type === 'eq' ? makeEqPlugin() : null
    if (!plugin) return
    commit([...plugins, plugin])
    setExpandedId(plugin.id)
    setShowAdd(false)
  }

  return (
    <div
      className="absolute left-full top-0 ml-1 bg-[#2a2a2a] border border-[#444] rounded-lg shadow-xl z-50 p-2 w-[320px]"
      onClick={e => e.stopPropagation()}
    >
      {plugins.length === 0 && (
        <div className="text-[10px] text-[#666] px-1 py-2 text-center">尚未掛載效果</div>
      )}

      <div className="flex flex-col gap-1">
        {plugins.map((p, i) => (
          <div key={p.id} className="rounded border border-[#3a3a3a] bg-[#222]">
            {/* Row: enable · name(expand) · reorder · remove */}
            <div className="flex items-center gap-1 px-1.5 py-1">
              <input
                type="checkbox"
                checked={!!p.enabled}
                onChange={() => toggle(p.id)}
                className="accent-[#6d5efc] cursor-pointer"
                title={p.enabled ? '停用' : '啟用'}
              />
              <button
                onClick={() => setExpandedId(expandedId === p.id ? null : p.id)}
                className="flex-1 text-left text-[11px] text-[#ccc] hover:text-white"
              >
                {PLUGIN_LABELS[p.type] ?? p.type}
                {!p.enabled && <span className="text-[#555] ml-1">(停用)</span>}
              </button>
              <button onClick={() => move(p.id, -1)} disabled={i === 0}
                className="text-[11px] text-[#666] hover:text-[#ccc] disabled:opacity-30 px-0.5" title="上移">↑</button>
              <button onClick={() => move(p.id, +1)} disabled={i === plugins.length - 1}
                className="text-[11px] text-[#666] hover:text-[#ccc] disabled:opacity-30 px-0.5" title="下移">↓</button>
              <button onClick={() => remove(p.id)}
                className="text-[11px] text-[#666] hover:text-red-400 px-0.5" title="移除">✕</button>
            </div>

            {/* Expanded params */}
            {expandedId === p.id && p.type === 'eq' && (
              <div className="px-2 pb-2 border-t border-[#3a3a3a]">
                <TrackEqPanel
                  bands={p.params?.bands ?? []}
                  onChange={(bands, persist) => setParams(p.id, { ...p.params, bands }, persist)}
                />
              </div>
            )}
          </div>
        ))}
      </div>

      {/* Add effect */}
      <div className="relative mt-1.5">
        <button
          onClick={() => setShowAdd(!showAdd)}
          className="w-full text-[11px] px-2 py-1 rounded border border-dashed border-[#444] text-[#888] hover:border-[#6d5efc] hover:text-[#6d5efc] transition-colors"
        >
          + 加效果
        </button>
        {showAdd && (
          <div className="absolute left-0 top-full mt-1 w-full bg-[#2a2a2a] border border-[#444] rounded shadow-lg z-50 py-1">
            <button onClick={() => add('eq')}
              className="w-full text-left text-[11px] px-2 py-1 text-[#ccc] hover:bg-[#3a3a3a]">EQ（5-band）</button>
            <div className="px-2 py-1 text-[10px] text-[#555] select-none">壓縮器 · 限幅器（Step 2）</div>
          </div>
        )}
      </div>
    </div>
  )
}
