import { useState, useRef, memo } from 'react'
import { useProjectStore } from '../../stores/projectStore'
import { useAssetDrop } from '../../hooks/useDragDrop'
import Clip from './Clip'
import TrackMeter from './TrackMeter'
import PointContextMenu from './PointContextMenu'
import CreateSfxModal from '../audio/CreateSfxModal'
import { timeToPx, pxToTime } from '../../utils/timeFormat'

const TRACK_TYPE_ICONS = { video: '🎬', text: '🔤', audio: '🎵', script: '🎨' }
const LABEL_WIDTH = 140

const HEIGHT_SIZES = {
  small:   { label: '矮', trackH: 36, clipH: 32 },
  default: { label: '預設', trackH: 48, clipH: 44 },
  large:   { label: '高', trackH: 72, clipH: 68 },
}

export function getTrackHeight(track) {
  return HEIGHT_SIZES[track?.heightSize] ?? HEIGHT_SIZES.default
}

// Track now selects its own track-by-id from the store rather than receiving
// the full `track` prop. With the per-track narrow selector, mutations on
// OTHER tracks (the common case during a clip drag) don't change THIS
// track's reference, so memo holds and the component skips re-render. The
// outer Timeline.jsx now just hands down trackId; that prop is identity-
// stable across project mutations, so the memoized Track survives.
export default memo(function Track({ trackId, contentRef, isDragging, isDragOver, onTrackDragStart, onTrackDragOver, onTrackDrop, onTrackDragEnd }) {
  // Narrow per-track selector. Returns the same reference for unchanged
  // tracks (updateTrackClips uses .map() which preserves the non-target
  // track refs), so this re-renders only when THIS track's data actually
  // changes — the entire point of the cascade fix.
  const track = useProjectStore(s => s.project?.timeline.tracks.find(t => t.id === trackId))
  // Project-level fields used by Track. Kept granular so a duration tick
  // doesn't trigger a re-render of unrelated tracks.
  const projectDuration = useProjectStore(s => s.project?.duration ?? 0)
  const zoom = useProjectStore(s => s.zoom)
  const clearSelection = useProjectStore(s => s.clearSelection)
  const removeTrack = useProjectStore(s => s.removeTrack)
  const renameTrack = useProjectStore(s => s.renameTrack)
  const toggleTrackLocked = useProjectStore(s => s.toggleTrackLocked)
  const toggleTrackHidden = useProjectStore(s => s.toggleTrackHidden)
  const toggleTrackMuted = useProjectStore(s => s.toggleTrackMuted)
  const setTrackHeight = useProjectStore(s => s.setTrackHeight)
  const setTrackGapMode = useProjectStore(s => s.setTrackGapMode)
  const setLastCursor = useProjectStore(s => s.setLastCursor)
  const setSelectedClipsBatch = useProjectStore(s => s.setSelectedClipsBatch)
  // Selected track = the track holding the primary selected clip (set by both
  // clicking a clip and clicking the track label / batch-select).
  const isSelectedTrack = useProjectStore(s => s.selectedClip?.trackId === trackId)
  const { onDrop, onDragOver } = useAssetDrop({ trackId, trackType: track?.type, containerRef: contentRef })
  const [isEditing, setIsEditing] = useState(false)
  const [editName, setEditName] = useState('')
  const [showMenu, setShowMenu] = useState(false)
  const [subMenu, setSubMenu] = useState(null)  // 'height' | 'waveform'
  const [pointMenu, setPointMenu] = useState(null)   // empty-space right-click menu: { x, y, time }
  const [createSfx, setCreateSfx] = useState(null)   // Create-SFX modal: { trackId, time }
  const inputRef = useRef(null)
  const menuRef = useRef(null)

  if (!track) return null
  const clips = track.clips ?? []
  const totalWidth = timeToPx(projectDuration, zoom)

  const { trackH, clipH } = getTrackHeight(track)
  const currentSize = track.heightSize ?? 'default'

  const handleDoubleClick = () => {
    setEditName(track.name)
    setIsEditing(true)
    setTimeout(() => inputRef.current?.select(), 0)
  }

  const handleRenameSubmit = () => {
    if (editName.trim()) renameTrack(track.id, editName.trim())
    setIsEditing(false)
  }

  const handleRemove = (e) => {
    e.stopPropagation()
    if (clips.length > 0 && !confirm(`刪除軌道 "${track.name}"？(含 ${clips.length} 個片段)`)) return
    removeTrack(track.id)
  }

  const closeMenu = () => { setShowMenu(false); setSubMenu(null) }

  // Click on the label column = select every clip on this track. Skipped
  // when the click lands on any inner control (drag handle, rename input,
  // lock / hide / mute / more buttons) so those keep their own behaviour.
  const handleLabelClick = (e) => {
    if (e.target.closest('button, input, [data-track-drag-handle]')) return
    if (isEditing) return
    if (clips.length === 0) {
      clearSelection()
      return
    }
    setSelectedClipsBatch(clips.map((_, idx) => ({ trackId: track.id, index: idx })))
  }

  return (
    <div
      className={`flex border-b border-[#2a2a2a] transition-colors ${isDragOver ? 'border-t-2 border-t-[#6d5efc]' : ''} ${isDragging ? 'opacity-50' : ''}`}
      style={{ height: trackH }}
      onDragOver={(e) => { e.preventDefault(); onTrackDragOver?.(track.id) }}
      onDrop={(e) => { e.preventDefault(); onTrackDrop?.(track.id) }}
    >
      {/* Track label + per-track meter. Fixed LABEL_WIDTH so the meter lives
          inside the gutter and the clip lane / playhead stay aligned. The meter
          hugs the right edge → visually sits at the track's left edge. */}
      <div
        className={`flex-shrink-0 flex border-r border-[#2a2a2a] ${
          track.muted ? 'bg-[#241d0f]' : isSelectedTrack ? 'bg-[#1f1b30]' : 'bg-[#1a1a1a]'
        } ${isSelectedTrack ? 'shadow-[inset_3px_0_0_#6d5efc]' : ''}`}
        style={{ width: LABEL_WIDTH }}
      >
      <div
        className="flex-1 min-w-0 flex flex-col justify-center px-1.5 group cursor-pointer"
        onClick={handleLabelClick}
        title="點擊：全選本軌道上的片段"
      >
        {/* Row 1: drag handle + track name + remove */}
        <div className="flex items-center gap-1" onDoubleClick={handleDoubleClick}>
          {/* Drag handle */}
          <div
            data-track-drag-handle
            draggable
            onDragStart={(e) => { e.dataTransfer.effectAllowed = 'move'; onTrackDragStart?.(track.id) }}
            onDragEnd={() => onTrackDragEnd?.()}
            className="cursor-ns-resize text-[#3a3a3a] hover:text-[#666] shrink-0 select-none"
            title="拖拉重排順序"
          >⠿</div>
          <span className="text-[10px] shrink-0">{track.role === 'sfx' ? '🔊' : (TRACK_TYPE_ICONS[track.type] ?? '🎬')}</span>
          {isEditing ? (
            <input
              ref={inputRef}
              value={editName}
              onChange={e => setEditName(e.target.value)}
              onBlur={handleRenameSubmit}
              onKeyDown={e => { if (e.key === 'Enter') handleRenameSubmit(); if (e.key === 'Escape') setIsEditing(false) }}
              className="flex-1 bg-[#111] text-[10px] text-[#ccc] px-1 rounded outline-none border border-[#6d5efc] w-0 min-w-0"
            />
          ) : (
            <span className={`text-[10px] truncate flex-1 ${track.locked ? 'text-[#555]' : 'text-[#888]'}`}>{track.name}</span>
          )}
          <button
            onClick={handleRemove}
            className="hidden group-hover:flex items-center justify-center w-3 h-3 text-[8px] text-[#555] hover:text-red-400 shrink-0"
            title="移除軌道"
          >✕</button>
        </div>

        {/* Row 2: collapse, lock, eye, mute, more */}
        <div className="flex items-center gap-1 mt-0.5">
          <TrackIconBtn
            active={false}
            icon={<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="6 9 12 15 18 9"/></svg>}
            title="摺疊"
            onClick={() => {}}
          />

          <TrackIconBtn
            active={track.locked}
            icon={track.locked
              ? <svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4" fill="none" stroke="currentColor" strokeWidth="2"/></svg>
              : <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>
            }
            title={track.locked ? '解鎖軌道' : '鎖定軌道'}
            onClick={() => toggleTrackLocked(track.id)}
          />

          <TrackIconBtn
            active={track.hidden}
            icon={track.hidden
              ? <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94"/><path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19"/><line x1="1" y1="1" x2="23" y2="23"/></svg>
              : <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
            }
            title={track.hidden ? '顯示軌道' : '隱藏軌道'}
            onClick={() => toggleTrackHidden(track.id)}
          />

          <TrackIconBtn
            active={track.muted}
            icon={track.muted
              ? <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><line x1="23" y1="9" x2="17" y2="15"/><line x1="17" y1="9" x2="23" y2="15"/></svg>
              : <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><path d="M15.54 8.46a5 5 0 010 7.07"/></svg>
            }
            title={track.muted ? '取消靜音' : '靜音'}
            onClick={() => toggleTrackMuted(track.id)}
          />

          {/* More menu */}
          <div className="relative" ref={menuRef}>
            <TrackIconBtn
              active={showMenu}
              icon={<svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor"><circle cx="5" cy="12" r="2"/><circle cx="12" cy="12" r="2"/><circle cx="19" cy="12" r="2"/></svg>}
              title="更多"
              onClick={() => { setShowMenu(!showMenu); setSubMenu(null) }}
            />
            {showMenu && (
              <>
                <div className="fixed inset-0 z-40" onClick={closeMenu} />
                <div className="absolute left-0 bottom-full mb-1 bg-[#2a2a2a] border border-[#444] rounded-lg shadow-xl z-50 py-1 min-w-[150px]">
                  {/* Track height */}
                  <div className="relative">
                    <button
                      onClick={() => setSubMenu(subMenu === 'height' ? null : 'height')}
                      className="w-full flex items-center justify-between px-3 py-1.5 text-xs text-[#ccc] hover:bg-[#3a3a3a]"
                    >
                      <span>資料軌高度</span>
                      <span className="text-[#666] text-[10px] ml-2">›</span>
                    </button>
                    {subMenu === 'height' && (
                      <div className="absolute left-full top-0 ml-1 bg-[#2a2a2a] border border-[#444] rounded-lg shadow-xl z-50 py-1 min-w-[80px]">
                        {Object.entries(HEIGHT_SIZES).map(([key, { label }]) => (
                          <button
                            key={key}
                            onClick={() => { setTrackHeight(track.id, key); closeMenu() }}
                            className={`w-full flex items-center gap-2 px-3 py-1.5 text-xs hover:bg-[#3a3a3a] ${currentSize === key ? 'text-[#6d5efc]' : 'text-[#ccc]'}`}
                          >
                            {currentSize === key && <span className="text-[#6d5efc]">✓</span>}
                            {currentSize !== key && <span className="w-3" />}
                            {label}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>

                  {/* Waveform size — audio-only alias for track height (the audio
                      clip IS the waveform, so amplitude = trackH). */}
                  {track.type === 'audio' && (
                    <div className="relative">
                      <button
                        onClick={() => setSubMenu(subMenu === 'waveform' ? null : 'waveform')}
                        className="w-full flex items-center justify-between px-3 py-1.5 text-xs text-[#ccc] hover:bg-[#3a3a3a]"
                      >
                        <span>音訊波形大小</span>
                        <span className="text-[#666] text-[10px] ml-2">›</span>
                      </button>
                      {subMenu === 'waveform' && (
                        <div className="absolute left-full top-0 ml-1 bg-[#2a2a2a] border border-[#444] rounded-lg shadow-xl z-50 py-1 min-w-[80px]">
                          {Object.entries(HEIGHT_SIZES).map(([key, { label }]) => (
                            <button
                              key={key}
                              onClick={() => { setTrackHeight(track.id, key); closeMenu() }}
                              className={`w-full flex items-center gap-2 px-3 py-1.5 text-xs hover:bg-[#3a3a3a] ${currentSize === key ? 'text-[#6d5efc]' : 'text-[#ccc]'}`}
                            >
                              {currentSize === key && <span className="text-[#6d5efc]">✓</span>}
                              {currentSize !== key && <span className="w-3" />}
                              {label}
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  )}

                  {/* Gap fill mode — video tracks only, affects only the main track at render time */}
                  {track.type === 'video' && (
                    <div className="relative">
                      <button
                        onClick={() => setSubMenu(subMenu === 'gap' ? null : 'gap')}
                        className="w-full flex items-center justify-between px-3 py-1.5 text-xs text-[#ccc] hover:bg-[#3a3a3a]"
                      >
                        <span>空白填法</span>
                        <span className="text-[#666] text-[10px] ml-2">›</span>
                      </button>
                      {subMenu === 'gap' && (
                        <div className="absolute left-full top-0 ml-1 bg-[#2a2a2a] border border-[#444] rounded-lg shadow-xl z-50 py-1 min-w-[100px]">
                          {[
                            { key: 'black',  label: '黑場' },
                            { key: 'freeze', label: '凍結前一幀' },
                          ].map(opt => {
                            const current = track.gapMode ?? 'black'
                            return (
                              <button
                                key={opt.key}
                                onClick={() => { setTrackGapMode(track.id, opt.key); closeMenu() }}
                                className={`w-full flex items-center gap-2 px-3 py-1.5 text-xs hover:bg-[#3a3a3a] ${current === opt.key ? 'text-[#6d5efc]' : 'text-[#ccc]'}`}
                              >
                                {current === opt.key && <span className="text-[#6d5efc]">✓</span>}
                                {current !== opt.key && <span className="w-3" />}
                                {opt.label}
                              </button>
                            )
                          })}
                        </div>
                      )}
                    </div>
                  )}

                  <div className="border-t border-[#3a3a3a] my-1" />

                  {/* Delete track */}
                  <button
                    onClick={handleRemove}
                    className="w-full flex items-center px-3 py-1.5 text-xs text-red-400 hover:bg-[#3a3a3a]"
                  >
                    刪除軌道
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      </div>
      {(track.type === 'audio' || track.type === 'video') && <TrackMeter trackId={track.id} />}
      </div>

      {/* Clip area */}
      <div
        className={`relative flex-1 overflow-hidden ${track.muted ? 'bg-[#2c2510]' : isSelectedTrack ? 'bg-[#241f38]' : track.locked ? 'bg-[#1e1e1e]' : 'bg-[#252525]'}`}
        style={{ minWidth: totalWidth, opacity: track.hidden ? 0.3 : 1 }}
        onClick={clearSelection}
        onMouseMove={(e) => {
          const rect = e.currentTarget.getBoundingClientRect()
          const t = pxToTime(e.clientX - rect.left, zoom)
          setLastCursor({ trackId: track.id, time: Math.max(0, t) })
        }}
        onContextMenu={track.type === 'audio' && !track.locked ? (e) => {
          // Empty-space right-click only — Clip stops propagation, so this never
          // fires when the cursor is over a clip.
          e.preventDefault()
          const rect = e.currentTarget.getBoundingClientRect()
          const t = Math.max(0, pxToTime(e.clientX - rect.left, zoom))
          setPointMenu({ x: e.clientX, y: e.clientY, time: t })
        } : undefined}
        onDrop={track.locked ? undefined : onDrop}
        onDragOver={track.locked ? undefined : onDragOver}
      >
        {clips.map((clip, i) => (
          <Clip
            key={i}
            trackId={track.id}
            trackType={track.type}
            trackRole={track.role}
            index={i}
            clip={clip}
            containerRef={contentRef}
            clipHeight={clipH}
          />
        ))}
      </div>

      {pointMenu && (
        <PointContextMenu
          x={pointMenu.x}
          y={pointMenu.y}
          onClose={() => setPointMenu(null)}
          items={[
            {
              label: '建立音效',
              accent: true,
              action: () => { setCreateSfx({ trackId: track.id, time: pointMenu.time }); setPointMenu(null) },
            },
          ]}
        />
      )}

      {createSfx && (
        <CreateSfxModal
          trackId={createSfx.trackId}
          time={createSfx.time}
          onClose={() => setCreateSfx(null)}
        />
      )}
    </div>
  )
})

function TrackIconBtn({ active, icon, title, onClick }) {
  return (
    <button
      onClick={(e) => { e.stopPropagation(); onClick() }}
      className={`w-4 h-4 flex items-center justify-center rounded transition-colors ${
        active ? 'text-[#6d5efc]' : 'text-[#555] hover:text-[#aaa]'
      }`}
      title={title}
    >
      {icon}
    </button>
  )
}
