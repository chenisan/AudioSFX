import { useRef, useCallback } from 'react'
import { useProjectStore } from '../stores/projectStore'
import { collectSnapPoints, snapToPoints } from '../utils/snapLogic'
import { pxToTime, timeToPx } from '../utils/timeFormat'

const LABEL_WIDTH = 140
const DEFAULT_TRACK_HEIGHT = 48

const HEIGHT_SIZES = {
  small: 36, default: 48, large: 72,
}

function getTrackH(track) {
  return HEIGHT_SIZES[track?.heightSize] ?? DEFAULT_TRACK_HEIGHT
}

function getSortedTracks(project) {
  if (!project?.timeline?.tracks) return []
  return [...project.timeline.tracks].sort((a, b) => b.order - a.order)
}

function getTrackAtY(clientY, tracksRect, sortedTracks) {
  const y = clientY - tracksRect.top
  let acc = 0
  for (const t of sortedTracks) {
    acc += getTrackH(t)
    if (y < acc) return t.id
  }
  return sortedTracks[sortedTracks.length - 1]?.id
}

function getTrackY(trackId, tracksRect, sortedTracks) {
  let acc = 0
  for (const t of sortedTracks) {
    if (t.id === trackId) return tracksRect.top + acc
    acc += getTrackH(t)
  }
  return tracksRect.top
}

function createGhost(sourceEl, width, trackHeight) {
  const ghost = sourceEl.cloneNode(true)
  ghost.style.position = 'fixed'
  ghost.style.zIndex = '9999'
  ghost.style.pointerEvents = 'none'
  ghost.style.opacity = '0.7'
  ghost.style.width = width + 'px'
  ghost.style.height = (trackHeight ?? DEFAULT_TRACK_HEIGHT) + 'px'
  ghost.style.boxShadow = '0 4px 16px rgba(0,0,0,0.5)'
  ghost.style.borderRadius = '4px'
  ghost.style.transition = 'none'
  ghost.style.willChange = 'transform'
  ghost.dataset.dragGhost = 'true'
  document.body.appendChild(ghost)
  return ghost
}

function removeGhost(ghost) {
  if (ghost && ghost.parentNode) ghost.parentNode.removeChild(ghost)
}

/**
 * Returns drag handlers for a clip.
 * type: 'move' | 'resize-start' | 'resize-end'
 */
