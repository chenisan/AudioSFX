import { useState, useEffect } from 'react'
import { useProjectStore } from '../../stores/projectStore'

// Floating bottom-center indicator for long audio generations (MMAudio /
// Woosh V2A) which run synchronously with no sub-step progress. Shows a
// spinner + a live elapsed-seconds counter so it's clear work is happening.
export default function AudioGenIndicator() {
  const gen = useProjectStore(s => s.audioGen)
  const [elapsed, setElapsed] = useState(0)

  useEffect(() => {
    if (!gen) return
    setElapsed(Math.floor((Date.now() - gen.startedAt) / 1000))
    const id = setInterval(() => setElapsed(Math.floor((Date.now() - gen.startedAt) / 1000)), 500)
    return () => clearInterval(id)
  }, [gen])

  if (!gen) return null

  return (
    <div className="fixed bottom-5 left-1/2 -translate-x-1/2 z-50 flex items-center gap-3 bg-[#1a1a1a] border border-[#6d5efc]/60 rounded-lg px-4 py-2.5 shadow-2xl">
      <span className="w-4 h-4 rounded-full border-2 border-[#6d5efc] border-t-transparent animate-spin shrink-0" />
      <div className="leading-tight">
        <div className="text-xs text-[#ddd]">{gen.label}</div>
        <div className="text-[10px] text-[#888] font-mono">
          已 {elapsed}s{elapsed < 60 ? '（首次含模型載入，可能到 1 分鐘）' : ''}
        </div>
      </div>
    </div>
  )
}
