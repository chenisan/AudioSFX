import { useProjectStore } from '../../stores/projectStore'
import { useShallow } from 'zustand/react/shallow'
import { Section, Row, Unit, Mono, NumInput } from './_widgets'
import TextClipProperties from './TextClipProperties'
import VideoClipProperties from './VideoClipProperties'
import AudioClipProperties from './AudioClipProperties'

/**
 * Top-level property panel. Reads selection from the store, computes the
 * shared update helpers, then dispatches to the appropriate clip-type
 * sub-panel.
 *
 * The `helpers` object passed to sub-panels is the canonical surface for
 * mutating clip data — sub-panels never call `updateClip` directly. This
 * keeps the multi-select fan-out + pushUndo logic in one place.
 *
 * To add a new clip type:
 *   1. add a new file `XxxClipProperties.jsx` in this folder
 *   2. import + dispatch on `track.type` below
 */
export default function PropertyPanel() {
  const selectedClip = useProjectStore(s => s.selectedClip)
  const selectedClips = useProjectStore(s => s.selectedClips)
  // Narrowed — projectId for sketch DELETE call; tracks (useShallow) for
  // clip lookup. The full `project` subscription forced this panel to
  // re-render on every project mutation; now only track-shape changes
  // do so.
  const projectId = useProjectStore(s => s.project?.id)
  const tracks = useProjectStore(useShallow(s => s.project?.timeline?.tracks ?? []))
  const updateClip = useProjectStore(s => s.updateClip)
  const updateClipsBatch = useProjectStore(s => s.updateClipsBatch)
  const removeClip = useProjectStore(s => s.removeClip)
  const playheadTime = useProjectStore(s => s.playheadTime)

  if (!selectedClip || !projectId) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-[#444] text-xs text-center px-4 gap-2">
        <span className="text-2xl">✏️</span>
        <span>點選時間軸上的片段<br />查看並編輯屬性</span>
      </div>
    )
  }

  const { trackId, index } = selectedClip
  const track = tracks.find(t => t.id === trackId)
  const clip = track?.clips[index]
  if (!clip) return null

  const multi = selectedClips.length > 1

  // ── Update helpers ──────────────────────────────────────────────────────────
  // Single-target by default; if multi-select is active, fan out to each
  // selected clip. Each helper pushes a single undo snapshot before mutating.

  /** Apply patch to primary clip only (for unique fields like timing, text). */
  const update = (u) => {
    useProjectStore.getState().pushUndo()
    updateClip(trackId, index, u)
  }

  // Multi-select fan-out: batch one round-trip via updateClipsBatch so 338
  // 字幕 toggle 陰影 = 1 PATCH + 1 disk write, not 338 of each. Single-target
  // still uses plain updateClip (cheaper, same semantics).

  /** Apply style patch to ALL selected clips, merging on top of each clip's style. */
  const updateStyleAll = (u) => {
    useProjectStore.getState().pushUndo()
    if (multi) {
      const ops = selectedClips
        .map(({ trackId: tid, index: idx }) => {
          const c = tracks.find(t => t.id === tid)?.clips[idx]
          if (!c) return null
          return { trackId: tid, index: idx, updates: { style: { ...(c.style ?? {}), ...u } } }
        })
        .filter(Boolean)
      updateClipsBatch(ops)
    } else {
      updateClip(trackId, index, { style: { ...(clip.style ?? {}), ...u } })
    }
  }

  const updateNestedAll = (key) => (u) => {
    useProjectStore.getState().pushUndo()
    if (multi) {
      const ops = selectedClips
        .map(({ trackId: tid, index: idx }) => {
          const c = tracks.find(t => t.id === tid)?.clips[idx]
          if (!c) return null
          return { trackId: tid, index: idx, updates: { [key]: { ...(c[key] ?? {}), ...u } } }
        })
        .filter(Boolean)
      updateClipsBatch(ops)
    } else {
      updateClip(trackId, index, { [key]: { ...(clip[key] ?? {}), ...u } })
    }
  }

  const helpers = {
    update,
    updateStyle: updateStyleAll,
    updateAnim:   (u) => updateStyleAll({ animation:   { ...(clip.style?.animation   ?? {}), ...u } }),
    updateBg:     (u) => updateStyleAll({ background:  { ...(clip.style?.background  ?? {}), ...u } }),
    updatePos:    (u) => updateStyleAll({ position:    { ...(clip.style?.position    ?? { x: 'center', y: '82%' }), ...u } }),
    updateShadow: (u) => updateStyleAll({ shadow:      { ...(clip.style?.shadow      ?? {}), ...u } }),
    updateTrans:  updateNestedAll('transition'),
    updateFilter: updateNestedAll('filter'),
    updateOverlay: updateNestedAll('overlay'),
  }

  // ── Dispatch to sub-panel ──────────────────────────────────────────────────

  const isText   = track.type === 'text'
  const isVideo  = track.type === 'video'
  const isAudio  = track.type === 'audio'
  const isSketch = track.type === 'script' && !!clip.assetId


  // Overlay = video clip on a non-primary video track. Drives keyframes + blend visibility.
  const videoTracks = tracks.filter(t => t.type === 'video').sort((a, b) => a.order - b.order)
  const isOverlay = isVideo && videoTracks.length > 1 && videoTracks[0].id !== trackId

  return (
    <div className="h-full overflow-y-auto text-[#ccc]">
      {/* Header: multi-select indicator + delete button. The single-select
          "track.name · clip N" label was removed to save vertical space. */}
      <div className="flex items-center justify-between px-3 py-1 border-b border-[#2a2a2a] sticky top-0 bg-[#1a1a1a] z-10">
        <span className="text-[10px] text-[#666] uppercase tracking-wide">
          {multi ? <span className="text-[#6d5efc]">{selectedClips.length} 個片段已選取</span> : null}
        </span>
        <button
          onClick={() => {
            if (isSketch && clip.assetId && projectId) {
              fetch(`/api/projects/${projectId}/sketch-assets/${clip.assetId}`, { method: 'DELETE' }).catch(() => {})
            }
            removeClip(trackId, index)
          }}
          className="text-[10px] text-[#444] hover:text-red-400 px-1"
        >✕ 刪除</button>
      </div>

      <div className="p-3 space-y-5">

        {isSketch && (
          <div className="text-[10px] text-[#555] bg-[#111] rounded px-3 py-2 leading-relaxed">
            雙擊片段 或 右鍵 → 編輯草圖
          </div>
        )}

        {/* ── Common timing — shown for all clip types ── */}
        <Section title="時間">
          <Row label="開始"><NumInput value={clip.start} step={0.1} min={0} onChange={v => update({ start: +v })} /><Unit>s</Unit></Row>
          <Row label="結束"><NumInput value={clip.end}   step={0.1} min={0} onChange={v => update({ end: +v })} /><Unit>s</Unit></Row>
          <Row label="時長"><Mono>{(clip.end - clip.start).toFixed(2)}s</Mono></Row>
        </Section>

        {/* ── Per-type properties ── */}
        {isText  && <TextClipProperties  clip={clip} helpers={helpers} />}
        {isVideo && <VideoClipProperties clip={clip} playheadTime={playheadTime} helpers={helpers} isOverlay={isOverlay} />}
        {isAudio && <AudioClipProperties clip={clip} playheadTime={playheadTime} helpers={helpers} />}
      </div>
    </div>
  )
}
