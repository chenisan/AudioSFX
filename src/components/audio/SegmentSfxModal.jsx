import { useState } from 'react'
import { useProjectStore } from '../../stores/projectStore'

const SEG = 8   // Woosh-DVFlow is a fixed 8-second model

function fmt(t) {
  const m = Math.floor(t / 60), s = Math.floor(t % 60)
  return `${m}:${String(s).padStart(2, '0')}`
}

// Split a video clip into 8-second segments and generate Woosh V2A SFX per
// segment on demand, aligned back onto the timeline. Works around DVFlow's
// fixed 8s window by sliding the source extraction start.
export default function SegmentSfxModal({ clip, onClose }) {
  const projectId = useProjectStore(s => s.project?.id)
  const audioGen = useProjectStore(s => s.audioGen)
  const [done, setDone] = useState({})        // { [segIndex]: true }

  const clipDur = Math.max(0.1, clip.end - clip.start)
  const trimStart = clip.trimStart ?? 0
  const sourceDur = clip.sourceDuration ?? (trimStart + clipDur)
  const count = Math.max(1, Math.ceil(clipDur / SEG))

  const segments = Array.from({ length: count }, (_, i) => {
    const timelineStart = clip.start + i * SEG
    const segLen = Math.min(SEG, clipDur - i * SEG)
    // Source window must be a full 8s inside the source; clamp the last one.
    let srcStart = trimStart + i * SEG
    if (sourceDur >= SEG) srcStart = Math.max(0, Math.min(srcStart, sourceDur - SEG))
    return { i, timelineStart, segLen, srcStart }
  })

  const busy = !!audioGen

  const genSegment = async (seg) => {
    if (!projectId || busy) return
    const store = useProjectStore.getState()
    store.beginAudioGen?.(`正在生成第 ${seg.i + 1}/${count} 段音效…`)
    try {
      const res = await fetch('/api/audio/v2a', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectId, source: clip.source, start: Number(seg.srcStart.toFixed(2)) }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`)
      // Place the (8s) result trimmed to this segment's visible length, aligned
      // to the segment's timeline position.
      const newClip = {
        source: data.filename,
        start: seg.timelineStart,
        end: seg.timelineStart + seg.segLen,
        sourceDuration: data.durationSec || SEG,
      }
      const audioTrack = store.project?.timeline?.tracks?.find(t => t.type === 'audio')
      if (audioTrack) store.addClip(audioTrack.id, newClip)
      else store.addTrackWithClip('audio', newClip)
      store.bumpAssetVersion?.()
      setDone(d => ({ ...d, [seg.i]: true }))
      store.showToast?.(`第 ${seg.i + 1} 段音效已加到音軌`, 'success')
    } catch (e) {
      store.showToast?.(`生成失敗：${e.message}`, 'warn')
    } finally {
      store.endAudioGen?.()
    }
  }

  return (
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-[60]" onClick={onClose}>
      <div className="bg-[#1a1a1a] border border-[#333] rounded-lg w-[440px] max-h-[80vh] flex flex-col" onClick={e => e.stopPropagation()}>
        <div className="px-4 py-3 border-b border-[#2a2a2a] flex justify-between items-center">
          <div>
            <h2 className="text-sm font-medium text-white">分段配音 (Woosh V2A)</h2>
            <div className="text-[10px] text-[#666] mt-0.5 truncate max-w-[360px]">{clip.source} · 每段 8 秒 · 共 {count} 段</div>
          </div>
          <button onClick={onClose} className="text-[#666] hover:text-white text-xl leading-none">×</button>
        </div>

        <div className="flex-1 overflow-y-auto p-2 space-y-1">
          {segments.map(seg => (
            <div key={seg.i} className="flex items-center gap-2 bg-[#111] border border-[#2a2a2a] rounded px-2.5 py-2">
              <span className="text-[10px] text-[#666] font-mono w-6 shrink-0">#{seg.i + 1}</span>
              <div className="flex-1 min-w-0">
                <div className="text-xs text-[#ccc] font-mono">{fmt(seg.timelineStart)} – {fmt(seg.timelineStart + seg.segLen)}</div>
                <div className="text-[9px] text-[#555]">時間軸位置 · 取樣源 {fmt(seg.srcStart)}＋8s</div>
              </div>
              {done[seg.i] && <span className="text-[10px] text-green-400 shrink-0">✓ 已生成</span>}
              <button
                onClick={() => genSegment(seg)}
                disabled={busy}
                className="text-[10px] px-2.5 py-1 rounded border border-[#3a2db5] text-white bg-[#6d5efc] hover:bg-[#5848e0] disabled:bg-[#2e2a5c] disabled:text-[#777] shrink-0"
              >
                {done[seg.i] ? '重生' : '生成'}
              </button>
            </div>
          ))}
        </div>

        <div className="px-4 py-2.5 border-t border-[#2a2a2a] text-[10px] text-[#666] leading-relaxed">
          一次生一段（GPU 一次跑一個）。生成中會在底部顯示進度。最後一段不足 8 秒時會自動裁齊。
        </div>
      </div>
    </div>
  )
}
