import { useState, useEffect, useMemo, useRef, useCallback } from 'react'
import { useProjectStore } from '../../stores/projectStore'

// Bundled CC0 SFX library browser (Kenney.nl). Browses the manifest served by
// /api/sfx-library, previews sounds inline, and imports them — either straight
// onto a fresh audio track at the playhead (like generation) or just into the
// 素材 panel to drag manually. Importing copies the file into project assets,
// so it follows the normal asset → clip path (no library state in the schema).
export default function SfxLibraryPanel() {
  const projectId = useProjectStore(s => s.project?.id)
  const bumpAssetVersion = useProjectStore(s => s.bumpAssetVersion)

  const [manifest, setManifest] = useState(null)   // { categories, items, license, source, url }
  const [error, setError] = useState(null)
  const [cat, setCat] = useState('all')
  const [q, setQ] = useState('')
  const [playingId, setPlayingId] = useState(null)
  const [busyId, setBusyId] = useState(null)
  const audioRef = useRef(null)

  useEffect(() => {
    fetch('/api/sfx-library')
      .then(r => r.json())
      .then(m => { if (m.error) throw new Error(m.error); setManifest(m) })
      .catch(e => setError(e.message))
  }, [])

  // Single shared <audio> for preview — playing a new sound stops the previous.
  useEffect(() => {
    const a = new Audio()
    a.onended = () => setPlayingId(null)
    audioRef.current = a
    return () => { a.pause(); audioRef.current = null }
  }, [])

  const preview = useCallback((item) => {
    const a = audioRef.current
    if (!a) return
    if (playingId === item.id) { a.pause(); setPlayingId(null); return }
    a.src = `/api/sfx-library/file/${encodeURIComponent(item.id)}`
    a.currentTime = 0
    a.play().then(() => setPlayingId(item.id)).catch(() => setPlayingId(null))
  }, [playingId])

  const importItem = useCallback(async (item) => {
    if (!projectId) return null
    const res = await fetch('/api/sfx-library/import', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ projectId, id: item.id }),
    })
    const data = await res.json()
    if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`)
    bumpAssetVersion()
    return data   // { filename, durationSec, name }
  }, [projectId, bumpAssetVersion])

  const addToTimeline = useCallback(async (item) => {
    if (!projectId || busyId) return
    setBusyId(item.id); setError(null)
    try {
      const data = await importItem(item)
      const store = useProjectStore.getState()
      const start = store.playheadTime ?? 0
      const dur = data.durationSec || item.durationSec || 2
      store.addTrackWithClip('audio', { source: data.filename, start, end: start + dur, sourceDuration: dur })
    } catch (e) { setError(e.message) }
    finally { setBusyId(null) }
  }, [projectId, busyId, importItem])

  const addToAssets = useCallback(async (item) => {
    if (!projectId || busyId) return
    setBusyId(item.id); setError(null)
    try { await importItem(item) }
    catch (e) { setError(e.message) }
    finally { setBusyId(null) }
  }, [projectId, busyId, importItem])

  const items = manifest?.items ?? []
  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase()
    return items.filter(it => {
      if (cat !== 'all' && it.category !== cat) return false
      if (!needle) return true
      return it.name.toLowerCase().includes(needle) || it.tags.some(t => t.includes(needle))
    })
  }, [items, cat, q])

  if (error && !manifest) {
    return <div className="p-4 text-xs text-red-400">音效庫載入失敗：{error}</div>
  }
  if (!manifest) {
    return <div className="p-4 text-xs text-[#666]">載入音效庫…</div>
  }

  const cats = [{ id: 'all', zh: '全部' }, ...manifest.categories]
  const countOf = (id) => id === 'all' ? items.length : items.filter(i => i.category === id).length

  return (
    <div className="flex flex-col h-full">
      {/* search */}
      <div className="px-2 py-2 border-b border-[#2a2a2a] shrink-0">
        <input
          value={q}
          onChange={e => setQ(e.target.value)}
          placeholder="搜尋音效（glass, footstep, laser…）"
          className="w-full bg-[#111] border border-[#333] rounded px-2 py-1 text-xs text-gray-300 placeholder-[#555] focus:outline-none focus:border-[#22c55e]"
        />
      </div>

      <div className="flex flex-1 min-h-0">
        {/* category sidebar */}
        <div className="w-20 shrink-0 border-r border-[#2a2a2a] overflow-y-auto py-1">
          {cats.map(c => (
            <button
              key={c.id}
              onClick={() => setCat(c.id)}
              className={`w-full text-left px-2 py-1.5 text-[11px] leading-tight transition-colors ${
                cat === c.id ? 'bg-[#22c55e]/15 text-[#22c55e]' : 'text-[#999] hover:bg-[#1a1a1a]'
              }`}
            >
              {c.zh}
              <span className="block text-[9px] text-[#555]">{countOf(c.id)}</span>
            </button>
          ))}
        </div>

        {/* list */}
        <div className="flex-1 overflow-y-auto min-h-0 p-1.5 space-y-1">
          {filtered.length === 0 ? (
            <div className="text-center text-[#444] text-xs py-8">沒有符合的音效</div>
          ) : filtered.map(item => (
            <div key={item.id} className="bg-[#1a1a1a] border border-[#2a2a2a] rounded px-2 py-1.5 flex items-center gap-1.5">
              <button
                onClick={() => preview(item)}
                title="試聽"
                className={`shrink-0 w-6 h-6 rounded-full flex items-center justify-center text-[11px] ${
                  playingId === item.id ? 'bg-[#22c55e] text-black' : 'bg-[#2a2a2a] text-[#aaa] hover:bg-[#333]'
                }`}
              >{playingId === item.id ? '❚❚' : '▶'}</button>
              <div className="flex-1 min-w-0">
                <div className="text-[11px] text-[#ccc] truncate" title={item.name}>{item.name}</div>
                <div className="text-[9px] text-[#555] font-mono">{item.durationSec ? `${item.durationSec.toFixed(2)}s` : ''}</div>
              </div>
              <button
                onClick={() => addToAssets(item)}
                disabled={!projectId || busyId === item.id}
                title="只匯入到「素材」，自己拖到時間軸"
                className="shrink-0 text-[10px] px-1.5 py-1 rounded border border-[#333] text-[#999] hover:text-white hover:bg-[#2a2a2a] disabled:opacity-40"
              >素材</button>
              <button
                onClick={() => addToTimeline(item)}
                disabled={!projectId || busyId === item.id}
                title="在播放頭位置加到新音軌"
                className="shrink-0 text-[10px] px-1.5 py-1 rounded bg-[#22c55e]/15 text-[#22c55e] hover:bg-[#22c55e]/25 disabled:opacity-40"
              >＋軌</button>
            </div>
          ))}
        </div>
      </div>

      {/* footer: count + license */}
      <div className="px-2 py-1.5 border-t border-[#2a2a2a] shrink-0 flex items-center justify-between text-[9px] text-[#555]">
        <span>{filtered.length} / {items.length}</span>
        {!projectId && <span className="text-[#f0a020]">請先開啟專案</span>}
        <span title="公眾領域，可自由使用">{manifest.source} · {manifest.license}</span>
      </div>
      {error && <div className="px-2 py-1 text-[10px] text-red-400 shrink-0">{error}</div>}
    </div>
  )
}
