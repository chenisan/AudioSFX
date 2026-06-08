import { useState, useEffect, useMemo, useRef, useCallback } from 'react'
import { useProjectStore } from '../../stores/projectStore'

// Browse the user's own local SFX folder (e.g. D:\sfx_sample with Sonniss packs).
// Folder is configured in settings (localSfxDir). Importing copies the file into
// project assets → normal asset → clip path. Nothing is bundled or committed.
export default function LocalLibraryPanel() {
  const projectId = useProjectStore(s => s.project?.id)
  const bumpAssetVersion = useProjectStore(s => s.bumpAssetVersion)

  const [scan, setScan] = useState(null)     // { dir, available, count, truncated, categories, items }
  const [error, setError] = useState(null)
  const [loading, setLoading] = useState(true)
  const [cat, setCat] = useState('all')
  const [q, setQ] = useState('')
  const [playingId, setPlayingId] = useState(null)
  const [busyId, setBusyId] = useState(null)
  const [dirInput, setDirInput] = useState('')
  const [editing, setEditing] = useState(false)
  const audioRef = useRef(null)

  const load = useCallback((refresh) => {
    setLoading(true); setError(null)
    fetch(`/api/local-library${refresh ? '?refresh=1' : ''}`)
      .then(r => r.json())
      .then(s => { setScan(s); setDirInput(s.dir || 'D:\\sfx_sample') })
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

  const preview = useCallback((item) => {
    const a = audioRef.current
    if (!a) return
    if (playingId === item.id) { a.pause(); setPlayingId(null); return }
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

  const saveDir = useCallback(async () => {
    setError(null)
    try {
      const res = await fetch('/api/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ localSfxDir: dirInput.trim() }),
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      setEditing(false)
      load(true)
    } catch (e) { setError(e.message) }
  }, [dirInput, load])

  const items = scan?.items ?? []
  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase()
    return items.filter(it => {
      if (cat !== 'all' && it.category !== cat) return false
      if (!needle) return true
      return it.name.toLowerCase().includes(needle) || it.category.toLowerCase().includes(needle)
    })
  }, [items, cat, q])

  // ── folder picker (shown when no folder set / not found / empty) ─────────────
  const FolderConfig = ({ hint }) => (
    <div className="p-3 space-y-2">
      {hint && <p className="text-[11px] text-[#aaa] leading-relaxed">{hint}</p>}
      <label className="block text-[10px] text-[#777]">本機音效資料夾路徑</label>
      <input
        value={dirInput}
        onChange={e => setDirInput(e.target.value)}
        onKeyDown={e => { if (e.key === 'Enter') saveDir() }}
        placeholder="D:\sfx_sample"
        className="w-full bg-[#111] border border-[#333] rounded px-2 py-1.5 text-xs text-gray-300 placeholder-[#555] focus:outline-none focus:border-[#22c55e] font-mono"
      />
      <button onClick={saveDir} className="w-full bg-[#22c55e]/15 text-[#22c55e] hover:bg-[#22c55e]/25 text-xs py-1.5 rounded font-medium">
        設定並掃描
      </button>
      <p className="text-[10px] text-[#666] leading-relaxed">
        把音效檔（WAV / MP3 / OGG…）放進這個資料夾（可有子資料夾），這裡就會分類列出。
        例如 Sonniss / 99sounds 等免費包，自行下載解壓到此。
      </p>
      {error && <p className="text-[10px] text-red-400">{error}</p>}
    </div>
  )

  if (loading && !scan) return <div className="p-4 text-xs text-[#666]">掃描本機資料夾…</div>
  if (!scan) return <FolderConfig hint="尚未設定本機資料夾。" />
  if (!scan.dir) return <FolderConfig hint="尚未設定本機音效資料夾。設定一個含音效檔的資料夾即可瀏覽。" />
  if (!scan.available) return <FolderConfig hint={`找不到資料夾：${scan.dir}。請確認路徑，或改設定另一個。`} />
  if (scan.count === 0) {
    return (
      <div className="flex flex-col h-full">
        <FolderConfig hint={`資料夾存在但沒有音效檔：${scan.dir}`} />
        <div className="px-3"><button onClick={() => load(true)} className="text-[10px] text-[#22c55e] hover:underline">重新掃描</button></div>
      </div>
    )
  }

  const cats = [{ id: 'all', count: items.length }, ...scan.categories]

  return (
    <div className="flex flex-col h-full">
      {/* folder bar + search */}
      <div className="px-2 py-1.5 border-b border-[#2a2a2a] shrink-0 space-y-1.5">
        <div className="flex items-center gap-1 text-[9px] text-[#666]">
          <span className="font-mono truncate flex-1" title={scan.dir}>{scan.dir}</span>
          <button onClick={() => load(true)} title="重新掃描" className="text-[#888] hover:text-white px-1">⟳</button>
          <button
            onClick={() => setEditing(v => !v)}
            title="變更資料夾"
            className={`px-1 hover:text-white ${editing ? 'text-[#22c55e]' : 'text-[#888]'}`}
          >✎</button>
        </div>
        <input
          value={q}
          onChange={e => setQ(e.target.value)}
          placeholder="搜尋（檔名 / 分類）"
          className="w-full bg-[#111] border border-[#333] rounded px-2 py-1 text-xs text-gray-300 placeholder-[#555] focus:outline-none focus:border-[#22c55e]"
        />
      </div>

      {editing && (
        <div className="border-b border-[#2a2a2a] shrink-0">
          <FolderConfig hint="變更本機音效資料夾：" />
        </div>
      )}

      <div className="flex flex-1 min-h-0">
        {/* category sidebar */}
        <div className="w-24 shrink-0 border-r border-[#2a2a2a] overflow-y-auto py-1">
          {cats.map(c => (
            <button
              key={c.id}
              onClick={() => setCat(c.id)}
              title={c.id}
              className={`w-full text-left px-2 py-1.5 text-[10px] leading-tight transition-colors truncate ${
                cat === c.id ? 'bg-[#22c55e]/15 text-[#22c55e]' : 'text-[#999] hover:bg-[#1a1a1a]'
              }`}
            >
              {c.id === 'all' ? '全部' : c.id}
              <span className="block text-[9px] text-[#555]">{c.count}</span>
            </button>
          ))}
        </div>

        {/* list */}
        <div className="flex-1 overflow-y-auto min-h-0 p-1.5 space-y-1">
          {filtered.length === 0 ? (
            <div className="text-center text-[#444] text-xs py-8">沒有符合的音效</div>
          ) : filtered.slice(0, 600).map(item => (
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
                <div className="text-[9px] text-[#555] truncate" title={item.category}>{item.category}</div>
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
          {filtered.length > 600 && (
            <div className="text-center text-[9px] text-[#555] py-2">只顯示前 600 筆，請用搜尋縮小範圍</div>
          )}
        </div>
      </div>

      <div className="px-2 py-1.5 border-t border-[#2a2a2a] shrink-0 flex items-center justify-between text-[9px] text-[#555]">
        <span>{filtered.length} / {items.length}{scan.truncated ? '＋' : ''}</span>
        {!projectId && <span className="text-[#f0a020]">請先開啟專案</span>}
        <span>本機資料夾</span>
      </div>
      {error && <div className="px-2 py-1 text-[10px] text-red-400 shrink-0">{error}</div>}
    </div>
  )
}