export function useClipDrag({ trackId, index, containerRef }) {
  const dragState = useRef(null)

  const onMouseDown = useCallback((e, type) => {
    e.preventDefault()
    e.stopPropagation()

    const state = useProjectStore.getState()
    const { project, zoom } = state
    if (!project) return

    // Snapshot undo state before drag begins (high-frequency updates won't push)
    state.pushUndo()

    const sortedTracks = getSortedTracks(project)

    const track = sortedTracks.find(t => t.id === trackId)
    if (!track) return
    const clip = track.clips[index]
    if (!clip) return

    const containerRect = containerRef.current?.getBoundingClientRect()
    if (!containerRect) return

    const tracksEl = containerRef.current?.querySelector('[data-tracks]')
    const tracksRect = tracksEl?.getBoundingClientRect() ?? null

    const snapPoints = collectSnapPoints(project.timeline, project.duration, trackId, index)

    const clipLeft = timeToPx(clip.start, zoom)
    const clipWidth = Math.max(8, timeToPx(clip.end - clip.start, zoom))
    const clipScreenLeft = containerRect.left + LABEL_WIDTH + clipLeft - (containerRef.current?.scrollLeft ?? 0)
    const offsetX = e.clientX - clipScreenLeft
    const offsetY = e.clientY - (tracksRect ? getTrackY(trackId, tracksRect, sortedTracks) : e.clientY) - 2

    // Snapshot all selected clips for group drag
    const { selectedClips } = state
    const isLeadInGroup = selectedClips.length > 1 && selectedClips.some(c => c.trackId === trackId && c.index === index)
    const multiDragOriginals = isLeadInGroup
      ? selectedClips.map(({ trackId: tid, index: idx }) => {
          const t = sortedTracks.find(tr => tr.id === tid)
          const c = t?.clips[idx]
          return c ? { trackId: tid, index: idx, originalStart: c.start } : null
        }).filter(Boolean)
      : null

    dragState.current = {
      type,
      startMouseX: e.clientX,
      startMouseY: e.clientY,
      originalStart: clip.start,
      originalEnd: clip.end,
      snapPoints,
      zoom,
      tracksRect,
      sortedTracks,
      sourceTrackType: track.type,
      targetTrackId: trackId,
      ghost: null,
      sourceEl: e.currentTarget,
      clipWidth,
      offsetX,
      offsetY,
      hasMoved: false,
      multiDragOriginals,
    }

    const onMouseMove = (e) => {
      if (!dragState.current) return
      const ds = dragState.current
      const { type, startMouseX, originalStart, originalEnd, snapPoints, zoom, tracksRect } = ds
      const deltaPx = e.clientX - startMouseX
      const deltaSec = pxToTime(deltaPx, zoom)

      if (type === 'move') {
        if (!ds.hasMoved && (Math.abs(e.clientX - startMouseX) > 3 || Math.abs(e.clientY - ds.startMouseY) > 3)) {
          ds.hasMoved = true
          ds.ghost = createGhost(ds.sourceEl, ds.clipWidth)
          ds.sourceEl.style.opacity = '0.3'
        }

        if (ds.ghost) {
          ds.ghost.style.left = (e.clientX - ds.offsetX) + 'px'
          ds.ghost.style.top = (e.clientY - ds.offsetY) + 'px'
        }

        const rawStart = originalStart + deltaSec
        const { time: snappedStart } = snapToPoints(rawStart, snapPoints, zoom)

        if (tracksRect) {
          ds.targetTrackId = getTrackAtY(e.clientY, tracksRect, ds.sortedTracks)
        }

        if (ds.multiDragOriginals) {
          const snappedDelta = snappedStart - originalStart
          useProjectStore.getState().moveClipsBatch(
            ds.multiDragOriginals.map(({ trackId: tid, index: idx, originalStart: os }) => ({
              trackId: tid, index: idx, newStart: os + snappedDelta,
            }))
          )
        } else {
          useProjectStore.getState().moveClip(trackId, index, snappedStart)
        }
      } else if (type === 'resize-start') {
        const rawStart = originalStart + deltaSec
        const { time: snappedStart } = snapToPoints(rawStart, snapPoints, zoom)
        useProjectStore.getState().resizeClipStart(trackId, index, snappedStart)
      } else if (type === 'resize-end') {
        const rawEnd = originalEnd + deltaSec
        const { time: snappedEnd } = snapToPoints(rawEnd, snapPoints, zoom)
        useProjectStore.getState().resizeClipEnd(trackId, index, snappedEnd)
      }
    }

    const onMouseUp = () => {
      const ds = dragState.current
      if (ds) {
        removeGhost(ds.ghost)
        if (ds.sourceEl) ds.sourceEl.style.opacity = ''

        if (ds.type === 'move' && ds.hasMoved) {
          const targetTrack = ds.targetTrackId
          if (targetTrack && targetTrack !== trackId) {
            // Cross-track move: REST endpoint owns the atomic remove+add
            const { project } = useProjectStore.getState()
            const track = project.timeline.tracks.find(t => t.id === trackId)
            const clip = track?.clips[index]
            if (clip) {
              useProjectStore.getState().moveClipToTrack(trackId, index, targetTrack, clip.start)
            }
          } else {
            // Same-track move: mousemove kept the new positions in local state.
            // Persist them now so split / delete / refresh see the moved clips.
            const refs = ds.multiDragOriginals
              ? ds.multiDragOriginals.map(({ trackId: tid, index: idx }) => ({ trackId: tid, index: idx }))
              : [{ trackId, index }]
            useProjectStore.getState().commitDragChanges(refs)
          }
        } else if (ds.type === 'resize-start' || ds.type === 'resize-end') {
          // Resize: same as same-track move — commit the final start/end.
          useProjectStore.getState().commitDragChanges([{ trackId, index }])
        }
      }
      dragState.current = null
      window.removeEventListener('mousemove', onMouseMove)
      window.removeEventListener('mouseup', onMouseUp)
    }

    window.addEventListener('mousemove', onMouseMove)
    window.addEventListener('mouseup', onMouseUp)
  }, [trackId, index, containerRef])

  return { onMouseDown }
}

