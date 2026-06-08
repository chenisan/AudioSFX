import { useState } from 'react'
import SfxPanel from './SfxPanel'
import SfxLibraryPanel from './SfxLibraryPanel'

// Content of the floating「音效」window: two tabs —
//   生成   — text→SFX via Woosh (needs the GPU engine running)
//   音效庫 — bundled CC0 library (Kenney.nl), instant, no engine needed
export default function SfxWindow() {
  const [tab, setTab] = useState('library')   // default to the no-engine path

  const Tab = ({ id, label }) => (
    <button
      onClick={() => setTab(id)}
      className={`flex-1 py-1.5 text-xs font-medium transition-colors border-b-2 ${
        tab === id
          ? 'border-[#22c55e] text-white'
          : 'border-transparent text-[#888] hover:text-[#ccc]'
      }`}
    >{label}</button>
  )

  return (
    <div className="flex flex-col h-full">
      <div className="flex shrink-0 border-b border-[#2a2a2a]">
        <Tab id="library" label="音效庫" />
        <Tab id="generate" label="AI 生成" />
      </div>
      <div className="flex-1 min-h-0">
        {tab === 'library' ? <SfxLibraryPanel /> : <SfxPanel />}
      </div>
    </div>
  )
}
