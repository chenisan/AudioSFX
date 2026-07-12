import { useState, useEffect } from 'react'
import { useProjectStore, ASPECT_RATIOS } from '../../stores/projectStore'
import AboutPanel from '../common/AboutPanel'
import Screws from '../skeuo/Screws'
import ampTex from '../../assets/textures/amp-panel-dark.png'

const TABS = [
  { id: 'project', label: '專案' },
  { id: 'performance', label: '效能' },
  { id: 'general', label: '一般' },
  { id: 'about', label: '關於' },
]

const FORMAT_LABEL = { mp4: 'H.264 MP4', mov: 'ProRes MOV', webm: 'VP9 WebM' }

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`
}

export default function SettingsModal({ onClose, defaultTab = 'project' }) {
  const initialTab = TABS.some(t => t.id === defaultTab) ? defaultTab : 'project'
  const [tab, setTab] = useState(initialTab)
  const [settings, setSettings] = useState(null)
  const [capabilities, setCapabilities] = useState({})
  const [storageSize, setStorageSize] = useState(0)
  const [storagePath, setStoragePath] = useState('')
  const [dirty, setDirty] = useState(false)
  const [saving, setSaving] = useState(false)

  const refresh = () => {
    fetch('/api/settings').then(r => r.json()).then(data => {
      setSettings(data.settings)
      setCapabilities(data.capabilities ?? {})
      setStorageSize(data.storageSize ?? 0)
      setStoragePath(data.storagePath ?? '')
    }).catch(() => {})
  }

  useEffect(() => { refresh() }, [])

  const updateSetting = (key, value) => {
    setSettings(prev => ({ ...prev, [key]: value }))
    setDirty(true)
  }

  const handleSave = async () => {
    setSaving(true)
    try {
      await fetch('/api/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(settings),
      })
      setDirty(false)
      onClose()
    } catch {}
    setSaving(false)
  }

  const handleClearCache = async () => {
    if (!confirm('確定要清除所有渲染快取嗎？')) return
    const res = await fetch('/api/settings/cache', { method: 'DELETE' })
    const data = await res.json()
    alert(`已清除 ${data.cleared} 個快取檔案`)
    fetch('/api/settings').then(r => r.json()).then(data => {
      setStorageSize(data.storageSize ?? 0)
    }).catch(() => {})
  }

  if (!settings) return null

  return (
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50" onClick={onClose}>
      <div
        className="amp-faceplate relative border border-black/70 rounded-lg w-[600px] max-h-[80vh] flex flex-col overflow-hidden shadow-[0_16px_48px_rgba(0,0,0,0.7)]"
        style={{ '--amp-tex': `url(${ampTex})` }}
        onClick={e => e.stopPropagation()}
      >
        <Screws />
        {/* Header */}
        <div className="amp-rail px-5 py-3 flex justify-between items-center shrink-0">
          <h2 className="text-[12px] font-semibold tracking-[0.2em] text-[#e8e2d6]" style={{ textShadow: '0 1px 2px rgba(0,0,0,0.9)' }}>設定</h2>
          <button onClick={onClose} className="text-[#8a8378] hover:text-white text-xl leading-none">×</button>
        </div>

        {/* Tabs */}
        <div className="flex border-b border-black/60 shrink-0 px-5">
          {TABS.map(t => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`px-5 py-2.5 text-xs font-medium tracking-[0.08em] transition-colors border-b-2 ${
                tab === t.id
                  ? 'text-[#e8e2d6] border-[#6d5efc]'
                  : 'text-[#8a8378] border-transparent hover:text-[#d8d2c6]'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto px-5 py-4">
          {tab === 'project' && <ProjectInfoTab />}

          {tab === 'performance' && (
            <div className="space-y-6">
              <SettingGroup label="編碼和解碼">
                <CheckRow
                  label="加速硬體編碼"
                  hint={capabilities.nvenc ? 'NVENC 可用' : 'NVENC 不可用（將使用 CPU）'}
                  checked={settings.hwEncoding}
                  disabled={!capabilities.nvenc}
                  onChange={v => updateSetting('hwEncoding', v)}
                />
                <CheckRow
                  label="加速硬體解碼"
                  hint={capabilities.cuvid ? 'CUVID 可用' : 'CUVID 不可用'}
                  checked={settings.hwDecoding}
                  disabled={!capabilities.cuvid}
                  onChange={v => updateSetting('hwDecoding', v)}
                />
              </SettingGroup>

              <SettingGroup label="介面算圖">
                <CheckRow
                  label="使用 GPU 呈現介面"
                  checked={settings.gpuPreview}
                  onChange={v => updateSetting('gpuPreview', v)}
                />
              </SettingGroup>

              <SettingGroup label="Proxy">
                <CheckRow
                  label="啟用 Proxy 預覽"
                  hint="開啟此功能可以順暢且快速編輯，而不會損失影片畫質。"
                  checked={settings.proxyEnabled}
                  onChange={v => updateSetting('proxyEnabled', v)}
                />
              </SettingGroup>
            </div>
          )}

          {tab === 'general' && (
            <div className="space-y-6">
              <SettingGroup label="儲存空間">
                <div className="flex items-center justify-between py-1.5">
                  <span className="text-xs text-[#999]">將檔案儲存到</span>
                  <span className="amp-inset text-xs text-[#9a948b] font-mono border border-black/60 rounded px-2 py-1 max-w-[300px] truncate">
                    {storagePath}
                  </span>
                </div>
                <div className="flex items-center justify-between py-1.5">
                  <span className="text-xs text-[#999]">儲存空間大小</span>
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-[#ccc] font-mono">{formatBytes(storageSize)}</span>
                    <button
                      onClick={handleClearCache}
                      className="text-[10px] text-[#666] hover:text-red-400 border border-[#333] rounded px-2 py-0.5"
                      title="清除渲染快取"
                    >
                      清除快取
                    </button>
                  </div>
                </div>
              </SettingGroup>

              <SettingGroup label="渲染預設">
                <div className="flex items-center justify-between py-1.5">
                  <span className="text-xs text-[#999]">預設編碼器</span>
                  <span className="text-xs text-[#ccc]">
                    {capabilities.nvenc && settings.hwEncoding ? 'h264_nvenc (GPU)' : 'libx264 (CPU)'}
                  </span>
                </div>
                <div className="flex items-center justify-between py-1.5">
                  <span className="text-xs text-[#999]">輸出格式</span>
                  <span className="text-xs text-[#ccc]">MP4 (H.264)</span>
                </div>
              </SettingGroup>
            </div>
          )}

          {tab === 'about' && <AboutTab />}
        </div>

        {/* Footer */}
        <div className="px-5 py-3 border-t border-black/60 flex justify-end gap-3 shrink-0">
          <button
            onClick={onClose}
            className="px-6 py-1.5 rounded text-sm bg-black/30 border border-black/50 text-[#9a948b] hover:text-[#d8d2c6] hover:bg-black/20 transition-colors"
          >
            取消
          </button>
          <button
            onClick={handleSave}
            disabled={!dirty || saving}
            className="px-6 py-1.5 bg-[#6d5efc] hover:bg-[#5848e0] disabled:bg-[#333] disabled:text-[#555] disabled:shadow-none text-white text-sm rounded font-medium transition-colors shadow-[0_0_12px_rgba(109,94,252,0.35)]"
          >
            {saving ? '儲存中...' : '儲存'}
          </button>
        </div>
      </div>
    </div>
  )
}

