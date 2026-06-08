import { useState, useEffect, useCallback, useRef } from 'react'
import { useProjectStore } from './stores/projectStore'
import { useProject } from './hooks/useProject'
import { useKeyboardShortcuts } from './hooks/useKeyboardShortcuts'
import Header from './components/layout/Header'
import Resizer from './components/layout/Resizer'
import FloatingPreview from './components/preview/FloatingPreview'
import FloatingWindow from './components/timeline/FloatingWindow'
import AssetPanel from './components/assets/AssetPanel'
import SfxWindow from './components/audio/SfxWindow'
import TrackEffectsTab from './components/timeline/TrackEffectsTab'
import AudioGenIndicator from './components/audio/AudioGenIndicator'
import Timeline from './components/timeline/Timeline'
import Toast from './components/common/Toast'
import SettingsModal from './components/layout/SettingsModal'
import AboutPanel from './components/common/AboutPanel'
import GuidedTour from './components/common/GuidedTour'

// ── Project Modal ──────────────────────────────────────────────────────────────
function ProjectModal({ onClose }) {
  const { fetchProjects, createProject, loadProject, deleteProject } = useProject()
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

// ── Left panel — asset library + SFX generation (tabbed) ───────────────────────
const LEFT_TABS = [['assets', '素材'], ['effects', '效果']]

function LeftPanel() {
  const [tab, setTab] = useState('assets')
  return (
    <div className="flex flex-col h-full bg-[#1a1a1a]">
      <div data-tour="left-tabs" className="flex border-b border-[#2a2a2a] shrink-0">
        {LEFT_TABS.map(([id, label]) => (
          <button
            key={id}
            onClick={() => setTab(id)}
            className={`flex-1 py-1.5 text-xs transition-colors ${tab === id ? 'text-white border-b-2 border-[#6d5efc]' : 'text-[#555] hover:text-[#888]'}`}
          >
            {label}
          </button>
        ))}
      </div>
      <div className="flex-1 overflow-hidden">
        {tab === 'assets' ? <AssetPanel /> : <TrackEffectsTab />}
      </div>
    </div>
  )
}

// ── Startup About window — shown on every app open (brand poster + intro). Its
// 「下一步」launches the feature tour; the checkbox disables the tour for next
// time (the About page itself still always shows).
function StartupAboutModal({ dismissed, onToggleDismiss, onSkip, onNext }) {
  return (
    <div className="fixed inset-0 z-[70] bg-black/85 flex items-center justify-center p-4">
      <div className="bg-[#1a1a1a] border border-[#333] rounded-xl w-[460px] max-h-[92vh] flex flex-col overflow-hidden shadow-2xl">
        <div className="overflow-y-auto p-5">
          <AboutPanel />
        </div>
        <div className="p-4 border-t border-[#2a2a2a] flex items-center justify-between shrink-0 gap-3">
          <label className="flex items-center gap-2 text-[11px] text-[#888] hover:text-[#aaa] cursor-pointer select-none">
            <input
              type="checkbox"
              checked={dismissed}
              onChange={e => onToggleDismiss(e.target.checked)}
              className="accent-[#6d5efc] cursor-pointer"
            />
            下次開啟不再顯示導引
          </label>
          <div className="flex items-center gap-2 shrink-0">
            <button
              onClick={onSkip}
              className="px-4 py-1.5 bg-[#2a2a2a] hover:bg-[#333] text-[#aaa] text-sm rounded"
            >{dismissed ? '進入 AudioSFX' : '跳過'}</button>
            {!dismissed && (
              <button
                onClick={onNext}
                className="px-5 py-1.5 text-white text-sm rounded font-medium bg-[#6d5efc] hover:bg-[#5848e0]"
              >下一步：功能導引 ▶</button>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

// ── Root App ───────────────────────────────────────────────────────────────────
// Layout: left column (panels) | right column (full-height timeline). Video
// preview is a floating window. No properties panel.
export default function App() {
  const [showProjectModal, setShowProjectModal] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [settingsDefaultTab, setSettingsDefaultTab] = useState('performance')
  const [globalDropping, setGlobalDropping] = useState(false)
  const [showStartupAbout, setShowStartupAbout] = useState(true)   // 開啟時先顯示關於我
  const [showTour, setShowTour] = useState(false)
  const [tourDismissed, setTourDismissed] = useState(() => {
    try { return localStorage.getItem('13soul.tourDismissed') === '1' } catch { return false }
  })
  const setDismiss = (v) => {
    setTourDismissed(v)
    try { localStorage.setItem('13soul.tourDismissed', v ? '1' : '0') } catch {}
  }

  const openSettings = (tab = 'performance') => {
    setSettingsDefaultTab(tab)
    setSettingsOpen(true)
  }
  const projectId = useProjectStore(s => s.project?.id)
  const bumpAssetVersion = useProjectStore(s => s.bumpAssetVersion)
  const previewOpen = useProjectStore(s => s.previewOpen)
  const sfxOpen = useProjectStore(s => s.sfxOpen)
  const setSfxOpen = useProjectStore(s => s.setSfxOpen)
  const isPlaying = useProjectStore(s => s.isPlaying)
  const { uploadAsset } = useProject()
  useKeyboardShortcuts()

  // Auto-open the floating preview when playback starts (spacebar / play button)
  // so the video is always visible when you hit play.
  useEffect(() => {
    if (isPlaying && !useProjectStore.getState().previewOpen) {
      useProjectStore.getState().setPreviewOpen(true)
    }
  }, [isPlaying])

  // ── Resizable layout ────────────────────────────────────────────────────────
  // Left column = LeftPanel (full height). Video preview is now a floating
  // window (FloatingPreview), no longer docked in the left column.
  const containerRef = useRef(null)
  const [leftColWidth, setLeftColWidth] = useState(360)   // left column width (px)

  const handleLeftColResize = useCallback((_, clientX) => {
    setLeftColWidth(Math.max(260, Math.min(600, clientX)))
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

  return (
    <div className="flex flex-col h-screen bg-[#0d0d0d] text-gray-200 font-sans overflow-hidden">
      <Header
        onOpenProjectModal={() => setShowProjectModal(true)}
        onOpenSettings={() => openSettings()}
      />

      <div ref={containerRef} className="flex-1 flex overflow-hidden">
        {/* Left column: assets / SFX / effects (full height). Preview floats. */}
        <div className="flex flex-col overflow-hidden shrink-0" style={{ width: leftColWidth }}>
          <LeftPanel />
        </div>

        <Resizer direction="horizontal" onResize={handleLeftColResize} />

        {/* Right: full-height timeline */}
        <div className="flex-1 overflow-hidden min-w-0">
          <Timeline />
        </div>
      </div>

      {showProjectModal && <ProjectModal onClose={() => setShowProjectModal(false)} />}
      {settingsOpen && <SettingsModal defaultTab={settingsDefaultTab} onClose={() => setSettingsOpen(false)} />}

      {/* Floating video preview (toggle from Header「預覽」). */}
      {previewOpen && <FloatingPreview />}

      {/* Floating SFX-generation window (toggle from Header「音效」). */}
      {sfxOpen && (
        <FloatingWindow
          title="音效"
          onClose={() => setSfxOpen(false)}
          width={440}
          height={Math.min(580, window.innerHeight - 110)}
          storageKey="13soul.sfx"
          initialX={420}
          initialY={90}
        >
          <SfxWindow />
        </FloatingWindow>
      )}

      {/* Startup About — first thing shown when the app opens */}
      {showStartupAbout && (
        <StartupAboutModal
          dismissed={tourDismissed}
          onToggleDismiss={setDismiss}
          onSkip={() => setShowStartupAbout(false)}
          onNext={() => { setShowStartupAbout(false); setShowTour(true) }}
        />
      )}

      {/* Feature tour — launched from the startup About「下一步」 */}
      {showTour && <GuidedTour onClose={() => setShowTour(false)} />}

      <Toast />
      <AudioGenIndicator />

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