// Infer the timeline track type that should host an asset file.
// Extensions match AssetPanel.jsx.
function inferAssetTrackType(filename) {
  if (/\.(mp4|mov|avi|webm|mkv)$/i.test(filename)) return 'video'
  if (/\.(mp3|wav|aac|m4a|ogg)$/i.test(filename)) return 'audio'
  if (/\.(jpg|jpeg|png|apng|gif|webp)$/i.test(filename)) return 'video'
  return null
}

// Map a position preset name → overlay rect fraction. Stickers are typically
// small overlays in a screen corner; if the user wants something custom they
// can drag the rect afterwards.
function stickerPresetOverlay(position, size) {
  const w = Math.max(0.05, Math.min(0.9, size ?? 0.25))
  const h = w  // square-ish; .webm aspect is preserved via objectFit:'contain'
  const margin = 0.03
  switch (position) {
    case 'top-left':     return { x: margin,             y: margin,             width: w, height: h, opacity: 1 }
    case 'top-right':    return { x: 1 - w - margin,    y: margin,             width: w, height: h, opacity: 1 }
    case 'bottom-left':  return { x: margin,             y: 1 - h - margin,    width: w, height: h, opacity: 1 }
    case 'bottom-right': return { x: 1 - w - margin,    y: 1 - h - margin,    width: w, height: h, opacity: 1 }
    case 'center':
    default:             return { x: (1 - w) / 2,       y: (1 - h) / 2,       width: w, height: h, opacity: 1 }
  }
}

function buildAssetClip(asset, dropTime, targetType) {
  const duration = asset.duration ?? 5
  const newClip = {
    source: asset.filename,
    start: dropTime,
    end: dropTime + duration,
  }
  // Persist the source media's playable length so resize-end can cap there.
  // Image assets have no intrinsic duration → leave undefined (any timeline length OK).
  if (asset.type === 'video' || asset.type === 'audio') {
    if (typeof asset.duration === 'number') newClip.sourceDuration = asset.duration
  }
  if (targetType === 'text') {
    newClip.text = asset.filename.replace(/\.[^.]+$/, '')
    newClip.style = { fontSize: 40, color: '#FFFFFF', position: { x: 'center', y: '82%' } }
  }
  return newClip
}

/**
 * Returns drag handler for dragging assets from asset panel onto a track.
 */
