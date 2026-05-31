import { useState, useEffect, useCallback, useRef } from 'react'
import { useProjectStore } from './stores/projectStore'
import { useProject } from './hooks/useProject'
import { useKeyboardShortcuts } from './hooks/useKeyboardShortcuts'
import Header from './components/layout/Header'
import Resizer from './components/layout/Resizer'
import PreviewPanel from './components/preview/PreviewPanel'
import PropertyPanel from './components/properties/PropertyPanel'
import AssetPanel from './components/assets/AssetPanel'
import Timeline from './components/timeline/Timeline'
import Toast from './components/common/Toast'
import SettingsModal from './components/layout/SettingsModal'

// ── Project Modal ──────────────────────────────────────────────────────────────
function ProjectModal({ onClose }) {
  const { fetchProjects, createProject, loadProject, deleteProject } = useProject()
  // Narrowed — only need id for the active-row highlight check.
  const currentProjectId = useProjectStore(s => s.project?.id)
  const [projects, setProjects] = useState([])
  const [newName, setNewName] = useState('')
  const [newDuration, setNewDuration] = useState(30)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    fetchProjects().then(setProjects).catch(() => {})
  }, [])

  const handleCreate = async () => {
    if (!newName.trim()) return
    setLoading(true)
    try {
      await createProject(newName.trim(), newDuration)
      onClose()
    } catch (e) { alert(e.message) }
    setLoading(false)
  }

  const handleLoad = async (id) => {
    setLoading(true)
    try { await loadProject(id); onClose() } catch (e) { alert(e.message) }
    setLoading(false)
  }

  const handleDelete = async (e, id) => {
    e.stopPropagation()
    if (!confirm('確定刪除？')) return
    await deleteProject(id).catch(() => {})
    setProjects(p => p.filter(x => x.id !== id))
  }

  return (
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50" onClick={onClose}>
      <div className="bg-[#1a1a1a] border border-[#333] rounded-lg w-[480px] max-h-[70vh] flex flex-col"
        onClick={e => e.stopPropagation()}>
        <div className="p-4 border-b border-[#2a2a2a] flex justify-between items-center">
          <h2 className="font-medium">專案</h2>
          <button onClick={onClose} className="text-[#666] hover:text-white text-xl">×</button>
        </div>

        {/* New project */}
        <div className="p-4 border-b border-[#2a2a2a] space-y-2">
          <div className="text-xs text-[#666] mb-2">新建專案</div>
          <div className="flex gap-2">
            <input
              value={newName}
              onChange={e => setNewName(e.target.value)}
              placeholder="專案名稱"
              onKeyDown={e => e.key === 'Enter' && handleCreate()}
              className="flex-1 bg-[#111] border border-[#333] rounded px-3 py-1.5 text-sm text-gray-300 focus:outline-none focus:border-[#6d5efc]"
            />
            <input
              type="number"
              value={newDuration}
              onChange={e => { const v = parseInt(e.target.value); if (!isNaN(v)) setNewDuration(v) }}
              className="w-16 bg-[#111] border border-[#333] rounded px-2 py-1.5 text-sm text-gray-300 focus:outline-none"
              title="時長（秒）"
            />
            <span className="text-xs text-[#555] self-center">s</span>
            <button
              onClick={handleCreate}
              disabled={!newName.trim() || loading}
              className="bg-[#6d5efc] hover:bg-[#5848e0] disabled:opacity-50 text-white text-sm px-4 py-1.5 rounded"
            >
              建立
            </button>
          </div>
        </div>

        {/* Existing projects */}
        <div className="flex-1 overflow-y-auto p-2">
          {projects.length === 0 ? (
            <div className="text-center text-[#444] text-sm py-8">沒有專案</div>
          ) : (
            projects.map(p => (
              <div
                key={p.id}
                onClick={() => handleLoad(p.id)}
                className={`flex items-center justify-between p-3 rounded cursor-pointer hover:bg-[#252525] group ${currentProjectId === p.id ? 'bg-[#252525] border border-[#6d5efc]/30' : ''}`}
              >
                <div>
                  <div className="text-sm text-[#ccc]">{p.name}</div>
                  <div className="text-xs text-[#555] font-mono mt-0.5">{p.id.slice(0, 8)}… · {p.duration}s</div>
                </div>
                <button
                  onClick={e => handleDelete(e, p.id)}
                  className="text-[#444] hover:text-red-400 opacity-0 group-hover:opacity-100 text-sm px-1"
                >✕</button>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  )
}

// ── Left panel — asset library only (stickers/templates/subtitles/tts removed) ──
function LeftPanel({ width }) {
  return (
    <div className="flex flex-col h-full bg-[#1a1a1a]" style={{ width }}>
      <div className="flex border-b border-[#2a2a2a] shrink-0 px-3 py-2 text-xs text-white">素材</div>
      <div className="flex-1 overflow-hidden">
        <AssetPanel />
      </div>
    </div>
  )
}

// ── Right panel — clip properties only (effects removed) ───────────────────────
function RightPanel({ width }) {
  return (
    <div className="flex flex-col h-full bg-[#1a1a1a]" style={{ width }}>
      <div className="flex border-b border-[#2a2a2a] shrink-0 px-3 py-2 text-xs text-white">屬性</div>
      <div className="flex-1 overflow-hidden">
        <PropertyPanel />
      </div>
    </div>
  )
}

// ── Root App ───────────────────────────────────────────────────────────────────
export default function App() {
  const [showProjectModal, setShowProjectModal] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [settingsDefaultTab, setSettingsDefaultTab] = useState('performance')
  const [globalDropping, setGlobalDropping] = useState(false)

  const openSettings = (tab = 'performance') => {
    setSettingsDefaultTab(tab)
    setSettingsOpen(true)
  }
  // Narrowed — App-level only needs projectId for the global file-drop upload.
  const projectId = useProjectStore(s => s.project?.id)
  const bumpAssetVersion = useProjectStore(s => s.bumpAssetVersion)
  const { uploadAsset } = useProject()
  useKeyboardShortcuts()

  // ── Resizable panel sizes ──────────────────────────────────────────────────
  const containerRef = useRef(null)
  const [topHeight, setTopHeight] = useState(0.45)
  const [leftWidth, setLeftWidth] = useState(240)
  const [rightWidth, setRightWidth] = useState(280)

  const handleTopResize = useCallback((_, clientY) => {
    const container = containerRef.current
    if (!container) return
    const rect = container.getBoundingClientRect()
    const newFrac = Math.max(0.2, Math.min(0.75, (clientY - rect.top) / rect.height))
    setTopHeight(newFrac)
  }, [])

  const handleLeftResize = useCallback((_, clientX) => {
    setLeftWidth(Math.max(180, Math.min(400, clientX)))
  }, [])

  const handleRightResize = useCallback((_, clientX) => {
    setRightWidth(Math.max(200, Math.min(450, window.innerWidth - clientX)))
  }, [])

  // Global OS file drop
  useEffect(() => {
    const onDragOver = (e) => {
      if ([...e.dataTransfer.types].includes('Files') && projectId) {
        e.preventDefault()
        e.dataTransfer.dropEffect = 'copy'
        setGlobalDropping(true)
      }
    }
    const onDragLeave = (e) => {
      if (e.relatedTarget === null) setGlobalDropping(false)
    }
    const onDrop = async (e) => {
      const files = [...e.dataTransfer.files]
      setGlobalDropping(false)
      if (!files.length || !projectId || e.dataTransfer.types.includes('application/json')) return
      e.preventDefault()
      for (const file of files) {
        try { await uploadAsset(projectId, file) } catch {}
      }
      bumpAssetVersion()
    }
    const onDragEnd = () => setGlobalDropping(false)
    window.addEventListener('dragover', onDragOver)
    window.addEventListener('dragleave', onDragLeave)
    window.addEventListener('drop', onDrop)
    window.addEventListener('dragend', onDragEnd)
    return () => {
      window.removeEventListener('dragover', onDragOver)
      window.removeEventListener('dragleave', onDragLeave)
      window.removeEventListener('drop', onDrop)
      window.removeEventListener('dragend', onDragEnd)
    }
  }, [projectId])

  const topPct = `${topHeight * 100}%`

  return (
    <div className="flex flex-col h-screen bg-[#0d0d0d] text-gray-200 font-sans overflow-hidden">
      <Header
        onOpenProjectModal={() => setShowProjectModal(true)}
        onOpenSettings={() => openSettings()}
      />

      <div ref={containerRef} className="flex-1 flex flex-col overflow-hidden">
        {/* Upper: Left (assets) | Preview (center) | Right (properties) */}
        <div className="flex shrink-0 overflow-hidden" style={{ height: topPct }}>
          <LeftPanel width={leftWidth} />
          <Resizer direction="horizontal" onResize={handleLeftResize} />
          <div className="flex-1 overflow-hidden">
            <PreviewPanel />
          </div>
          <Resizer direction="horizontal" onResize={handleRightResize} />
          <RightPanel width={rightWidth} />
        </div>

        {/* Horizontal divider */}
        <Resizer direction="vertical" onResize={handleTopResize} />

        {/* Lower: Timeline */}
        <div className="flex-1 overflow-hidden">
          <Timeline />
        </div>
      </div>

      {showProjectModal && <ProjectModal onClose={() => setShowProjectModal(false)} />}
      {settingsOpen && <SettingsModal defaultTab={settingsDefaultTab} onClose={() => setSettingsOpen(false)} />}

      <Toast />

      {/* Global drop overlay */}
      {globalDropping && projectId && (
        <div className="fixed inset-0 z-40 pointer-events-none border-4 border-dashed border-[#6d5efc] flex items-center justify-center bg-black/40">
          <div className="bg-[#1a1a1a] border border-[#6d5efc] rounded-xl px-6 py-4 text-center">
            <div className="text-3xl mb-2">⬇</div>
            <div className="text-[#6d5efc] font-medium">放開以匯入素材</div>
          </div>
        </div>
      )}
    </div>
  )
}
