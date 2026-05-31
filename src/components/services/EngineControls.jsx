import { useState, useEffect, useRef, useCallback } from 'react'

// Header widget: monitor + start/stop the local Python inference services.
// Polls /api/services on an interval; a compact button shows per-engine status
// dots and opens a dropdown with start/stop controls + VRAM usage.
const DOT = { ready: 'bg-green-500', starting: 'bg-amber-400 animate-pulse', stopped: 'bg-[#555]' }
const STATE_LABEL = { ready: '就緒', starting: '啟動中…', stopped: '已停止' }

export default function EngineControls() {
  const [data, setData] = useState({ engines: [], vram: null })
  const [open, setOpen] = useState(false)
  const [pending, setPending] = useState({})       // { [name]: 'start'|'stop' }
  const wrapRef = useRef(null)

  const refresh = useCallback(() => {
    fetch('/api/services').then(r => r.json()).then(setData).catch(() => {})
  }, [])

  // Poll faster while the dropdown is open (live monitoring), slower otherwise.
  useEffect(() => {
    refresh()
    const id = setInterval(refresh, open ? 2500 : 6000)
    return () => clearInterval(id)
  }, [refresh, open])

  // Close on outside click
  useEffect(() => {
    if (!open) return
    const onClick = (e) => { if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false) }
    window.addEventListener('mousedown', onClick)
    return () => window.removeEventListener('mousedown', onClick)
  }, [open])

  const act = async (name, action) => {
    setPending(p => ({ ...p, [name]: action }))
    try {
      await fetch(`/api/services/${name}/${action}`, { method: 'POST' })
      refresh()
    } catch {}
    setTimeout(() => { setPending(p => { const n = { ...p }; delete n[name]; return n }); refresh() }, 1200)
  }

  const engines = data.engines ?? []
  const anyReady = engines.some(e => e.state === 'ready')
  const anyStarting = engines.some(e => e.state === 'starting')
  const vram = data.vram

  return (
    <div className="relative" ref={wrapRef}>
      <button
        onClick={() => setOpen(o => !o)}
        className="flex items-center gap-1.5 text-sm px-3 py-1 bg-[#1a1a1a] hover:bg-[#252525] border border-[#333] text-[#aaa] rounded transition-colors"
        title="推論服務控制 / 監控"
      >
        <span>引擎</span>
        <span className="flex items-center gap-1">
          {engines.length === 0
            ? <span className="w-1.5 h-1.5 rounded-full bg-[#555]" />
            : engines.map(e => <span key={e.name} className={`w-1.5 h-1.5 rounded-full ${DOT[e.state]}`} title={`${e.label}: ${STATE_LABEL[e.state]}`} />)}
        </span>
        <span className="text-[#555] text-[10px]">▾</span>
      </button>

      {open && (
        <div className="absolute right-0 mt-1.5 w-[320px] bg-[#1a1a1a] border border-[#333] rounded-lg shadow-2xl z-[9999] p-3 space-y-2">
          <div className="text-[11px] text-[#888] mb-1">推論服務</div>

          {engines.map(e => {
            const busy = !!pending[e.name]
            const up = e.state === 'ready'
            return (
              <div key={e.name} className="bg-[#111] border border-[#2a2a2a] rounded px-2.5 py-2">
                <div className="flex items-center gap-2">
                  <span className={`w-2 h-2 rounded-full shrink-0 ${DOT[e.state]}`} />
                  <div className="flex-1 min-w-0">
                    <div className="text-xs text-[#ccc] truncate">{e.label}</div>
                    <div className="text-[10px] text-[#666]">:{e.port} · {STATE_LABEL[e.state]}{up && e.onGpu != null ? gpuHint(e.onGpu) : ''}</div>
                  </div>
                  {up ? (
                    <button
                      onClick={() => act(e.name, 'stop')}
                      disabled={busy}
                      className="text-[10px] px-2 py-1 rounded border border-[#5a2030] text-[#ff8a9b] bg-[#3a1a25] hover:bg-[#5a2a35] disabled:opacity-40"
                    >{pending[e.name] === 'stop' ? '停止中…' : '停止'}</button>
                  ) : (
                    <button
                      onClick={() => act(e.name, 'start')}
                      disabled={busy || e.state === 'starting'}
                      className="text-[10px] px-2 py-1 rounded border border-[#3a2db5] text-white bg-[#6d5efc] hover:bg-[#5848e0] disabled:opacity-40"
                    >{pending[e.name] === 'start' || e.state === 'starting' ? '啟動中…' : '啟動'}</button>
                  )}
                </div>
              </div>
            )
          })}

          {/* VRAM monitor */}
          <div className="pt-1">
            {vram ? (
              <>
                <div className="flex justify-between text-[10px] text-[#888] mb-1">
                  <span>VRAM</span>
                  <span className="font-mono">{(vram.usedMiB / 1024).toFixed(1)} / {(vram.totalMiB / 1024).toFixed(1)} GB</span>
                </div>
                <div className="h-1.5 bg-[#2a2a2a] rounded overflow-hidden">
                  <div
                    className={`h-full rounded ${vram.usedMiB / vram.totalMiB > 0.9 ? 'bg-red-500' : 'bg-[#6d5efc]'}`}
                    style={{ width: `${Math.min(100, (vram.usedMiB / vram.totalMiB) * 100)}%` }}
                  />
                </div>
              </>
            ) : (
              <div className="text-[10px] text-[#666]">VRAM 資訊不可用</div>
            )}
          </div>

          <div className="text-[9px] text-[#555] leading-relaxed pt-0.5">
            MMAudio 與 Woosh-DVFlow 互斥；生成時會自動切換。首次啟動需載入模型，約 10 秒後轉「就緒」。
          </div>
        </div>
      )}
    </div>
  )
}

function gpuHint(onGpu) {
  // woosh: { dflow, dvflow, synch }; mmaudio: boolean
  if (typeof onGpu === 'boolean') return onGpu ? ' · GPU' : ' · 待命'
  if (onGpu && typeof onGpu === 'object') {
    const live = Object.entries(onGpu).filter(([, v]) => v).map(([k]) => k)
    return live.length ? ` · GPU:${live.join(',')}` : ' · 待命'
  }
  return ''
}
