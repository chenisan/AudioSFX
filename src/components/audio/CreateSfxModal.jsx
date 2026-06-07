import { useState, useEffect, useCallback } from 'react'
import { useProjectStore } from '../../stores/projectStore'

function fmt(t) {
  const m = Math.floor(t / 60), s = Math.floor(t % 60)
  return `${m}:${String(s).padStart(2, '0')}`
}

// Text → SFX generation launched from an audio-track empty-space right-click.
// Generates a Woosh-DFlow SFX from a prompt and drops it as a clip at `time`
// on `trackId`. Filename is optional; blank falls back to the prompt (the
// server slugifies + timestamps either way).
export default function CreateSfxModal({ trackId, time, onClose }) {
  const projectId = useProjectStore(s => s.project?.id)
  const audioGen = useProjectStore(s => s.audioGen)

  const [prompt, setPrompt] = useState('')
  const [name, setName] = useState('')
  const [error, setError] = useState(null)
  const [health, setHealth] = useState(null)        // { woosh, mmaudio } | null

  const checkHealth = useCallback(() => {
    fetch('/api/audio/health').then(r => r.json()).then(setHealth).catch(() => setHealth({ woosh: false, mmaudio: false }))
  }, [])
  useEffect(() => { checkHealth() }, [checkHealth])

  const busy = !!audioGen

  const generate = async () => {
    if (!projectId || !prompt.trim() || busy) return
    const store = useProjectStore.getState()
    if (store.audioGen) return                        // one generation at a time (GPU)
    setError(null)
    store.beginAudioGen?.('正在生成音效（高品質）…')   // floating elapsed indicator
    try {
      const res = await fetch('/api/audio/sfx', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectId, prompt: prompt.trim(), name: name.trim() || undefined }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`)
      const dur = data.durationSec || 5
      await store.addClip(trackId, {
        source: data.filename,
        start: time,
        end: time + dur,
        sourceDuration: dur,
      })
      store.bumpAssetVersion?.()
      store.showToast?.('音效已加到音軌', 'success')
      onClose()
    } catch (e) {
      setError(e.message)
      if (/未啟動|service_down/.test(e.message)) checkHealth()
    } finally {
      store.endAudioGen?.()
    }
  }

  const wooshDown = health && !health.woosh

  return (
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-[60]" onClick={onClose}>
      <div className="bg-[#1a1a1a] border border-[#333] rounded-lg w-[440px] flex flex-col" onClick={e => e.stopPropagation()}>
        <div className="px-4 py-3 border-b border-[#2a2a2a] flex justify-between items-center">
          <div>
            <h2 className="text-sm font-medium text-white">建立音效 (Woosh SFX)</h2>
            <div className="text-[10px] text-[#666] mt-0.5 font-mono">落點 {fmt(time)}</div>
          </div>
          <button onClick={onClose} className="text-[#666] hover:text-white text-xl leading-none">×</button>
        </div>

        <div className="p-4 space-y-3">
          <div className="space-y-1">
            <label className="text-[10px] text-[#888]">描述（英文）</label>
            <textarea
              value={prompt}
              onChange={e => setPrompt(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) generate() }}
              placeholder="sword swing whoosh, glass shatter, heavy footsteps"
              rows={3}
              autoFocus
              className="w-full bg-[#111] border border-[#333] rounded px-2 py-1.5 text-xs text-gray-300 placeholder-[#555] focus:outline-none focus:border-[#6d5efc] resize-none"
            />
          </div>

          <div className="space-y-1">
            <label className="text-[10px] text-[#888]">檔名（選填）</label>
            <input
              value={name}
              onChange={e => setName(e.target.value)}
              placeholder="留空則用描述自動命名"
              className="w-full bg-[#111] border border-[#333] rounded px-2 py-1.5 text-xs text-gray-300 placeholder-[#555] focus:outline-none focus:border-[#6d5efc]"
            />
          </div>

          <button
            onClick={generate}
            disabled={!projectId || !prompt.trim() || busy}
            className="w-full bg-[#6d5efc] hover:bg-[#5848e0] disabled:bg-[#2e2a5c] disabled:text-[#666] text-white text-sm py-1.5 rounded font-medium transition-colors"
          >
            {busy ? '生成中…' : '生成並放到音軌'}
          </button>

          <p className="text-[10px] text-[#666] leading-relaxed">
            高品質模式（每顆約 20 秒）。生成後音效會放在右鍵的時間點，並加入左側「素材」。
          </p>
          {wooshDown && (
            <p className="text-[10px] text-[#f0a020] leading-relaxed">
              推論服務未啟動。請先執行 <code className="text-[#aaa]">engines/start-woosh.ps1</code>，再重試。
            </p>
          )}
          {error && !wooshDown && <p className="text-[10px] text-red-400 leading-relaxed">{error}</p>}
        </div>
      </div>
    </div>
  )
}
