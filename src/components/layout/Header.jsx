import { useState } from 'react'
import { useProjectStore, ASPECT_RATIOS, EXPORT_RESOLUTIONS } from '../../stores/projectStore'
import { useProject } from '../../hooks/useProject'
import { useRender } from '../../hooks/useRender'
import RenderProgress from '../render/RenderProgress'
import EngineControls from '../services/EngineControls'

// Spinning loader for icon buttons in a busy state (saving / rendering).
function Spinner() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" className="animate-spin">
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeOpacity="0.25" strokeWidth="2" />
      <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  )
}

export default function Header({ onOpenProjectModal, onOpenSettings }) {
  // Narrowed — Header only needs id (truthy gating) + name (display); the
  // full subscription was forcing a re-render of every button on every clip
  // mutation.
  const projectId = useProjectStore(s => s.project?.id)
  const projectName = useProjectStore(s => s.project?.name)
  const isDirty = useProjectStore(s => s.isDirty)
  const previewOpen = useProjectStore(s => s.previewOpen)
  const togglePreviewOpen = useProjectStore(s => s.togglePreviewOpen)
  const sfxOpen = useProjectStore(s => s.sfxOpen)
  const toggleSfxOpen = useProjectStore(s => s.toggleSfxOpen)
  const { saveProject } = useProject()
  const { rendering, progress, messages, outputUrl, error, render, reset } = useRender()
  const [saving, setSaving] = useState(false)
  const [showExport, setShowExport] = useState(false)

  const handleSave = async () => {
    if (!projectId) return
    setSaving(true)
    try { await saveProject() } catch (e) { alert(e.message) }
    setSaving(false)
  }

  // Export must always render the latest project state, never a stale-on-disk
  // version. Save first when there are unsaved changes, then open the modal.
  const handleOpenExport = async () => {
    if (!projectId) return
    if (isDirty) {
      setSaving(true)
      try {
        await saveProject()
      } catch (e) {
        alert('匯出前儲存失敗：' + e.message)
        setSaving(false)
        return
      }
      setSaving(false)
    }
    setShowExport(true)
  }

  return (
    <>
      <header data-testid="app-header" className="flex items-center gap-3 px-4 py-2 border-b border-[#2a2a2a] bg-[#111] shrink-0">
        {/* Brand */}
        <div className="flex items-center mr-2">
          <span className="text-[#6d5efc] font-bold">AudioSFX</span>
        </div>

        {/* Project selector */}
        <button
          onClick={onOpenProjectModal}
          className="flex items-center gap-1.5 bg-[#1a1a1a] hover:bg-[#252525] border border-[#333] rounded px-3 py-1 text-sm text-[#ccc] transition-colors"
        >
          <span className="truncate max-w-[180px]">
            {projectId ? projectName : '選擇專案...'}
          </span>
          {isDirty && <span className="text-[#6d5efc] text-xs">●</span>}
          <span className="text-[#555]">▾</span>
        </button>

        <div className="flex-1" />

        {/* Save */}
        <button
          onClick={handleSave}
          disabled={!projectId || saving || !isDirty}
          className="w-8 h-8 flex items-center justify-center rounded text-[#aaa] hover:text-white hover:bg-[#1f1f1f] disabled:opacity-30 disabled:hover:bg-transparent disabled:hover:text-[#aaa] transition-colors"
          title={saving ? '儲存中…' : isDirty ? '儲存 (Ctrl+S)' : '已儲存'}
        >
          {saving ? <Spinner /> : (
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z" /><polyline points="17 21 17 13 7 13 7 21" /><polyline points="7 3 7 8 15 8" />
            </svg>
          )}
        </button>

        {/* Export — auto-saves first if dirty so the render uses the latest state */}
        <button
          onClick={handleOpenExport}
          disabled={!projectId || rendering || saving}
          data-testid="header-export"
          className="w-8 h-8 flex items-center justify-center rounded text-[#6d5efc] hover:text-[#8b7dff] hover:bg-[#1f1f1f] disabled:opacity-40 disabled:hover:bg-transparent disabled:hover:text-[#6d5efc] disabled:cursor-not-allowed transition-colors"
          title={rendering ? '渲染中…' : saving ? '儲存中…' : '匯出'}
        >
          {(rendering || saving) ? <Spinner /> : (
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="17 8 12 3 7 8" /><line x1="12" y1="3" x2="12" y2="15" />
            </svg>
          )}
        </button>

        {/* Floating preview toggle */}
        <button
          onClick={togglePreviewOpen}
          className={`w-8 h-8 flex items-center justify-center rounded transition-colors ${
            previewOpen ? 'text-[#6d5efc]' : 'text-[#666] hover:text-[#aaa]'
          }`}
          title={previewOpen ? '關閉浮動預覽' : '開啟浮動預覽'}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <rect x="2" y="3" width="20" height="14" rx="2" /><path d="M8 21h8M12 17v4" />
          </svg>
        </button>

        {/* Floating SFX-generation toggle */}
        <button
          onClick={toggleSfxOpen}
          className={`w-8 h-8 flex items-center justify-center rounded transition-colors ${
            sfxOpen ? 'text-[#6d5efc]' : 'text-[#666] hover:text-[#aaa]'
          }`}
          title={sfxOpen ? '關閉音效生成' : '開啟音效生成'}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M3 10v4M7 6v12M11 3v18M15 7v10M19 10v4" />
          </svg>
        </button>

        {/* Inference service control / monitor */}
        <EngineControls />

        {/* Settings */}
        <button
          onClick={onOpenSettings}
          className="w-8 h-8 flex items-center justify-center text-[#666] hover:text-[#aaa] transition-colors"
          title="設定"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>
          </svg>
        </button>
      </header>

      {showExport && !rendering && (
        <ExportModal
          onRender={(opts) => { if (projectId) render(projectId, opts) }}
          onClose={() => setShowExport(false)}
        />
      )}

      {(rendering || outputUrl || error) && (
        <RenderProgress
          rendering={rendering}
          progress={progress}
          messages={messages}
          outputUrl={outputUrl}
          error={error}
          onClose={() => { setShowExport(false); reset() }}
        />
      )}
    </>
  )
}