/**
 * Project info tab — shows the currently-open project's metadata.
 */
function ProjectInfoTab() {
  const project = useProjectStore(s => s.project)
  const exportSettings = useProjectStore(s => s.exportSettings)

  if (!project) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-[#555] text-sm gap-2">
        <span className="text-3xl">📋</span>
        <span>尚未開啟專案</span>
      </div>
    )
  }

  const tracks = project.timeline?.tracks ?? []
  const trackCount = tracks.length
  const videoTracks = tracks.filter(t => t.type === 'video')
  const textTracks = tracks.filter(t => t.type === 'text')
  const audioTracks = tracks.filter(t => t.type === 'audio')
  const totalClips = tracks.reduce((sum, t) => sum + (t.clips?.length ?? 0), 0)

  const ratioId = project.aspectRatio ?? '9:16'
  const ratio = ASPECT_RATIOS.find(r => r.id === ratioId)
  const orient = ratio ? (ratio.w > ratio.h ? '橫式' : ratio.w === ratio.h ? '正方' : '直式') : '—'

  const fmtTime = (ts) => ts ? new Date(ts).toLocaleString('zh-TW') : '—'

  return (
    <div className="space-y-5">
      <div className="text-[10px] text-[#666] leading-relaxed">
        以下是<span className="text-[#ccc]">此專案</span>的詳細資料（非全域預設）。要修改全域預設請看「效能」「一般」分頁。
      </div>

      <SettingGroup label="專案">
        <ProjInfoRow label="名稱" value={project.name} />
        <ProjInfoRow label="ID" value={project.id} mono />
        <ProjInfoRow label="長度" value={`${project.duration}s`} />
      </SettingGroup>

      <SettingGroup label="輸出設定">
        <div className="grid grid-cols-2 gap-x-6">
          <ProjInfoRow label="比例" value={`${ratioId} (${orient})`} />
          <ProjInfoRow label="格式" value={FORMAT_LABEL[exportSettings?.format ?? 'mp4'] ?? 'H.264 MP4'} />
          <ProjInfoRow label="FPS" value={`${exportSettings?.fps ?? 30} fps`} />
          <ProjInfoRow label="色彩空間" value="Rec. 709 SDR" />
        </div>
      </SettingGroup>

      <SettingGroup label="時間軸組成">
        <div className="grid grid-cols-2 gap-x-6">
          <ProjInfoRow label="軌道數" value={`${trackCount} 軌`} />
          <ProjInfoRow label="片段數" value={`${totalClips} 個`} />
        </div>
        <ProjInfoRow
          label="軌道組成"
          value={`影片 ${videoTracks.length} · 文字 ${textTracks.length} · 音訊 ${audioTracks.length}`}
        />
      </SettingGroup>

      <SettingGroup label="時間戳">
        <div className="grid grid-cols-2 gap-x-6">
          <ProjInfoRow label="建立時間" value={fmtTime(project.createdAt)} mono />
          <ProjInfoRow label="最後修改" value={fmtTime(project.updatedAt)} mono />
        </div>
      </SettingGroup>
    </div>
  )
}

