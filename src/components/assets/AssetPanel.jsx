import { useState, useEffect, useRef } from 'react'
import { useProjectStore } from '../../stores/projectStore'
import { useProject } from '../../hooks/useProject'
import FolderedList from '../common/FolderedList'

const ACCEPT = 'video/*,audio/*,image/*,.mp4,.mov,.mp3,.wav,.aac'

function isVideo(filename) {
  return /\.(mp4|mov|avi|webm|mkv)$/i.test(filename)
}
function isAudio(filename) {
  return /\.(mp3|wav|aac|m4a|ogg)$/i.test(filename)
}
function isImage(filename) {
  return /\.(jpg|jpeg|png|apng|gif|webp)$/i.test(filename)
}

function formatSize(bytes) {
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

// ── Asset Card ─────────────────────────────────────────────────────────────────
function getAssetType(filename) {
  if (isVideo(filename)) return 'video'
  if (isAudio(filename)) return 'audio'
  if (isImage(filename)) return 'image'
  return 'other'
}

const TYPE_LABEL = { video: '影音', audio: '聲音', image: '圖片', other: '其他' }
const TYPE_BADGE_CLASS = {
  video: 'bg-blue-500/20 text-blue-300',
  audio: 'bg-green-500/20 text-green-300',
  image: 'bg-purple-500/20 text-purple-300',
  other: 'bg-[#333] text-[#888]',
}

function AssetCard({ asset, projectId, onDelete, isActive, onSelect }) {
  const [thumbError, setThumbError] = useState(false)

  const thumbSrc = isVideo(asset.filename)
    ? `/api/projects/${projectId}/assets/thumbnail/${encodeURIComponent(asset.filename)}`
    : isAudio(asset.filename)
      ? `/api/projects/${projectId}/assets/waveform/${encodeURIComponent(asset.filename)}`
      : isImage(asset.filename)
        ? `/assets/${projectId}/${encodeURIComponent(asset.filename)}`
        : null

  const handleDragStart = (e) => {
    e.dataTransfer.setData('application/json', JSON.stringify(asset))
    e.dataTransfer.effectAllowed = 'copy'
  }

  const type = getAssetType(asset.filename)

  return (
    <div
      className={`flex items-center gap-2 p-1.5 rounded cursor-grab group ${isActive ? 'bg-[#6d5efc]/15 ring-1 ring-[#6d5efc]/40' : 'hover:bg-[#2a2a2a]'}`}
      draggable
      onDragStart={handleDragStart}
      onClick={() => onSelect(asset.filename, type)}
      title={`${asset.filename}\n點擊預覽 · 拖曳到時間軸`}
    >
      {/* Thumbnail / waveform / icon */}
      <div className="w-10 h-10 rounded overflow-hidden bg-[#1a1a1a] shrink-0 flex items-center justify-center">
        {thumbSrc && !thumbError ? (
          <img
            src={thumbSrc}
            alt=""
            className="w-full h-full object-cover"
            onError={() => setThumbError(true)}
          />
        ) : (
          <span className="text-lg">
            {type === 'video' ? '🎬' : type === 'audio' ? '🎵' : type === 'image' ? '🖼️' : '📄'}
          </span>
        )}
      </div>

      {/* Metadata */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1">
          <span className={`text-[9px] px-1 rounded shrink-0 ${TYPE_BADGE_CLASS[type]}`}>
            {TYPE_LABEL[type]}
          </span>
          <span className="text-xs text-[#ccc] truncate leading-tight">{asset.filename}</span>
        </div>
        <div className="text-[10px] text-[#555] mt-0.5">
          {formatSize(asset.size)}
          {asset.duration && ` · ${asset.duration.toFixed(1)}s`}
        </div>
      </div>

      {/* Delete */}
      <button
        draggable={false}
        onMouseDown={(e) => e.stopPropagation()}
        onClick={(e) => { e.stopPropagation(); e.preventDefault(); onDelete(asset.filename) }}
        className="opacity-0 group-hover:opacity-100 text-[#444] hover:text-red-400 text-sm px-1 shrink-0"
        title="刪除"
      >✕</button>
    </div>
  )
}

// ── Upload Queue Item ──────────────────────────────────────────────────────────
function UploadItem({ name, progress, error }) {
  return (
    <div className="px-2 py-1.5">
      <div className="flex justify-between text-[10px] mb-1">
        <span className="text-[#888] truncate max-w-[130px]">{name}</span>
        <span className={error ? 'text-red-400' : 'text-[#555]'}>
          {error ? '失敗' : progress < 100 ? `${progress}%` : '✓'}
        </span>
      </div>
      <div className="h-1 rounded bg-[#2a2a2a] overflow-hidden">
        <div
          className={`h-full rounded transition-all ${error ? 'bg-red-500' : progress < 100 ? 'bg-[#6d5efc]' : 'bg-[#22c55e]'}`}
          style={{ width: `${progress}%` }}
        />
      </div>
    </div>
  )
}

// ── AssetPanel ─────────────────────────────────────────────────────────────────
export default function AssetPanel() {
  // Narrowed — AssetPanel only needs the projectId; full project subscription
  // dragged it into the cascade where every clip mutation re-rendered the
  // 30-card grid for nothing.
  const projectId = useProjectStore(s => s.project?.id)
  const assetVersion = useProjectStore(s => s.assetVersion)
  const bumpAssetVersion = useProjectStore(s => s.bumpAssetVersion)
  const previewAsset = useProjectStore(s => s.previewAsset)
  const setPreviewAsset = useProjectStore(s => s.setPreviewAsset)
  const { fetchAssets, uploadAssetWithProgress } = useProject()
  const [assets, setAssets] = useState([])
  const [uploads, setUploads] = useState([])  // [{ name, progress, error }]
  const [isDragOver, setIsDragOver] = useState(false)
  const [typeFilter, setTypeFilter] = useState('all')  // 'all' | 'video' | 'image' | 'audio'
  // Sort preference, persisted across sessions. Default 'name' matches the
  // server's natural readdir order. 'newest' sorts by mtime desc so just-
  // uploaded / just-generated files float to the top — the common ask
  // during editing sessions.
  const [sortMode, setSortMode] = useState(() => localStorage.getItem('13soul.assetSort') || 'name')
  useEffect(() => { localStorage.setItem('13soul.assetSort', sortMode) }, [sortMode])
  const fileInputRef = useRef(null)
  const audioRef = useRef(null)   // hidden player for click-to-audition audio assets

  // Click an asset → preview-select it; for audio, also play it immediately
  // (click is a user gesture, so autoplay is allowed). Re-click restarts.
  const handleSelect = (filename, type) => {
    setPreviewAsset(filename, type)
    if (type === 'audio' && projectId && audioRef.current) {
      const el = audioRef.current
      el.src = `/assets/${projectId}/${encodeURIComponent(filename)}`
      el.currentTime = 0
      el.play().catch(() => {})
    }
  }

  const filteredAssets = (() => {
    const base = typeFilter === 'all'
      ? assets
      : assets.filter(a => getAssetType(a.filename) === typeFilter)
    if (sortMode === 'newest') {
      // Defensive: older project loads pre-mtime-field still work — fall
      // back to filename order when mtimeMs is missing.
      return [...base].sort((a, b) => (b.mtimeMs ?? 0) - (a.mtimeMs ?? 0))
    }
    return [...base].sort((a, b) => a.filename.localeCompare(b.filename, 'zh-Hant'))
  })()

  const reload = async () => {
    if (!projectId) return
    try { setAssets(await fetchAssets(projectId)) } catch {}
  }

  useEffect(() => { reload() }, [projectId, assetVersion])

  const handleFiles = async (files) => {
    if (!projectId || !files?.length) return
    const fileList = [...files]

    // Initialize upload state
    setUploads(fileList.map(f => ({ name: f.name, progress: 0, error: false })))

    for (let i = 0; i < fileList.length; i++) {
      const file = fileList[i]
      try {
        await uploadAssetWithProgress(projectId, file, (pct) => {
          setUploads(prev => prev.map((u, idx) => idx === i ? { ...u, progress: pct } : u))
        })
        setUploads(prev => prev.map((u, idx) => idx === i ? { ...u, progress: 100 } : u))
      } catch {
        setUploads(prev => prev.map((u, idx) => idx === i ? { ...u, error: true, progress: 100 } : u))
      }
    }

    bumpAssetVersion()
    setTimeout(() => setUploads([]), 2000)
  }

  const handleDelete = async (filename) => {
    if (!projectId || !confirm(`刪除 ${filename}？`)) return
    try {
      await fetch(`/api/projects/${projectId}/assets/${encodeURIComponent(filename)}`, { method: 'DELETE' })
      setAssets(a => a.filter(x => x.filename !== filename))
    } catch {}
  }

  const onDragOver = (e) => {
    if ([...e.dataTransfer.types].includes('Files')) {
      e.preventDefault()
      setIsDragOver(true)
    }
  }
  const onDragLeave = () => setIsDragOver(false)
  const onDrop = (e) => {
    e.preventDefault()
    setIsDragOver(false)
    handleFiles([...e.dataTransfer.files])
  }

  return (
    <div
      className={`flex flex-col h-full transition-colors ${isDragOver ? 'bg-[#6d5efc]/10' : ''}`}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
    >
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-[#2a2a2a] shrink-0">
        <span className="text-xs text-[#888]">素材 {assets.length > 0 && `(${assets.length})`}</span>
        <div className="flex gap-1 items-center">
          {/* Sort toggle — single button cycling between filename-asc and
              mtime-desc. Compact icon-only to keep the header narrow. */}
          <button
            onClick={() => setSortMode(s => s === 'name' ? 'newest' : 'name')}
            className="text-[10px] text-[#888] hover:text-[#ccc] px-1.5 py-0.5 rounded border border-[#333] hover:border-[#555] transition-colors"
            title={sortMode === 'name' ? '依檔名排序（點擊改成新到舊）' : '新到舊排序（點擊改成檔名）'}
          >
            {sortMode === 'name' ? 'A→Z' : '🕒新'}
          </button>
          <button onClick={reload} className="text-xs text-[#666] hover:text-[#999] px-1" title="重新整理">↻</button>
          <button
            onClick={() => fileInputRef.current?.click()}
            disabled={!projectId}
            className="text-xs bg-[#2a2a2a] hover:bg-[#333] disabled:opacity-40 text-[#aaa] px-2 py-0.5 rounded"
          >+ 上傳</button>
        </div>
      </div>

      <input
        ref={fileInputRef}
        type="file"
        accept={ACCEPT}
        multiple
        className="hidden"
        onChange={(e) => handleFiles([...e.target.files])}
      />

      {/* Type filter */}
      {assets.length > 0 && (
        <div className="flex gap-1 px-2 py-1.5 border-b border-[#2a2a2a] shrink-0">
          {[
            { key: 'all', label: '全部' },
            { key: 'video', label: '影音' },
            { key: 'image', label: '圖片' },
            { key: 'audio', label: '聲音' },
          ].map(({ key, label }) => {
            const count = key === 'all' ? assets.length : assets.filter(a => getAssetType(a.filename) === key).length
            const active = typeFilter === key
            return (
              <button
                key={key}
                onClick={() => setTypeFilter(key)}
                className={`text-[10px] px-2 py-0.5 rounded transition-colors ${
                  active
                    ? 'bg-[#6d5efc] text-white'
                    : 'bg-[#2a2a2a] text-[#888] hover:bg-[#333] hover:text-[#ccc]'
                }`}
              >
                {label} {count > 0 && <span className="opacity-70">({count})</span>}
              </button>
            )
          })}
        </div>
      )}

      {/* Upload progress */}
      {uploads.length > 0 && (
        <div className="border-b border-[#2a2a2a] shrink-0">
          {uploads.map((u, i) => <UploadItem key={i} {...u} />)}
        </div>
      )}

      {/* Asset list */}
      <div className="flex-1 overflow-y-auto min-h-0">
        {!projectId ? (
          <div className="text-center text-[#444] text-xs py-8">請先選擇專案</div>
        ) : assets.length === 0 ? (
          <div className={`flex flex-col items-center justify-center h-full text-center text-xs py-8 transition-colors ${isDragOver ? 'text-[#6d5efc]' : 'text-[#444]'}`}>
            <div className="text-2xl mb-2">{isDragOver ? '⬇' : '📁'}</div>
            <div>{isDragOver ? '放開以匯入' : '拖入檔案或點「上傳」'}</div>
          </div>
        ) : filteredAssets.length === 0 ? (
          <div className="text-center text-[#444] text-xs py-8">
            此類型沒有素材
          </div>
        ) : (
          <FolderedList
            namespace="asset"
            items={filteredAssets}
            getItemId={a => a.filename}
            uncategorisedLabel="未分類"
            renderItem={(asset) => (
              <AssetCard
                asset={asset}
                projectId={projectId}
                onDelete={handleDelete}
                isActive={previewAsset?.filename === asset.filename}
                onSelect={handleSelect}
              />
            )}
          />
        )}
      </div>

      {/* Drop hint when hovering with files */}
      {isDragOver && assets.length > 0 && (
        <div className="absolute inset-0 flex items-center justify-center bg-[#0d0d0d]/60 pointer-events-none rounded">
          <div className="text-[#6d5efc] text-sm font-medium">放開以匯入</div>
        </div>
      )}

      {/* Hidden player — click-to-audition audio assets */}
      <audio ref={audioRef} className="hidden" />
    </div>
  )
}