const FORMAT_OPTIONS = [
  { id: 'mp4',  label: 'MP4 (H.264)',   codec: 'H.264' },
  { id: 'mov',  label: 'MOV (H.264)',   codec: 'H.264' },
  { id: 'webm', label: 'WebM (VP9)',    codec: 'VP9' },
  { id: 'wav',  label: 'WAV (僅音訊)',  codec: 'PCM 16-bit' },
]

const FPS_OPTIONS = [24, 25, 30, 50, 60]

const BITRATE_OPTIONS = [
  { id: 'auto', label: '自動 (CRF)' },
  { id: '5M',   label: '5 Mbps' },
  { id: '8M',   label: '8 Mbps' },
  { id: '15M',  label: '15 Mbps' },
  { id: '25M',  label: '25 Mbps' },
  { id: '50M',  label: '50 Mbps' },
]

const AUDIO_BITRATE_OPTIONS = [
  { id: '128k', label: '128 kbps' },
  { id: '192k', label: '192 kbps' },
  { id: '256k', label: '256 kbps' },
  { id: '320k', label: '320 kbps' },
]

function resolutionIdToQuality(resId) {
  if (resId === '4k')   return '4k'
  if (resId === '2k')   return '2k'
  if (resId === '540p') return 'preview'
  if (resId === '720p') return '720p'
  return 'high'   // '1080p' and any future label fall here
}

