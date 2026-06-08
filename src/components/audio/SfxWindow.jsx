import { useState } from 'react'
import SfxPanel from './SfxPanel'
import SfxLibraryPanel from './SfxLibraryPanel'
import LocalLibraryPanel from './LocalLibraryPanel'

// Content of the floating「音效」window: three tabs —
//   音效庫 — bundled CC0 library (Kenney.nl), instant, no engine needed
//   本機   — the user's own local SFX folder (e.g. D:\sfx_sample, Sonniss packs)
//   AI 生成 — text→SFX via Woosh (needs the GPU engine running)
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
        <Tab id="local" label="本機" />
        <Tab id="generate" label="AI 生成" />
      </div>
      <div className="flex-1 min-h-0">
        {tab === 'library' ? <SfxLibraryPanel />
          : tab === 'local' ? <LocalLibraryPanel />
          : <SfxPanel />}
      </div>
    </div>
  )
}
