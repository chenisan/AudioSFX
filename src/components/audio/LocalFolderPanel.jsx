import { useState, useEffect, useMemo, useRef, useCallback } from 'react'
import { useProjectStore } from '../../stores/projectStore'
import { useAudition } from './useAudition'
import WaveformPreview from './WaveformPreview'

// Browse the same local SFX folder (localSfxDir, e.g. D:\sfx_sample) but grouped
// by the user's OWN folder structure instead of the keyword categorizer. Purchased
// packs (ODEON, cinematic libraries…) already sort themselves into meaningful
// folders, so we mirror the on-disk tree. Data source is the same /api/local-library
// scan — item.id is a forward-slash relpath, so the tree is built entirely here on
// the frontend (no backend change). Import path is identical to the 本機 tab.
export default function LocalFolderPanel() {
  const projectId = useProjectStore(s => s.project?.id)
  const bumpAssetVersion = useProjectStore(s => s.bumpAssetVersion)

  const [scan, setScan] = useState(null)
  const [error, setError] = useState(null)
  const [loading, setLoading] = useState(true)
  const [sel, setSel] = useState('')          // selected folder path ('' = 全部)
  const [expanded, setExpanded] = useState(() => new Set())
  const [q, setQ] = useState('')
  const [playingId, setPlayingId] = useState(null)
  const [current, setCurrent] = useState(null)   // item shown in the waveform strip
  const [busyId, setBusyId] = useState(null)
  const audioRef = useRef(null)

  const load = useCallback((refresh) => {
    setLoading(true); setError(null)
    fetch(`/api/local-library${refresh ? '?refresh=1' : ''}`)
      .then(r => r.json())
      .then(s => setScan(s))
      .catch(e => setError(e.message))
      .finally(() => setLoading(false))
  }, [])
  useEffect(() => { load(false) }, [load])

  useEffect(() => {
    const a = new Audio()
    a.onended = () => setPlayingId(null)
    audioRef.current = a
    return () => { a.pause(); audioRef.current = null }
  }, [])

  // force=true always (re)starts (↑/↓ stepping); otherwise toggle play/pause.
  const preview = useCallback((item, force = false) => {
    const a = audioRef.current
    if (!a) return
    setCurrent(item)                              // keep the waveform strip on this item
    if (!force && playingId === item.id) { a.pause(); setPlayingId(null); return }
    a.src = `/api/local-library/file?id=${encodeURIComponent(item.id)}`
    a.currentTime = 0
    a.play().then(() => setPlayingId(item.id)).catch(() => setPlayingId(null))
  }, [playingId])

  const importItem = useCallback(async (item) => {
    const res = await fetch('/api/local-library/import', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ projectId, id: item.id }),
    })
    const data = await res.json()
    if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`)
    bumpAssetVersion()
    return data
  }, [projectId, bumpAssetVersion])

  const addToTimeline = useCallback(async (item) => {
    if (!projectId || busyId) return
    setBusyId(item.id); setError(null)
    try {
      const data = await importItem(item)
      const store = useProjectStore.getState()
      const start = store.playheadTime ?? 0
      const dur = data.durationSec || 2
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

  const items = scan?.items ?? []

  // ── build the folder tree from item ids (relpaths) ───────────────────────────
  const { tree, pathMap } = useMemo(() => {
    const root = { name: '', path: '', dirs: new Map(), files: [] }
    const map = new Map([['', root]])
    for (const it of items) {
      const parts = it.id.split('/')
      parts.pop()                                  // drop filename
      let node = root, path = ''
      for (const seg of parts) {
        path = path ? `${path}/${seg}` : seg
        if (!node.dirs.has(seg)) {
          const child = { name: seg, path, dirs: new Map(), files: [] }
          node.dirs.set(seg, child); map.set(path, child)
        }
        node = node.dirs.get(seg)
      }
      node.files.push(it)
    }
    const count = (n) => { let c = n.files.length; for (const d of n.dirs.values()) c += count(d); n.count = c; return c }
    count(root)
    return { tree: root, pathMap: map }
  }, [items])

  // Flatten visible tree rows honoring expand/collapse; natural sort (2 < 10).
  const rows = useMemo(() => {
    const out = []
    const walk = (node, depth) => {
      const dirs = [...node.dirs.values()].sort((a, b) =>
        a.name.localeCompare(b.name, 'zh-Hant', { numeric: true }))
      for (const d of dirs) {
        out.push({ node: d, depth })
        if (expanded.has(d.path)) walk(d, depth + 1)
      }
    }
    walk(tree, 0)
    return out
  }, [tree, expanded])

  // Files under the selected folder (whole subtree), then search-filter.
  const files = useMemo(() => {
    const node = pathMap.get(sel) || tree
    const acc = []
    const gather = (n) => { for (const f of n.files) acc.push(f); for (const d of n.dirs.values()) gather(d) }
    gather(node)
    const needle = q.trim().toLowerCase()
    if (!needle) return acc
    return acc.filter(it => it.name.toLowerCase().includes(needle) || (it.folder || '').toLowerCase().includes(needle))
  }, [pathMap, sel, tree, q])

  const toggle = useCallback((path) => {
    setExpanded(prev => { const n = new Set(prev); n.has(path) ? n.delete(path) : n.add(path); return n })
  }, [])

  // ↑/↓ audition, Space play/pause, Enter ＋軌
  const { cursor, listRef, onKeyDown, focusAt } = useAudition(files, preview, { onEnter: addToTimeline })

  if (loading && !scan) return <div className="p-4 text-xs text-[#666]">掃描本機資料夾…</div>
  if (!scan || !scan.available || scan.count === 0) {
    return (
      <div className="p-4 text-xs text-[#888] space-y-2">
        <p>{!scan?.dir ? '尚未設定本機音效資料夾。' : !scan.available ? `找不到資料夾：${scan.dir}` : `資料夾沒有音效檔：${scan.dir}`}</p>
        <p className="text-[10px] text-[#666]">請先到「本機」分頁設定資料夾路徑（✎），這裡會沿用同一個資料夾、照你的目錄結構顯示。</p>
        {error && <p className="text-[10px] text-red-400">{error}</p>}
      </div>
    )
  }

  return (
    <div className="flex flex-col h-full">
      {/* folder bar + search */}
      <div className="px-2 py-1.5 border-b border-[#2a2a2a] shrink-0 space-y-1.5">
        <div className="flex items-center gap-1 text-[9px] text-[#666]">
          <span className="font-mono truncate flex-1" title={scan.dir}>{scan.dir}</span>
          <button onClick={() => load(true)} title="重新掃描" className="text-[#888] hover:text-white px-1">⟳</button>
        </div>
        <input
          value={q}
          onChange={e => setQ(e.target.value)}
          placeholder="搜尋（此資料夾內檔名）"
          className="w-full bg-[#111] border border-[#333] rounded px-2 py-1 text-xs text-gray-300 placeholder-[#555] focus:outline-none focus:border-[#22c55e]"
        />
      </div>

      <WaveformPreview item={current} audioRef={audioRef} playingId={playingId} />

      <div className="flex flex-1 min-h-0">
        {/* folder tree */}
        <div className="w-52 shrink-0 border-r border-[#2a2a2a] overflow-y-auto py-1">
          <button
            onClick={() => setSel('')}
            className={`w-full text-left px-2 py-1 text-[11px] flex items-center justify-between gap-1 ${
              sel === '' ? 'bg-[#22c55e]/15 text-[#22c55e]' : 'text-[#bbb] hover:bg-[#1a1a1a]'
            }`}
          >
            <span className="truncate">全部</span>
            <span className="text-[9px] text-[#555] shrink-0">{tree.count}</span>
          </button>
          {rows.map(({ node, depth }) => {
            const hasKids = node.dirs.size > 0
            const open = expanded.has(node.path)
            return (
              <div
                key={node.path}
                onClick={() => setSel(node.path)}
                title={node.name}
                className={`group flex items-center gap-1 pr-2 py-1 cursor-pointer text-[11px] leading-tight ${
                  sel === node.path ? 'bg-[#22c55e]/15 text-[#22c55e]' : 'text-[#bbb] hover:bg-[#1a1a1a]'
                }`}
                style={{ paddingLeft: `${6 + depth * 12}px` }}
              >
                {hasKids ? (
                  <button
                    onClick={e => { e.stopPropagation(); toggle(node.path) }}
                    className="shrink-0 w-3 text-[#777] hover:text-white"
                  >{open ? '▾' : '▸'}</button>
                ) : <span className="shrink-0 w-3" />}
                <span className="truncate flex-1">{node.name}</span>
                <span className="text-[9px] text-[#555] shrink-0">{node.count}</span>
              </div>
            )
          })}
        </div>

        {/* file list */}
        <div
          ref={listRef}
          tabIndex={0}
          onKeyDown={onKeyDown}
          className="flex-1 overflow-y-auto min-h-0 p-1.5 space-y-1 focus:outline-none"
        >
          {files.length === 0 ? (
            <div className="text-center text-[#444] text-xs py-8">沒有符合的音效</div>
          ) : files.slice(0, 600).map((item, i) => (
            <div
              key={item.id}
              data-idx={i}
              className={`border rounded px-2 py-1.5 flex items-center gap-1.5 ${
                cursor === i ? 'bg-[#22c55e]/10 border-[#22c55e]/50' : 'bg-[#1a1a1a] border-[#2a2a2a]'
              }`}
            >
              <button
                onClick={() => { focusAt(i); preview(item) }}
                title="試聽"
                className={`shrink-0 w-6 h-6 rounded-full flex items-center justify-center text-[11px] ${
                  playingId === item.id ? 'bg-[#22c55e] text-black' : 'bg-[#2a2a2a] text-[#aaa] hover:bg-[#333]'
                }`}
              >{playingId === item.id ? '❚❚' : '▶'}</button>
              <div className="flex-1 min-w-0">
                <div className="text-[11px] text-[#ccc] truncate" title={item.name}>{item.name}</div>
                <div className="text-[9px] text-[#555] truncate" title={item.folder}>
                  <span className="text-[#22c55e]/70">{item.category}</span>
                  {item.folder ? ` · ${item.folder}` : ''}
                </div>
              </div>
              <button
                onClick={() => addToAssets(item)}
                disabled={!projectId || busyId === item.id}
                title="只匯入到「素材」"
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
          {files.length > 600 && (
            <div className="text-center text-[9px] text-[#555] py-2">只顯示前 600 筆，請用搜尋縮小範圍</div>
          )}
        </div>
      </div>

      <div className="px-2 py-1.5 border-t border-[#2a2a2a] shrink-0 flex items-center justify-between text-[9px] text-[#555]">
        <span>{files.length} 檔{sel ? `（${sel.split('/').pop()}）` : ''}</span>
        {!projectId && <span className="text-[#f0a020]">請先開啟專案</span>}
        <span title="點清單後用鍵盤：↑↓ 逐檔試聽、空白鍵 播放/暫停、Enter 加到音軌">↑↓ 試聽 · 空白 播放 · Enter ＋軌</span>
      </div>
      {error && <div className="px-2 py-1 text-[10px] text-red-400 shrink-0">{error}</div>}
    </div>
  )
}
