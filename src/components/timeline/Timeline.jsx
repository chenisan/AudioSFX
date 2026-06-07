import { useRef, useState, useMemo, useCallback, useEffect } from 'react'
import { useProjectStore } from '../../stores/projectStore'
import { useShallow } from 'zustand/react/shallow'
import { timeToPx } from '../../utils/timeFormat'
import { useTimelineAssetDrop } from '../../hooks/useDragDrop'
import TimeRuler from './TimeRuler'
import Track, { getTrackHeight } from './Track'
import Playhead from './Playhead'
import ExportRangeBar, { ExportRangeMask } from './ExportRangeBar'

const LABEL_WIDTH = 140
const RULER_HEIGHT = 32

// Min drag distance (px) before rubber-band selection activates
const RB_THRESHOLD = 4

export default function Timeline() {
  // Narrow project subscription so a clip move on track A doesn't bust the
  // memo on every other component subscribed to `project`. The previous
  // code did `s => s.project` here and in 18 other components — every
  // mutation re-rendered all of them. With per-field selectors, Timeline
  // re-renders only when one of these specific values changes.
  const projectId = useProjectStore(s => s.project?.id)
  const projectDuration = useProjectStore(s => s.project?.duration ?? 60)
  const exportRangeSet = useProjectStore(s => !!s.project?.exportRange)
  // Tracks subscription uses shallow equality so a clip mutation that swaps
  // ONE track's reference doesn't claim equality changed for the others.
  // Returns the same array identity when no track was added/removed/swapped,
  // and a new array when any track ref changed (which is what the memos
  // below need).
  const tracks = useProjectStore(useShallow(s => s.project?.timeline.tracks ?? []))
  const zoom = useProjectStore(s => s.zoom)
  const selectedClip = useProjectStore(s => s.selectedClip)
  const autoSnap = useProjectStore(s => s.autoSnap)
  const _undoStack = useProjectStore(s => s._undoStack)
  const _redoStack = useProjectStore(s => s._redoStack)
  const setZoom = useProjectStore(s => s.setZoom)
  const addTrack = useProjectStore(s => s.addTrack)
  const addColorFillClip = useProjectStore(s => s.addColorFillClip)
  const removeClip = useProjectStore(s => s.removeClip)
  const splitClipAtPlayhead = useProjectStore(s => s.splitClipAtPlayhead)
  const duplicateClip = useProjectStore(s => s.duplicateClip)
  const deleteLeftAtPlayhead = useProjectStore(s => s.deleteLeftAtPlayhead)
  const deleteRightAtPlayhead = useProjectStore(s => s.deleteRightAtPlayhead)
  const toggleAutoSnap = useProjectStore(s => s.toggleAutoSnap)
  const setExportRange = useProjectStore(s => s.setExportRange)
  const loopExportRange = useProjectStore(s => s.loopExportRange)
  const toggleLoopExportRange = useProjectStore(s => s.toggleLoopExportRange)
  const isPlaying = useProjectStore(s => s.isPlaying)
  const togglePlay = useProjectStore(s => s.togglePlay)
  const undo = useProjectStore(s => s.undo)
  const redo = useProjectStore(s => s.redo)
  const swapTrackOrder = useProjectStore(s => s.swapTrackOrder)
  const updateClip = useProjectStore(s => s.updateClip)
  const toggleAllMuted = useProjectStore(s => s.toggleAllMuted)
  const contentRef = useRef(null)
  const tracksRef = useRef(null)
  const [viewportWidth, setViewportWidth] = useState(0)
  const [showAddMenu, setShowAddMenu] = useState(false)
  const [dragTrackId, setDragTrackId] = useState(null)
  const [dropTargetId, setDropTargetId] = useState(null)
  const [rubberBand, setRubberBand] = useState(null)
  const clearSelection = useProjectStore(s => s.clearSelection)
  const setSelectedClipsBatch = useProjectStore(s => s.setSelectedClipsBatch)

  // Track scrollable viewport width so we can clamp zoom to "fit full duration".
  // Deps include projectId because the ref element only mounts after project loads.
  useEffect(() => {
    const el = contentRef.current
    if (!el) return
    const update = () => setViewportWidth(el.clientWidth)
    update()
    const ro = new ResizeObserver(update)
    ro.observe(el)
    return () => ro.disconnect()
  }, [projectId])

  // Sort tracks: higher order on top (descending), audio at bottom (negative order)
  const sortedTracks = useMemo(() =>
    tracks.length ? [...tracks].sort((a, b) => b.order - a.order) : [],
    [tracks]
  )

  // Timeline width = max of project.duration and actual content end + 10s padding
  const { contentEnd, effectiveDuration, totalWidth, tracksHeight, totalHeight } = useMemo(() => {
    if (!projectId) return { contentEnd: 0, effectiveDuration: 60, totalWidth: 0, tracksHeight: 0, totalHeight: RULER_HEIGHT }
    const contentEnd = sortedTracks.reduce((max, t) => {
      for (const c of (t.clips ?? [])) { if (c.end > max) max = c.end }
      return max
    }, 0)
    const effectiveDuration = Math.max(projectDuration, contentEnd + 10)
    const totalWidth = timeToPx(effectiveDuration, zoom)
    const tracksHeight = sortedTracks.reduce((sum, t) => sum + getTrackHeight(t).trackH, 0)
    const totalHeight = RULER_HEIGHT + tracksHeight
    return { contentEnd, effectiveDuration, totalWidth, tracksHeight, totalHeight }
  }, [sortedTracks, projectDuration, zoom, projectId])

  // Minimum zoom = just enough px/s so the full timeline fits the viewport
  const ZOOM_MAX = 200
  const minZoom = useMemo(() => {
    const avail = viewportWidth - LABEL_WIDTH
    if (avail <= 0 || effectiveDuration <= 0) return 2
    return Math.max(2, Math.min(ZOOM_MAX, avail / effectiveDuration))
  }, [viewportWidth, effectiveDuration])

  const clampZoom = useCallback((v) => Math.max(minZoom, Math.min(ZOOM_MAX, v)), [minZoom])
  const setZoomClamped = useCallback((v) => setZoom(clampZoom(v)), [clampZoom, setZoom])

  // If duration grows (e.g. adding a long clip) push zoom up to keep it fitted
  useEffect(() => {
    if (zoom < minZoom) setZoom(minZoom)
  }, [minZoom, zoom, setZoom])

  const { onDrop: onTimelineAssetDrop, onDragOver: onTimelineAssetDragOver } =
    useTimelineAssetDrop({ containerRef: contentRef })

  const handleTrackDragStart = (trackId) => setDragTrackId(trackId)
  const handleTrackDragOver = (trackId) => { if (dragTrackId && trackId !== dragTrackId) setDropTargetId(trackId) }
  const handleTrackDrop = (targetId) => {
    if (dragTrackId && targetId && dragTrackId !== targetId) swapTrackOrder(dragTrackId, targetId)
    setDragTrackId(null); setDropTargetId(null)
  }
  const handleTrackDragEnd = () => { setDragTrackId(null); setDropTargetId(null) }

  // ── Rubber-band selection ─────────────────────────────────────────────────
  const getCanvasCoords = useCallback((clientX, clientY) => {
    const content = contentRef.current
    const tracks = tracksRef.current
    if (!content || !tracks) return { x: 0, y: 0 }
    const contentRect = content.getBoundingClientRect()
    const tracksRect = tracks.getBoundingClientRect()
    return {
      x: clientX - contentRect.left + content.scrollLeft,
      y: clientY - tracksRect.top,
    }
  }, [])

  // Pan (scroll) state — middle-click drag OR alt + left-click drag in empty
  // timeline area pans the visible window, like Premiere's hand tool. Stored
  // in a ref because we don't need React to re-render during the pan; we
  // imperatively mutate scrollLeft / scrollTop on the content element each
  // frame.
  const panStateRef = useRef(null)

  const handleTracksMouseDown = useCallback((e) => {
    if (e.target.closest('[data-clip-el]')) return
    // Don't capture mousedowns on the per-track drag handle — calling
    // preventDefault here would block the native HTML5 dragstart.
    if (e.target.closest('[data-track-drag-handle]')) return
    // Don't hijack interactive controls in the track labels (volume slider,
    // mute/lock buttons, rename input, menus). The preventDefault below would
    // otherwise block the native <input type="range"> drag — that's why the
    // track-volume slider couldn't be moved.
    if (e.target.closest('input, button, select, textarea')) return

    // Pan path: middle-click OR alt+left-click. Eats the event before
    // rubber-band logic so neither selection nor the browser's middle-click
    // auto-scroll fires.
    const isPan = e.button === 1 || (e.button === 0 && e.altKey)
    if (isPan) {
      e.preventDefault()
      const el = contentRef.current
      if (!el) return
      panStateRef.current = {
        startX: e.clientX,
        startY: e.clientY,
        startScrollLeft: el.scrollLeft,
        startScrollTop:  el.scrollTop,
      }
      // Visual hint
      document.body.style.cursor = 'grabbing'
      const onPanMove = (ev) => {
        const ps = panStateRef.current
        if (!ps || !contentRef.current) return
        contentRef.current.scrollLeft = ps.startScrollLeft - (ev.clientX - ps.startX)
        contentRef.current.scrollTop  = ps.startScrollTop  - (ev.clientY - ps.startY)
      }
      const onPanUp = () => {
        panStateRef.current = null
        document.body.style.cursor = ''
        window.removeEventListener('mousemove', onPanMove)
        window.removeEventListener('mouseup', onPanUp)
      }
      window.addEventListener('mousemove', onPanMove)
      window.addEventListener('mouseup', onPanUp)
      return
    }

    // Rubber-band path: plain left-click on empty area.
    if (e.button !== 0) return
    e.preventDefault()
    const { x, y } = getCanvasCoords(e.clientX, e.clientY)
    clearSelection()
    // Snapshot zoom + tracks at drag-start so intersection stays consistent.
    // Snapshot the SORTED order — the intersection loop walks tracks top-down
    // by accumulating trackY, which depends on render order.
    setRubberBand({ startX: x, startY: y, curX: x, curY: y, snapZoom: zoom, snapTracks: sortedTracks })
  }, [getCanvasCoords, clearSelection, zoom, sortedTracks])

  // Block the browser's native context menu when right-clicking inside the
  // tracks area — keeps middle-click/alt+drag pan ergonomic without surfacing
  // the OS menu over the timeline. Right-click is also unused for clip ops
  // here (those use a separate context-menu overlay).
  // (The native middle-click auto-scroll is already prevented above via
  // the preventDefault on mousedown.)

  useEffect(() => {
    if (!rubberBand) return
    const onMove = (e) => {
      const { x, y } = getCanvasCoords(e.clientX, e.clientY)
      setRubberBand(rb => rb ? { ...rb, curX: x, curY: y } : null)
    }
    const onUp = () => {
      setRubberBand(prev => {
        if (!prev) return null
        const selL = Math.min(prev.startX, prev.curX)
        const selR = Math.max(prev.startX, prev.curX)
        const selT = Math.min(prev.startY, prev.curY)
        const selB = Math.max(prev.startY, prev.curY)
        if (selR - selL > RB_THRESHOLD || selB - selT > RB_THRESHOLD) {
          const selected = []
          let trackY = 0
          for (const track of prev.snapTracks) {
            const { trackH, clipH } = getTrackHeight(track)
            const clipTop = trackY + (trackH - clipH) / 2
            const clipBottom = clipTop + clipH
            if (clipTop < selB && clipBottom > selT) {
              for (let i = 0; i < (track.clips ?? []).length; i++) {
                const clip = track.clips[i]
                const cL = LABEL_WIDTH + timeToPx(clip.start, prev.snapZoom)
                const cR = LABEL_WIDTH + timeToPx(clip.end, prev.snapZoom)
                if (cL < selR && cR > selL) selected.push({ trackId: track.id, index: i })
              }
            }
            trackY += trackH
          }
          // Defer to next microtask: calling another store-set inside the
          // setRubberBand updater triggers React's "cannot update a component
          // while rendering a different component" warning, since selectedClips
          // is consumed by TimelinePreview.
          queueMicrotask(() => setSelectedClipsBatch(selected))
        }
        return null
      })
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
    return () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
  }, [!!rubberBand, getCanvasCoords, setSelectedClipsBatch])

  if (!projectId) {
    return (
      <div className="flex items-center justify-center h-full text-[#555] text-sm">
        選擇或建立一個專案
      </div>
    )
  }

  const handleWheel = (e) => {
    // Modifier zoom: Alt (Premiere convention) or Ctrl/Cmd (image-app
    // convention, kept for muscle memory). Both anchor the zoom around the
    // cursor — the time point under the cursor stays put after zoom, so the
    // user can drill into a specific moment without re-scrolling.
    if (e.altKey || e.ctrlKey || e.metaKey) {
      e.preventDefault()
      const el = contentRef.current
      if (!el) return
      const rect = el.getBoundingClientRect()
      // Time value (in seconds) currently under the cursor:
      //   mouseX in viewport → mouseX in content (add scrollLeft) → subtract
      //   LABEL_WIDTH for the gutter → divide by current zoom.
      const cursorViewportX = e.clientX - rect.left
      const timeUnderCursor = Math.max(0, (cursorViewportX + el.scrollLeft - LABEL_WIDTH) / zoom)
      const delta = e.deltaY > 0 ? -5 : 5
      const newZoom = clampZoom(zoom + delta)
      if (newZoom === zoom) return
      setZoom(newZoom)
      // After zoom flushes, restore the cursor-anchor by recomputing the
      // scrollLeft that keeps timeUnderCursor under cursorViewportX:
      //   newScrollLeft = timeUnderCursor * newZoom + LABEL_WIDTH - cursorViewportX
      requestAnimationFrame(() => {
        const elNow = contentRef.current
        if (!elNow) return
        const targetScrollLeft = timeUnderCursor * newZoom + LABEL_WIDTH - cursorViewportX
        elNow.scrollLeft = Math.max(0, targetScrollLeft)
      })
      return
    }
    // Plain wheel: trackpad horizontal swipes already produce deltaX which
    // the browser scrolls naturally. For desktop mouse users (only deltaY),
    // also map the vertical wheel onto horizontal scroll so the timeline
    // pans without needing the scrollbar.
    if (Math.abs(e.deltaY) > Math.abs(e.deltaX)) {
      const el = contentRef.current
      if (!el) return
      el.scrollLeft += e.deltaY
      e.preventDefault()
    }
  }

  const handleAddTrack = (type) => {
    addTrack(type)
    setShowAddMenu(false)
  }

  // "全部靜音" reflects the sound-bearing tracks (audio + video). Active (amber)
  // when every one is muted, so the button doubles as a "mute all / clear all".
  const soundTracks = tracks.filter(t => t.type === 'audio' || t.type === 'video')
  const allMuted = soundTracks.length > 0 && soundTracks.every(t => t.muted)

  return (
    <div className="flex flex-col h-full bg-[#1a1a1a] select-none">
      {/* Toolbar */}
      <div className="flex items-center gap-1 px-2 py-1 border-b border-[#2a2a2a]">
        {/* Add Track */}
        <div className="relative">
          <button
            onClick={() => setShowAddMenu(!showAddMenu)}
            className="flex items-center gap-1 px-2 py-1 text-xs text-[#888] hover:text-white bg-[#2a2a2a] hover:bg-[#333] rounded"
            title="新增軌道"
          ><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg></button>
          {showAddMenu && (
            <div className="absolute left-0 top-full mt-1 bg-[#2a2a2a] border border-[#444] rounded shadow-lg z-50 min-w-[100px]">
              <button onClick={() => handleAddTrack('video')} className="block w-full text-left px-3 py-1.5 text-xs text-[#ccc] hover:bg-[#3a3a3a]">🎬 影片軌</button>
              <button onClick={() => handleAddTrack('audio')} className="block w-full text-left px-3 py-1.5 text-xs text-[#ccc] hover:bg-[#3a3a3a]">🔊 音軌</button>
            </div>
          )}
        </div>

        <div className="w-px h-4 bg-[#333] mx-1" />

        {/* Undo / Redo */}
        <TbBtn onClick={undo} disabled={_undoStack.length === 0} title="復原 (Ctrl+Z)">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 14L4 9l5-5"/><path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11"/></svg>
        </TbBtn>
        <TbBtn onClick={redo} disabled={_redoStack.length === 0} title="重做 (Ctrl+Shift+Z)">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M15 14l5-5-5-5"/><path d="M20 9H9.5a5.5 5.5 0 0 0 0 11H13"/></svg>
        </TbBtn>

        <div className="w-px h-4 bg-[#333] mx-1" />

        {/* Delete */}
        <TbBtn onClick={() => selectedClip && removeClip(selectedClip.trackId, selectedClip.index)} disabled={!selectedClip} title="刪除 (Delete)">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4h6v2"/></svg>
        </TbBtn>

        {/* Duplicate */}
        <TbBtn onClick={duplicateClip} disabled={!selectedClip} title="複製 (D)">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
        </TbBtn>

        <div className="w-px h-4 bg-[#333] mx-1" />

        {/* Split — CapCut style ⌶ icon */}
        <TbBtn onClick={splitClipAtPlayhead} disabled={!selectedClip} title="分割 (S)">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="7" width="8" height="10" rx="1"/><rect x="14" y="7" width="8" height="10" rx="1"/><line x1="12" y1="4" x2="12" y2="20" strokeDasharray="2 2"/></svg>
        </TbBtn>

        {/* Delete left part */}
        <TbBtn onClick={deleteLeftAtPlayhead} disabled={!selectedClip} title="刪除左邊部分 (Q)">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="8" y="6" width="13" height="12" rx="1"/><line x1="8" y1="4" x2="8" y2="20"/><polyline points="4 9 8 12 4 15"/></svg>
        </TbBtn>

        {/* Delete right part */}
        <TbBtn onClick={deleteRightAtPlayhead} disabled={!selectedClip} title="刪除右邊部分 (W)">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="6" width="13" height="12" rx="1"/><line x1="16" y1="4" x2="16" y2="20"/><polyline points="20 9 16 12 20 15"/></svg>
        </TbBtn>

        <div className="w-px h-4 bg-[#333] mx-1" />

        {/* Auto-snap toggle */}
        <button
          onClick={toggleAutoSnap}
          className={`w-7 h-7 flex items-center justify-center rounded transition-colors ${autoSnap ? 'bg-[#6d5efc]/20 text-[#6d5efc]' : 'bg-[#2a2a2a] text-[#888] hover:text-white hover:bg-[#333]'}`}
          title={autoSnap ? '關閉自動貼齊 (N)' : '開啟自動貼齊 (N)'}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="2" y="8" width="7" height="8" rx="1"/><rect x="15" y="8" width="7" height="8" rx="1"/><path d="M9 12h6" strokeDasharray={autoSnap ? undefined : '2 2'}/><circle cx="12" cy="12" r="1.5" fill="currentColor" stroke="none"/></svg>
        </button>

        <div className="w-px h-4 bg-[#333] mx-1" />

        {/* Reset export range */}
        <TbBtn
          onClick={() => setExportRange(null)}
          disabled={!exportRangeSet}
          title="重設輸出範圍為完整"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M3 3v6h6"/><path d="M3 9a9 9 0 1 0 3-7"/>
          </svg>
        </TbBtn>

        {/* Loop within export range */}
        <button
          onClick={toggleLoopExportRange}
          disabled={!exportRangeSet}
          className={`w-7 h-7 flex items-center justify-center rounded transition-colors ${
            !exportRangeSet ? 'bg-[#1a1a1a] text-[#444] cursor-not-allowed'
            : loopExportRange ? 'bg-[#6d5efc]/20 text-[#6d5efc]'
            : 'bg-[#2a2a2a] text-[#888] hover:text-white hover:bg-[#333]'
          }`}
          title={!exportRangeSet ? '先在時間軸拖曳輸出範圍才能循環' : loopExportRange ? '關閉範圍循環' : '在輸出範圍內循環播放'}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="17 1 21 5 17 9"/><path d="M3 11V9a4 4 0 0 1 4-4h14"/><polyline points="7 23 3 19 7 15"/><path d="M21 13v2a4 4 0 0 1-4 4H3"/>
          </svg>
        </button>

        {/* Play / Pause */}
        <button
          onClick={togglePlay}
          disabled={!projectId}
          className={`w-7 h-7 flex items-center justify-center rounded transition-colors ${
            !projectId ? 'bg-[#1a1a1a] text-[#444] cursor-not-allowed'
            : isPlaying ? 'bg-[#6d5efc] text-white hover:bg-[#d63a55]'
            : 'bg-[#2a2a2a] text-[#888] hover:text-white hover:bg-[#333]'
          }`}
          title={isPlaying ? '暫停 (Space)' : '播放 (Space)'}
        >
          {isPlaying ? (
            <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/></svg>
          ) : (
            <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><polygon points="5 3 19 12 5 21 5 3"/></svg>
          )}
        </button>

        <div className="flex-1" />

        {/* Zoom slider */}
        <button
          onClick={() => setZoomClamped(zoom - 10)}
          className="w-5 h-5 flex items-center justify-center text-[#666] hover:text-white text-sm"
          title="縮小"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/><line x1="8" y1="11" x2="14" y2="11"/></svg>
        </button>
        <input
          type="range"
          min={minZoom}
          max={ZOOM_MAX}
          step={0.1}
          value={Math.max(zoom, minZoom)}
          onChange={e => setZoomClamped(+e.target.value)}
          className="w-24 h-1 accent-[#888] cursor-pointer"
          title={`${zoom.toFixed(1)}px/s（最小 ${minZoom.toFixed(1)} = 顯示完整長度）`}
        />
        <button
          onClick={() => setZoomClamped(zoom + 10)}
          className="w-5 h-5 flex items-center justify-center text-[#666] hover:text-white text-sm"
          title="放大"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/><line x1="8" y1="11" x2="14" y2="11"/><line x1="11" y1="8" x2="11" y2="14"/></svg>
        </button>
      </div>

      {/* Main scrollable area */}
      <div
        ref={contentRef}
        className="flex-1 overflow-auto"
        data-timeline-content
        onWheel={handleWheel}
        onClick={() => showAddMenu && setShowAddMenu(false)}
        onDragOver={onTimelineAssetDragOver}
        onDrop={onTimelineAssetDrop}
      >
        <div style={{ minWidth: totalWidth + LABEL_WIDTH, position: 'relative' }}>
          {/* Ruler row — sticky so it stays pinned while many tracks scroll vertically */}
          <div className="flex border-b border-[#2a2a2a] sticky top-0 z-40 bg-[#1a1a1a]" style={{ height: RULER_HEIGHT }}>
            <div style={{ width: LABEL_WIDTH, flexShrink: 0 }} className="bg-[#1a1a1a] border-r border-[#2a2a2a] flex items-center px-1.5">
              <button
                onClick={toggleAllMuted}
                disabled={soundTracks.length === 0}
                className={`flex items-center gap-1 px-1.5 h-5 rounded text-[9px] font-medium transition-colors ${
                  soundTracks.length === 0
                    ? 'bg-[#1a1a1a] text-[#444] cursor-not-allowed'
                    : allMuted
                      ? 'bg-[#e0b341] text-black shadow-[0_0_6px_rgba(224,179,65,0.4)]'
                      : 'bg-[#262629] text-[#888] hover:text-white border border-[#333]'
                }`}
                title={allMuted ? '解除全部靜音' : '全部靜音（所有音 / 視軌）'}
              >
                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><line x1="23" y1="9" x2="17" y2="15"/><line x1="17" y1="9" x2="23" y2="15"/>
                </svg>
                {allMuted ? '全部解除' : '全部靜音'}
              </button>
            </div>
            <div className="relative flex-1 bg-[#111] overflow-hidden">
              <TimeRuler />
              {/* Export range handles (In/Out markers) */}
              <ExportRangeBar contentEnd={contentEnd} rulerHeight={RULER_HEIGHT} />
              {/* Playhead handle — inside ruler so it's not covered */}
              <Playhead mode="handle" rulerHeight={RULER_HEIGHT} />
            </div>
          </div>

          {/* Tracks */}
          <div
            ref={tracksRef}
            className="relative"
            data-tracks
            style={{ cursor: rubberBand ? 'crosshair' : undefined }}
            onMouseDown={handleTracksMouseDown}
          >
            {/* Playhead line — spans all tracks */}
            <div
              className="absolute top-0 left-0 right-0 pointer-events-none z-20"
              style={{ height: tracksHeight }}
            >
              <div style={{ marginLeft: LABEL_WIDTH, position: 'relative', height: '100%' }}>
                <Playhead mode="line" totalHeight={tracksHeight} />
              </div>
            </div>

            {/* Export range mask — dims time outside [in, out] when range is set */}
            <div
              className="absolute top-0 right-0 pointer-events-none"
              style={{ left: LABEL_WIDTH, height: tracksHeight }}
            >
              <ExportRangeMask contentEnd={contentEnd} tracksHeight={tracksHeight} />
            </div>

            {sortedTracks.map(track => (
              <Track
                key={track.id}
                trackId={track.id}
                contentRef={contentRef}
                isDragging={dragTrackId === track.id}
                isDragOver={dropTargetId === track.id}
                onTrackDragStart={handleTrackDragStart}
                onTrackDragOver={handleTrackDragOver}
                onTrackDrop={handleTrackDrop}
                onTrackDragEnd={handleTrackDragEnd}
              />
            ))}

            {/* Rubber-band selection overlay */}
            {rubberBand && (() => {
              const l = Math.min(rubberBand.startX, rubberBand.curX)
              const t = Math.min(rubberBand.startY, rubberBand.curY)
              const w = Math.abs(rubberBand.curX - rubberBand.startX)
              const h = Math.abs(rubberBand.curY - rubberBand.startY)
              return (
                <div
                  className="absolute pointer-events-none z-30"
                  style={{
                    left: l,
                    top: t,
                    width: w,
                    height: h,
                    border: '1px solid #6d5efc',
                    backgroundColor: 'rgba(233,69,96,0.08)',
                  }}
                />
              )
            })()}
          </div>
        </div>
      </div>

    </div>
  )
}

function TbBtn({ onClick, disabled, title, children }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={title}
      className="w-7 h-7 flex items-center justify-center text-[#888] hover:text-white disabled:text-[#444] disabled:hover:text-[#444] bg-[#2a2a2a] hover:bg-[#333] disabled:hover:bg-[#2a2a2a] rounded transition-colors"
    >
      {children}
    </button>
  )
}
