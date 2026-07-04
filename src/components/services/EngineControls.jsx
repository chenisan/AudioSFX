import { useState, useEffect, useRef, useCallback } from 'react'

// Header widget: monitor + start/stop the local Python inference services.
// Polls /api/services on an interval; a compact button shows per-engine status
// dots and opens a dropdown with start/stop controls + VRAM usage.
const DOT = { ready: 'bg-green-500', starting: 'bg-amber-400 animate-pulse', stopped: 'bg-[#555]' }
const STATE_LABEL = { ready: '就緒', starting: '啟動中…', stopped: '已停止' }
// Engine venv + weights don't ship with the installer; when missing we point
// the user at the setup guide instead of a dead 啟動 button.
const SETUP_URL = 'https://github.com/chenisan/AudioSFX/blob/main/ENGINES.md'
const PHASE_LABEL = { sizing: '計算大小…', download: '下載中', extract: '解壓中…', done: '完成' }

const fmtBytes = (n) => {
  if (!n || n < 0) return '0 MB'
  const gb = n / 1e9
  return gb >= 1 ? `${gb.toFixed(2)} GB` : `${Math.round(n / 1e6)} MB`
}
const fmtSpeed = (bps) => (bps > 0 ? `${(bps / 1e6).toFixed(1)} MB/s` : '')