/**
 * About tab — software intro + author links. Links open in the system browser.
 */
function AboutTab() {
  return (
    <div className="space-y-6">
      <AboutPanel />
      <SettingGroup label="技術">
        <div className="flex items-center justify-between py-1.5">
          <span className="text-xs text-[#999]">引擎</span>
          <span className="text-xs text-[#ccc]">ffmpeg + Node.js · MMAudio + Woosh</span>
        </div>
      </SettingGroup>
    </div>
  )
}

function ProjInfoRow({ label, value, mono }) {
  return (
    <div className="py-1.5">
      <div className="text-[10px] text-[#666] mb-0.5">{label}</div>
      <div className={`text-xs ${mono ? 'text-[#888] font-mono break-all' : 'text-[#ddd] font-medium'}`}>
        {value}
      </div>
    </div>
  )
}

function SettingGroup({ label, children }) {
  return (
    <div>
      <div className="text-[11px] text-[#8a8378] tracking-[0.12em] mb-3">{label}</div>
      <div className="amp-bezel px-4 py-2 divide-y divide-black/40">
        {children}
      </div>
    </div>
  )
}

function CheckRow({ label, hint, checked, disabled, onChange }) {
  return (
    <div className="flex items-start gap-3 py-2.5">
      <button
        onClick={() => !disabled && onChange(!checked)}
        disabled={disabled}
        className={`w-5 h-5 rounded border flex items-center justify-center shrink-0 mt-0.5 transition-colors ${
          checked && !disabled
            ? 'bg-[#6d5efc] border-[#6d5efc] shadow-[0_0_8px_rgba(109,94,252,0.4)]'
            : disabled
              ? 'bg-[#222] border-[#333] cursor-not-allowed'
              : 'amp-inset border-black/60 hover:border-[#555]'
        }`}
      >
        {checked && (
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="3">
            <polyline points="20 6 9 17 4 12" />
          </svg>
        )}
      </button>
      <div className="flex-1 min-w-0">
        <div className={`text-xs ${disabled ? 'text-[#555]' : 'text-[#ccc]'}`}>{label}</div>
        {hint && <div className="text-[10px] text-[#555] mt-0.5">{hint}</div>}
      </div>
    </div>
  )
}