// ── Export Modal (like CapCut's export dialog) ─────────────────────────────────
function ExportModal({ onRender, onClose }) {
  // ExportModal subscribes to project directly (used to receive it as a
  // prop, but that meant the parent Header had to keep a `s => s.project`
  // subscription alive for the whole app lifetime). This way only the
  // modal — open on demand — pays the full-project cost, and only while
  // it's mounted.
  const project = useProjectStore(s => s.project)
  const exportSettings = useProjectStore(s => s.exportSettings)
  const setExportSettings = useProjectStore(s => s.setExportSettings)
  const setExportRange = useProjectStore(s => s.setExportRange)
  const [resolution, setResolution] = useState('1080p')
  const [format, setFormat] = useState(exportSettings?.format ?? 'mp4')
  const [fps, setFps] = useState(exportSettings?.fps ?? 30)
  const [videoBitrate, setVideoBitrate] = useState(exportSettings?.videoBitrate ?? 'auto')
  const [audioBitrate, setAudioBitrate] = useState(exportSettings?.audioBitrate ?? '192k')
  const [outputDir, setOutputDir] = useState(exportSettings?.outputDir ?? '')

  if (!project) return null

  // Content end = latest clip end across all tracks. Used as default Out point.
  const contentEnd = (() => {
    const tracks = project.timeline?.tracks ?? []
    let max = 0
    for (const t of tracks) for (const c of (t.clips ?? [])) if (c.end > max) max = c.end
    return max > 0 ? max : (project.duration ?? 60)
  })()
  const range = project.exportRange ?? null
  const startSec = range?.in ?? 0
  const endSec = range?.out ?? contentEnd
  const fmtTime = (s) => {
    const m = Math.floor(s / 60), sec = Math.floor(s % 60)
    return `${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`
  }

  const ratioId = project.aspectRatio ?? '9:16'
  const ratio = ASPECT_RATIOS.find(r => r.id === ratioId) ?? ASPECT_RATIOS[0]
  const selectedRes = EXPORT_RESOLUTIONS.find(r => r.id === resolution)
  const shortDim = selectedRes?.scale ?? 1080
  const isPortrait = ratio.h > ratio.w
  const outW = isPortrait ? shortDim : Math.round(shortDim * (ratio.w / ratio.h))
  const outH = isPortrait ? Math.round(shortDim * (ratio.h / ratio.w)) : shortDim
  const finalW = outW % 2 === 0 ? outW : outW + 1
  const finalH = outH % 2 === 0 ? outH : outH + 1

  const formatInfo = FORMAT_OPTIONS.find(f => f.id === format) ?? FORMAT_OPTIONS[0]
  const audioOnly = format === 'wav'

  const handleExport = () => {
    const quality = resolutionIdToQuality(resolution)
    const baseOpts = {
      // Always pass range so the renderer can trim. startSec=0 is a no-op,
      // endSec=contentEnd matches the previous default behavior.
      startSec,
      endSec,
    }
    const opts = audioOnly
      ? {
          quality: 'high',
          format,
          outputDir: outputDir || undefined,
          ...baseOpts,
        }
      : {
          quality,
          format,
          fps,
          videoBitrate: videoBitrate === 'auto' ? undefined : videoBitrate,
          audioBitrate,
          outputDir: outputDir || undefined,
          ...baseOpts,
        }
    setExportSettings({ format, fps, videoBitrate, audioBitrate, outputDir })
    onRender(opts)
    onClose()
  }

  return (
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50" onClick={onClose}>
      <div data-testid="export-modal" className="bg-[#1a1a1a] border border-[#333] rounded-lg w-[560px] flex flex-col" onClick={e => e.stopPropagation()}>
        <div className="p-4 border-b border-[#2a2a2a] flex justify-between items-center">
          <h2 className="font-medium text-white">匯出</h2>
          <button onClick={onClose} className="text-[#666] hover:text-white text-xl">×</button>
        </div>

        <div className="flex p-5 gap-5">
          {/* Preview thumbnail */}
          <div className="flex items-center justify-center w-40 shrink-0">
            {audioOnly
              ? <AudioOnlyThumb />
              : <FirstFrameThumb project={project} ratio={ratio} />
            }
          </div>

          {/* Settings */}
          <div className="flex-1 space-y-3">
            <ExportRow label="名稱">{project.name}</ExportRow>

            <ExportSelect label="格式" value={format} onChange={setFormat}
              options={FORMAT_OPTIONS.map(f => ({ value: f.id, label: f.label }))} />

            {!audioOnly && (
              <>
                <ExportSelect label="解析度" value={resolution} onChange={setResolution}
                  testId="export-resolution"
                  options={EXPORT_RESOLUTIONS.map(r => ({ value: r.id, label: r.label }))} />

                <ExportRow label="輸出尺寸"><span className="font-mono text-xs">{finalW} x {finalH}</span></ExportRow>

                <ExportSelect label="影格率" value={String(fps)} onChange={v => setFps(Number(v))}
                  options={FPS_OPTIONS.map(f => ({ value: String(f), label: `${f} fps` }))} />

                <ExportSelect label="影片位元率" value={videoBitrate} onChange={setVideoBitrate}
                  options={BITRATE_OPTIONS.map(b => ({ value: b.id, label: b.label }))} />

                <ExportSelect label="音訊位元率" value={audioBitrate} onChange={setAudioBitrate}
                  options={AUDIO_BITRATE_OPTIONS.map(b => ({ value: b.id, label: b.label }))} />
              </>
            )}

            {audioOnly && (
              <ExportRow label="取樣"><span className="font-mono text-xs">44.1 kHz / 16-bit 立體聲</span></ExportRow>
            )}

            <div className="flex items-center gap-3">
              <span className="text-[11px] text-[#666] w-20 shrink-0">輸出位置</span>
              <input
                type="text"
                value={outputDir}
                onChange={e => setOutputDir(e.target.value)}
                placeholder="預設 (專案資料夾)"
                className="flex-1 bg-[#111] border border-[#333] rounded px-2 py-1 text-sm text-gray-300 placeholder-[#555] focus:outline-none focus:border-[#6d5efc]"
              />
            </div>

            <ExportRow label="編碼器">{formatInfo.codec}</ExportRow>

            <div className="flex items-center gap-3">
              <span className="text-[11px] text-[#666] w-20 shrink-0">輸出範圍</span>
              <span className="font-mono text-xs text-gray-300">
                {fmtTime(startSec)} → {fmtTime(endSec)}
                <span className="text-[#666] ml-2">({(endSec - startSec).toFixed(1)}s)</span>
              </span>
              {range && (
                <button
                  onClick={() => setExportRange(null)}
                  className="text-[10px] text-[#6d5efc] hover:underline ml-auto"
                >重設為完整</button>
              )}
            </div>
          </div>
        </div>

        <div className="p-4 border-t border-[#2a2a2a] flex justify-end items-center gap-3">
          <button
            onClick={onClose}
            className="px-4 py-1.5 bg-[#2a2a2a] hover:bg-[#333] text-[#aaa] text-sm rounded"
          >取消</button>
          <button
            onClick={handleExport}
            data-testid="export-submit"
            className="px-6 py-1.5 text-white text-sm rounded font-medium bg-[#6d5efc] hover:bg-[#5848e0]"
          >匯出</button>
        </div>
      </div>
    </div>
  )
}