export default function EngineControls() {
  const [data, setData] = useState({ engines: [], vram: null })
  const [open, setOpen] = useState(false)
  const [pending, setPending] = useState({})       // { [name]: 'start'|'stop' }
  const [errors, setErrors] = useState({})          // { [name]: message } — surfaced start/stop failures
  const [installing, setInstalling] = useState({})  // { [name]: InstallProgress } while a weight download runs
  const esRef = useRef({})                          // { [name]: EventSource }
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
    setErrors(e => { const n = { ...e }; delete n[name]; return n })
    setPending(p => ({ ...p, [name]: action }))
    try {
      const r = await fetch(`/api/services/${name}/${action}`, { method: 'POST' })
      if (!r.ok) {
        const body = await r.json().catch(() => ({}))
        setErrors(e => ({ ...e, [name]: body.error || `${action === 'start' ? '啟動' : '停止'}失敗（${r.status}）` }))
      }
      refresh()
    } catch {
      setErrors(e => ({ ...e, [name]: '無法連線後端服務' }))
    }
    setTimeout(() => { setPending(p => { const n = { ...p }; delete n[name]; return n }); refresh() }, 1200)
  }

  // Weight download over SSE. Closing the EventSource aborts the transfer on the
  // server; partial .part files resume on the next run.
  const startInstall = (name) => {
    if (esRef.current[name]) return
    setErrors(e => { const n = { ...e }; delete n[name]; return n })
    setInstalling(s => ({ ...s, [name]: { phase: 'sizing', pct: 0 } }))
    const es = new EventSource(`/api/services/${name}/install`)
    esRef.current[name] = es
    const finish = () => { es.close(); delete esRef.current[name]; setInstalling(s => { const n = { ...s }; delete n[name]; return n }); refresh() }
    es.onmessage = (ev) => {
      let p; try { p = JSON.parse(ev.data) } catch { return }
      if (p.status === 'error') { setErrors(e => ({ ...e, [name]: `下載失敗：${p.error || '未知錯誤'}` })); finish(); return }
      if (p.status === 'done' || p.phase === 'done') { finish(); return }
      setInstalling(s => ({ ...s, [name]: p }))
    }
    es.onerror = () => { setErrors(e => ({ ...e, [name]: '下載連線中斷（可再按下載續傳）' })); finish() }
  }
  const cancelInstall = (name) => {
    esRef.current[name]?.close()
    delete esRef.current[name]
    setInstalling(s => { const n = { ...s }; delete n[name]; return n })
    refresh()
  }
  // Tear down any open streams on unmount.
  useEffect(() => () => { Object.values(esRef.current).forEach(es => es.close()); esRef.current = {} }, [])

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
            const installed = e.installed !== false   // tolerate older backend without the field
            const err = errors[e.name]
            const inst = installing[e.name]           // active weight download, or undefined
            const venvMissing = !!e.missing?.some(m => m.includes('.venv'))
            return (
              <div key={e.name} className="bg-[#111] border border-[#2a2a2a] rounded px-2.5 py-2">
                <div className="flex items-center gap-2">
                  <span className={`w-2 h-2 rounded-full shrink-0 ${inst ? 'bg-[#6d5efc] animate-pulse' : (installed || up ? DOT[e.state] : 'bg-[#4a3a1a]')}`} />
                  <div className="flex-1 min-w-0">
                    <div className="text-xs text-[#ccc] truncate">{e.label}</div>
                    <div className="text-[10px] text-[#666]">
                      :{e.port} · {inst ? '下載權重中…' : (installed || up ? STATE_LABEL[e.state] : '未安裝')}{up && e.onGpu != null ? gpuHint(e.onGpu) : ''}
                    </div>
                  </div>
                  {up ? (
                    <button
                      onClick={() => act(e.name, 'stop')}
                      disabled={busy}
                      className="text-[10px] px-2 py-1 rounded border border-[#5a2030] text-[#ff8a9b] bg-[#3a1a25] hover:bg-[#5a2a35] disabled:opacity-40"
                    >{pending[e.name] === 'stop' ? '停止中…' : '停止'}</button>
                  ) : inst ? null : installed ? (
                    <button
                      onClick={() => act(e.name, 'start')}
                      disabled={busy || e.state === 'starting'}
                      className="text-[10px] px-2 py-1 rounded border border-[#3a2db5] text-white bg-[#6d5efc] hover:bg-[#5848e0] disabled:opacity-40"
                    >{pending[e.name] === 'start' || e.state === 'starting' ? '啟動中…' : '啟動'}</button>
                  ) : e.downloadable ? (
                    <button
                      onClick={() => startInstall(e.name)}
                      className="text-[10px] px-2 py-1 rounded border border-[#3a2db5] text-white bg-[#6d5efc] hover:bg-[#5848e0] whitespace-nowrap"
                    >下載權重</button>
                  ) : (
                    <a
                      href={SETUP_URL}
                      target="_blank"
                      rel="noreferrer"
                      className="text-[10px] px-2 py-1 rounded border border-[#5a4a1a] text-[#e0b060] bg-[#2a2210] hover:bg-[#3a301a] whitespace-nowrap"
                    >安裝說明</a>
                  )}
                </div>

                {/* Weight download progress */}
                {inst && (
                  <div className="mt-2">
                    <div className="flex justify-between text-[9px] text-[#888] mb-1 gap-2">
                      <span className="truncate">
                        {PHASE_LABEL[inst.phase] || '下載中'}{inst.file ? ` · ${inst.file}` : ''}{inst.fileCount ? `（${inst.fileIndex}/${inst.fileCount}）` : ''}
                      </span>
                      <span className="font-mono shrink-0">{inst.pct ?? 0}%</span>
                    </div>
                    <div className="h-1.5 bg-[#2a2a2a] rounded overflow-hidden">
                      <div className="h-full bg-[#6d5efc] rounded transition-[width] duration-300" style={{ width: `${inst.pct || 0}%` }} />
                    </div>
                    <div className="flex justify-between items-center mt-1">
                      <span className="text-[9px] text-[#666] font-mono truncate">
                        {fmtBytes(inst.overallBytes)}{inst.overallTotal ? ` / ${fmtBytes(inst.overallTotal)}` : ''}{inst.bytesPerSec ? ` · ${fmtSpeed(inst.bytesPerSec)}` : ''}
                      </span>
                      <button onClick={() => cancelInstall(e.name)} className="text-[9px] text-[#ff8a9b] hover:underline shrink-0 ml-2">取消</button>
                    </div>
                  </div>
                )}

                {/* Not-installed guidance */}
                {!installed && !up && !inst && (
                  <div className="mt-1 space-y-0.5">
                    {e.downloadable && (
                      <div className="text-[9px] text-[#7a6a4a] leading-snug">權重約 11GB，從官方下載、可續傳；下載完才能啟動。</div>
                    )}
                    {venvMissing && (
                      <div className="text-[9px] text-[#7a6a4a] leading-snug">
                        還需自建 venv（見 <a href={SETUP_URL} target="_blank" rel="noreferrer" className="text-[#e0b060] hover:underline">安裝說明</a>）
                      </div>
                    )}
                    {!e.downloadable && !venvMissing && e.missing?.length > 0 && (
                      <div className="text-[9px] text-[#7a6a4a] leading-snug break-all">缺少：{e.missing.join('、')}</div>
                    )}
                  </div>
                )}

                {err && (
                  <div className="mt-1 text-[10px] text-[#ff8a9b] leading-snug break-words">{err}</div>
                )}
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
            {engines.some(e => e.installed === false)
              ? <>引擎（venv＋權重，數 GB）不隨安裝檔附帶，需自行安裝。見 <a href={SETUP_URL} target="_blank" rel="noreferrer" className="text-[#e0b060] hover:underline">ENGINES.md 安裝說明</a>。</>
              : 'MMAudio 與 Woosh-DVFlow 互斥；生成時會自動切換。首次啟動需載入模型，約 10 秒後轉「就緒」。'}
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