export function useAssetDrop({ trackId, trackType, containerRef }) {
  const onDrop = useCallback((e) => {
    e.preventDefault()
    const data = e.dataTransfer.getData('application/json')
    if (!data) return
    // Consume the event so the timeline-level "drop into empty space" handler
    // doesn't also fire and create a duplicate track.
    e.stopPropagation()

    const asset = JSON.parse(data)
    const { project, zoom } = useProjectStore.getState()
    if (!project) return

    const containerRect = containerRef.current?.getBoundingClientRect()
    if (!containerRect) return

    const x = e.clientX - containerRect.left + (containerRef.current.scrollLeft ?? 0) - LABEL_WIDTH
    const duration = asset.duration ?? 5
    // Mouse is at center of the dragged element, so offset by half the clip duration
    const dropTime = Math.max(0, pxToTime(x, zoom) - duration / 2)

    // Sticker → only on video track. Materialise the file into project assets/
    // first (POST /api/stickers/import-to-project), then place as overlay clip
    // with the manifest-defined size + corner preset.
    if (asset.__sticker && trackType === 'video') {
      ;(async () => {
        try {
          const r = await fetch('/api/stickers/import-to-project', {
            method:  'POST',
            headers: { 'Content-Type': 'application/json' },
            body:    JSON.stringify({ projectId: project.id, stickerId: asset.stickerId }),
          })
          if (!r.ok) return
          const result = await r.json()
          const newClip = {
            source:  result.filename,
            start:   dropTime,
            end:     dropTime + (result.duration ?? asset.duration ?? 1.5),
            overlay: stickerPresetOverlay(result.defaultPosition, result.defaultSize),
          }
          useProjectStore.getState().addClip(trackId, newClip)
          useProjectStore.getState().bumpAssetVersion?.()
        } catch {}
      })()
      return
    }

    // AI Script asset → video track
    if (asset.aiScriptId && trackType === 'video') {
      const newClip = {
        source:      asset.previewFilename ?? '',
        aiScriptRef: asset.aiScriptId,
        start:       dropTime,
        end:         dropTime + (asset.duration ?? 5),
      }
      useProjectStore.getState().addClip(trackId, newClip)
      return
    }

    if (asset.assetId && trackType === 'script') {
      const newClip = {
        assetId:     asset.assetId,
        lyric:       asset.lyric ?? '',
        imagePrompt: asset.imagePrompt ?? '',
        pose:        asset.pose ?? 'standing',
        svgFilename: asset.svgFilename ?? '',
        start:       dropTime,
        end:         dropTime + (asset.duration ?? 5),
      }
      useProjectStore.getState().addClip(trackId, newClip)
      return
    }

    const newClip = buildAssetClip(asset, dropTime, trackType)
    useProjectStore.getState().addClip(trackId, newClip)
  }, [trackId, trackType, containerRef])

  const onDragOver = useCallback((e) => {
    e.preventDefault()
    e.dataTransfer.dropEffect = 'copy'
  }, [])

  return { onDrop, onDragOver }
}

/**
 * Timeline-level drop handler: fires when an asset is dropped into empty
 * space (not on a track's clip area). Creates a new track of the inferred
 * type and places the clip on it.
 */
export function useTimelineAssetDrop({ containerRef }) {
  const onDrop = useCallback(async (e) => {
    const data = e.dataTransfer.getData('application/json')
    if (!data) return
    e.preventDefault()

    let asset
    try { asset = JSON.parse(data) } catch { return }

    const store = useProjectStore.getState()
    const { project, zoom } = store
    if (!project) return

    const containerRect = containerRef.current?.getBoundingClientRect()
    if (!containerRect) return
    const x = e.clientX - containerRect.left + (containerRef.current.scrollLeft ?? 0) - LABEL_WIDTH
    const dropTime = Math.max(0, pxToTime(x, zoom))

    // ── AI Script asset drop → video track ────────────────────────────────
    if (asset.aiScriptId) {
      const newClip = {
        source:      asset.previewFilename ?? '',
        aiScriptRef: asset.aiScriptId,
        start:       dropTime,
        end:         dropTime + 5,
      }
      store.addTrackWithClip('video', newClip)
      return
    }

    // ── Sketch asset drop → script track ──────────────────────────────────
    if (asset.assetId) {
      const trackId = await store.ensureScriptTrack()
      if (!trackId) return
      const duration = 5
      const newClip = {
        assetId:     asset.assetId,
        lyric:       asset.lyric ?? '',
        imagePrompt: asset.imagePrompt ?? '',
        pose:        asset.pose ?? 'standing',
        svgFilename: asset.svgFilename ?? '',
        start:       dropTime,
        end:         dropTime + duration,
      }
      store.addClip(trackId, newClip)
      return
    }

    // ── Regular asset drop ─────────────────────────────────────────────────
    if (!asset?.filename) return
    const type = inferAssetTrackType(asset.filename)
    if (!type) return
    const duration = asset.duration ?? 5
    const startTime = Math.max(0, dropTime - duration / 2)
    const newClip = buildAssetClip(asset, startTime, type)
    store.addTrackWithClip(type, newClip)
  }, [containerRef])

  const onDragOver = useCallback((e) => {
    if (!e.dataTransfer.types.includes('application/json')) return
    e.preventDefault()
    e.dataTransfer.dropEffect = 'copy'
  }, [])

  return { onDrop, onDragOver }
}