function ExportRow({ label, children }) {
  return (
    <div className="flex items-center gap-3">
      <span className="text-[11px] text-[#666] w-20 shrink-0">{label}</span>
      <span className="text-sm text-[#ccc]">{children}</span>
    </div>
  )
}

function ExportSelect({ label, value, onChange, options, testId }) {
  return (
    <div className="flex items-center gap-3">
      <span className="text-[11px] text-[#666] w-20 shrink-0">{label}</span>
      <select
        value={value}
        onChange={e => onChange(e.target.value)}
        data-testid={testId}
        className="flex-1 bg-[#111] border border-[#333] rounded px-2 py-1 text-sm text-gray-300 focus:outline-none focus:border-[#6d5efc]"
      >
        {options.map(o => (
          <option key={o.value} value={o.value} disabled={o.disabled}>{o.label}</option>
        ))}
      </select>
    </div>
  )
}

function AudioOnlyThumb() {
  return (
    <div className="bg-[#252525] rounded border border-[#333] flex flex-col items-center justify-center text-[#666] w-full aspect-square gap-2">
      <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="#22c55e" strokeWidth="1.5">
        <path d="M9 18V5l12-2v13" />
        <circle cx="6" cy="18" r="3" />
        <circle cx="18" cy="16" r="3" />
      </svg>
      <span className="text-[10px] text-[#888]">僅音訊 WAV</span>
    </div>
  )
}

function FirstFrameThumb({ project, ratio }) {
  const tracks = project?.timeline?.tracks ?? []
  const videoTrack = tracks.filter(t => t.type === 'video').sort((a, b) => a.order - b.order)[0]
  const firstClip = videoTrack?.clips?.sort((a, b) => a.start - b.start)[0]

  const thumbSrc = firstClip
    ? `/api/projects/${project.id}/assets/thumbnail/${encodeURIComponent(firstClip.source)}`
    : null

  const style = {
    aspectRatio: `${ratio.w}/${ratio.h}`,
    width: ratio.w >= ratio.h ? '100%' : undefined,
    height: ratio.w < ratio.h ? 180 : undefined,
  }

  const [err, setErr] = useState(false)

  if (!thumbSrc || err) {
    return (
      <div className="bg-[#252525] rounded border border-[#333] flex items-center justify-center text-[#555] text-xs overflow-hidden" style={style}>
        {ratio.w}:{ratio.h}
      </div>
    )
  }

  return (
    <div className="relative rounded border border-[#333] overflow-hidden bg-black" style={style}>
      <img
        src={thumbSrc}
        alt="首幀預覽"
        className="absolute inset-0 w-full h-full object-cover"
        onError={() => setErr(true)}
      />
    </div>
  )
}
