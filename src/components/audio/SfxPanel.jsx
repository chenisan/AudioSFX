import { useState, useEffect, useCallback } from 'react'
import { useProjectStore } from '../../stores/projectStore'

// Text → SFX panel (Woosh-DFlow). Generates a sound effect from an English
// prompt, lands it as a project asset, and lets the user drop it onto the
// timeline at the playhead. Video→audio lives on the clip right-click menu.
export default function SfxPanel() {
  const projectId = useProjectStore(s => s.project?.id)
  const bumpAssetVersion = useProjectStore(s => s.bumpAssetVersion)

  const [prompt, setPrompt] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const [results, setResults] = useState([])      // [{ filename, durationSec, genSeconds }]
  const [health, setHealth] = useState(null)       // { woosh, mmaudio } | null

  const checkHealth = useCallback(() => {
    fetch('/api/audio/health').then(r => r.json()).then(setHealth).catch(() => setHealth({ woosh: false, mmaudio: false }))
  }, [])
  useEffect(() => { checkHealth() }, [checkHealth])

  const generate = async () => {
    if (!projectId || !prompt.trim() || busy) return
    const store = useProjectStore.getState()
    if (store.audioGen) { return }                  // one generation at a time (GPU)
    setBusy(true); setError(null)
    store.beginAudioGen?.('正在生成音效（高品質）…')   // floating elapsed indicator
    try {
      const res = await fetch('/api/audio/sfx', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectId, prompt: prompt.trim() }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`)
      setResults(r => [{ ...data, prompt: prompt.trim() }, ...r])
      bumpAssetVersion()                            // it's now a normal asset in 素材
    } catch (e) {
      setError(e.message)
      if (/未啟動|service_down/.test(e.message)) checkHealth()
    } finally {
      store.endAudioGen?.()
      setBusy(false)
    }
  }

  // Place a generated clip on a FRESH audio track at the playhead, so stacking
  // many SFX auto-layers onto separate tracks (easy to align / mix per layer).
  const addToTimeline = (item) => {
    const store = useProjectStore.getState()
    const start = store.playheadTime ?? 0
    const dur = item.durationSec || 5
    const clip = { source: item.filename, start, end: start + dur, sourceDuration: dur }
    store.addTrackWithClip('audio', clip)
  }

  const wooshDown = health && !health.woosh

  return (
    <div className="flex flex-col h-full">
      <div className="px-3 py-2 border-b border-[#2a2a2a] shrink-0 flex items-center justify-between">
        <span className="text-xs text-[#888]">音效生成</span>
        <span className="flex items-center gap-1 text-[10px]" title="Woosh 推論服務狀態">
          <span className={`w-1.5 h-1.5 rounded-full ${health?.woosh ? 'bg-green-500' : 'bg-red-500'}`} />
          <span className={health?.woosh ? 'text-green-400' : 'text-[#777]'}>{health?.woosh ? 'Woosh 就緒' : '服務未啟動'}</span>
        </span>
      </div>

      <div className="p-3 space-y-2 shrink-0 border-b border-[#2a2a2a]">
        <textarea
          value={prompt}
          onChange={e => setPrompt(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) generate() }}
          placeholder="用英文描述音效，例如：sword swing whoosh, glass shatter, heavy footsteps"
          rows={3}
          className="w-full bg-[#111] border border-[#333] rounded px-2 py-1.5 text-xs text-gray-300 placeholder-[#555] focus:outline-none focus:border-[#6d5efc] resize-none"
        />
        <button
          onClick={generate}
          disabled={!projectId || !prompt.trim() || busy}
          className="w-full bg-[#6d5efc] hover:bg-[#5848e0] disabled:bg-[#2e2a5c] disabled:text-[#666] text-white text-sm py-1.5 rounded font-medium transition-colors"
        >
          {busy ? '生成中…' : '生成音效'}
        </button>
        <p className="text-[10px] text-[#666] leading-relaxed">
          高品質模式（每顆約 20 秒）。生成的音效會加入左側「素材」，可在那試聽、拖到時間軸、刪除（會連檔案一起刪）。
        </p>
        {wooshDown && (
          <p className="text-[10px] text-[#f0a020] leading-relaxed">
            推論服務未啟動。請先執行 <code className="text-[#aaa]">engines/start-woosh.ps1</code>，再按上面重試。
            <br />
            首次使用？<a
              href="https://github.com/chenisan/AudioSFX/blob/main/ENGINES.md"
              target="_blank"
              rel="noreferrer"
              className="text-[#6d5efc] hover:underline"
            >如何下載安裝 AI 引擎 →</a>
          </p>
        )}
        {error && !wooshDown && <p className="text-[10px] text-red-400 leading-relaxed">{error}</p>}
        {!projectId && <p className="text-[10px] text-[#666]">請先開啟或建立專案。</p>}
      </div>

      {/* Generated this session */}
      <div className="flex-1 overflow-y-auto min-h-0 p-2 space-y-1.5">
        {results.length === 0 ? (
          <div className="text-center text-[#444] text-xs py-8">本次生成的音效會列在這裡</div>
        ) : results.map((item, i) => (
          <div key={i} className="bg-[#1a1a1a] border border-[#2a2a2a] rounded p-2 space-y-1.5">
            <div className="text-[11px] text-[#ccc] leading-snug line-clamp-2" title={item.prompt}>{item.prompt}</div>
            <div className="text-[9px] text-[#555] font-mono">
              {item.durationSec ? `${item.durationSec.toFixed(1)}s` : ''}{item.genSeconds != null ? ` · ${Number(item.genSeconds).toFixed(2)}s 生成` : ''}
            </div>
            <audio src={`/assets/${projectId}/${encodeURIComponent(item.filename)}`} controls className="w-full h-7" />
            <button
              onClick={() => addToTimeline(item)}
              className="w-full text-[10px] bg-[#2a2a2a] hover:bg-[#333] text-[#aaa] hover:text-white py-1 rounded border border-[#333]"
              title="在播放頭位置加到音軌"
            >+ 加到時間軸（播放頭）</button>
          </div>
        ))}
      </div>
    </div>
  )
}
