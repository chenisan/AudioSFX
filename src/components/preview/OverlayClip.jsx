import { useRef, useEffect } from 'react'
import { useProjectStore } from '../../stores/projectStore'

export const IMAGE_EXTS = /\.(jpe?g|png|apng|gif|webp)$/i
const MIN_OVERLAY_FRAC = 0.05  // Minimum 5% of canvas — below this drag is awkward.

/** Interpolate a Keyframe[] at a clip-relative time. Returns null when no
 *  keyframes are set, so callers can decide their fallback. Mirrors the
 *  ffmpeg side (`buildKFExpr` in transitionBuilder) — both share the same
 *  4-easing math. Used by opacity, xKF, yKF, and future KF channels. */
export function interpolateKF(kfs, clipRelTime) {
  if (!kfs || kfs.length === 0) return null
  const sorted = [...kfs].sort((a, b) => a.time - b.time)
  if (clipRelTime <= sorted[0].time) return sorted[0].value
  if (clipRelTime >= sorted[sorted.length - 1].time) return sorted[sorted.length - 1].value
  for (let i = 0; i < sorted.length - 1; i++) {
    if (clipRelTime >= sorted[i].time && clipRelTime < sorted[i + 1].time) {
      const t0 = sorted[i].time, t1 = sorted[i + 1].time
      const v0 = sorted[i].value, v1 = sorted[i + 1].value
      let n = (clipRelTime - t0) / (t1 - t0)
      switch (sorted[i].easing) {
        case 'ease-in':     n = n * n; break
        case 'ease-out':    n = 1 - (1 - n) * (1 - n); break
        case 'ease-in-out': n = n < 0.5 ? 2 * n * n : 1 - Math.pow(-2 * n + 2, 2) / 2; break
      }
      return v0 + (v1 - v0) * n
    }
  }
  return sorted[sorted.length - 1].value
}

/** Interpolate opacityKF at the current playhead. Returns null when no
 *  keyframes are set, so callers can decide their fallback (overlay.opacity
 *  or 1). Mirrors the ffmpeg side (`buildKFExpr` in transitionBuilder). */
export function interpolateOpacityKF(clip, playheadTime) {
  const kfs = clip?.opacityKF
  if (!kfs || kfs.length === 0) return null
  const clipT = Math.max(0, playheadTime - (clip?.start ?? 0))
  return interpolateKF(kfs, clipT)
}

/** Compute CSS style from a clip.crop object (scale + pan only).
 *  animScale overrides crop.scale when a Ken Burns animation is active.
 *  Note: only used by primary-track clips. Overlay clips don't honor
 *  clip.crop because the new drag-to-resize handles overlay.{x,y,width,height}. */
export function computeCropStyle(crop, animScale) {
  if (!crop && animScale == null) return {}
  const style = {}
  const ox = crop?.x ?? 0, oy = crop?.y ?? 0
  const s = animScale != null ? animScale : (crop?.scale ?? 1)
  if (s > 1) {
    style.transform = `scale(${s})`
    style.transformOrigin = `${50 + ox}% ${50 + oy}%`
  } else if (ox !== 0 || oy !== 0) {
    style.objectPosition = `${50 + ox}% ${50 + oy}%`
  }
  return style
}

/** True when the user has positioned/sized this clip via overlay drag-resize.
 *  Mirrors the same check in server/core/transitionBuilder.ts — used by the
 *  property panel to warn when overlay positioning silently disables features
 *  on the primary-track render path (Ken Burns, glow). */
export function hasUserOverlay(clip) {
  const ovl = clip?.overlay
  return !!(ovl && (ovl.x != null || ovl.y != null || ovl.width != null || ovl.height != null))
}

/** Read overlay fractions, defaulting to full canvas. */
export function getOverlayFractions(clip) {
  const ovl = clip?.overlay ?? {}
  return {
    x: ovl.x      ?? 0,
    y: ovl.y      ?? 0,
    w: ovl.width  ?? 1,
    h: ovl.height ?? 1,
  }
}

/** Effective overlay rect — Premiere transform semantics.
 *
 *  No user overlay: identity rect (full canvas). The <video>/<img>'s
 *  object-fit value (default 'fill') decides what happens inside that
 *  rect — same rule the renderer uses. Earlier this auto-fit to the
 *  asset's natural aspect, which made preview disagree with render: a
 *  16:9 clip on a 9:16 canvas looked letterboxed in preview but
 *  rendered stretched. Now both sides stretch consistently; the user
 *  drags a sub-rect or sets objectFit='contain' to letterbox.
 *
 *  Stored overlay: rendered raw — sacred. The user's drag is the truth. The
 *  asset stretches/covers to FILL whatever rect they made (object-fit on the
 *  <video>/<img> element handles it), so the transform box always frames the
 *  visible asset. No silent reshape, no jumping back to asset aspect. */
export function getEffectiveOverlay(clip, _assetAspect, _canvasAspect) {
  const ovl = clip?.overlay ?? {}
  const hasUserSet = ovl.x != null || ovl.y != null || ovl.width != null || ovl.height != null

  if (hasUserSet) {
    return {
      x: ovl.x      ?? 0,
      y: ovl.y      ?? 0,
      w: ovl.width  ?? 1,
      h: ovl.height ?? 1,
    }
  }

  return { x: 0, y: 0, w: 1, h: 1 }
}

/** Find the canvas-pixel rect of the preview. First walks up the DOM from the
 *  pointerdown target; if not found (because the handle was portal'd into
 *  document.body to escape stage's overflow:hidden), falls back to
 *  querySelector. */
function findStageRect(el) {
  while (el) {
    if (el.dataset?.previewStage === 'true') return el.getBoundingClientRect()
    el = el.parentElement
  }
  const stage = document.querySelector('[data-preview-stage="true"]')
  return stage ? stage.getBoundingClientRect() : null
}

/** Start a move drag — updates clip.overlay.{x,y} from pointer delta.
 *  `effective` is the auto-fit + user-set merged starting box (from
 *  getEffectiveOverlay), so the very first drag on a fresh clip starts at
 *  the aspect-fit position rather than full canvas.
 *
 *  pointermove uses updateClipLocal (no fetch); pointerup runs updateClip
 *  once with the final overlay so disk stays in sync without a PATCH storm. */
export function startOverlayMove(e, trackId, clipIdx, clip, _legacyUpdateClip, effective) {
  const stage = findStageRect(e.currentTarget)
  if (!stage) return
  e.preventDefault()
  e.stopPropagation()
  useProjectStore.getState().pushUndo()

  const startX = e.clientX, startY = e.clientY
  const init = effective ?? getOverlayFractions(clip)

  let lastOverlay = null
  const onMove = (ev) => {
    const dxF = (ev.clientX - startX) / stage.width
    const dyF = (ev.clientY - startY) / stage.height
    const nx = init.x + dxF
    const ny = init.y + dyF
    lastOverlay = { ...(clip.overlay ?? {}), x: nx, y: ny, width: init.w, height: init.h }
    useProjectStore.getState().updateClipLocal(trackId, clipIdx, { overlay: lastOverlay })
  }
  const onUp = () => {
    window.removeEventListener('pointermove', onMove)
    window.removeEventListener('pointerup',   onUp)
    if (lastOverlay) {
      useProjectStore.getState().updateClip(trackId, clipIdx, { overlay: lastOverlay })
    }
  }
  window.addEventListener('pointermove', onMove)
  window.addEventListener('pointerup',   onUp)
}

/** Start a corner-resize drag. pos = 'tl' | 'tr' | 'bl' | 'br'.
 *
 *  Premiere-style transform:
 *    - Default (no shift) → free transform; width and height move
 *      independently, the rect stretches in either direction.
 *    - Shift held         → lock the rect's CURRENT aspect ratio
 *      (init.w/init.h, not the source asset's aspect). The dominant axis of
 *      the drag drives, the other axis follows. */
export function startOverlayResize(e, trackId, clipIdx, clip, pos, _legacyUpdateClip, assetAspect, canvasAspect, effective) {
  const stage = findStageRect(e.currentTarget)
  if (!stage) return
  e.preventDefault()
  e.stopPropagation()
  useProjectStore.getState().pushUndo()

  const startX = e.clientX, startY = e.clientY
  const init = effective ?? getOverlayFractions(clip)
  // Lock target = current rect's pixel aspect (in canvas-fraction units).
  // Premiere semantics: shift preserves WHAT YOU SEE, not the source aspect.
  // Fallback to canvas-pixel aspect of init if for some reason init is
  // degenerate so we never divide by zero.
  const safeInitH = init.h > 0 ? init.h : 1
  const lockedRatio = init.w / safeInitH

  let lastOverlay = null
  const onMove = (ev) => {
    const dxF = (ev.clientX - startX) / stage.width
    const dyF = (ev.clientY - startY) / stage.height
    const aspectLock = ev.shiftKey

    let { x, y, w, h } = init

    if (pos === 'br') {
      w = Math.max(MIN_OVERLAY_FRAC, init.w + dxF)
      h = Math.max(MIN_OVERLAY_FRAC, init.h + dyF)
    } else if (pos === 'bl') {
      const nx = Math.min(init.x + init.w - MIN_OVERLAY_FRAC, init.x + dxF)
      w = init.w + (init.x - nx)
      x = nx
      h = Math.max(MIN_OVERLAY_FRAC, init.h + dyF)
    } else if (pos === 'tr') {
      const ny = Math.min(init.y + init.h - MIN_OVERLAY_FRAC, init.y + dyF)
      h = init.h + (init.y - ny)
      y = ny
      w = Math.max(MIN_OVERLAY_FRAC, init.w + dxF)
    } else if (pos === 'tl') {
      const nx = Math.min(init.x + init.w - MIN_OVERLAY_FRAC, init.x + dxF)
      const ny = Math.min(init.y + init.h - MIN_OVERLAY_FRAC, init.y + dyF)
      w = init.w + (init.x - nx)
      h = init.h + (init.y - ny)
      x = nx
      y = ny
    }

    if (aspectLock) {
      const usedW = Math.abs(w - init.w) >= Math.abs(h - init.h)
      if (usedW) {
        const newH = w / lockedRatio
        h = newH
        if (pos === 'tl' || pos === 'tr') y = init.y + init.h - h
      } else {
        const newW = h * lockedRatio
        w = newW
        if (pos === 'tl' || pos === 'bl') x = init.x + init.w - w
      }
      w = Math.max(MIN_OVERLAY_FRAC, w)
      h = Math.max(MIN_OVERLAY_FRAC, h)
    }
    lastOverlay = { ...(clip.overlay ?? {}), x, y, width: w, height: h }
    useProjectStore.getState().updateClipLocal(trackId, clipIdx, { overlay: lastOverlay })
  }
  const onUp = () => {
    window.removeEventListener('pointermove', onMove)
    window.removeEventListener('pointerup',   onUp)
    if (lastOverlay) {
      useProjectStore.getState().updateClip(trackId, clipIdx, { overlay: lastOverlay })
    }
  }
  window.addEventListener('pointermove', onMove)
  window.addEventListener('pointerup',   onUp)
}

/** Resize handle at a corner of the selection ring. Positioned fully INSIDE
 *  the ring so that even when the overlay is sized to the full canvas, the
 *  handle isn't clipped by the preview stage's overflow: hidden. */
export function ResizeHandle({ pos, onPointerDown }) {
  const positionStyle = {
    tl: { left: 0, top: 0,        cursor: 'nwse-resize' },
    tr: { right: 0, top: 0,       cursor: 'nesw-resize' },
    bl: { left: 0, bottom: 0,     cursor: 'nesw-resize' },
    br: { right: 0, bottom: 0,    cursor: 'nwse-resize' },
  }[pos]
  return (
    <div
      className="absolute pointer-events-auto z-[31] w-3 h-3 bg-white border border-[#6d5efc]"
      style={positionStyle}
      onPointerDown={onPointerDown}
    />
  )
}

/** Overlay clip (video or image) for non-primary tracks. Layered via DOM order.
 *  onAspectKnown(aspectRatio) fires once intrinsic dimensions are loaded so the
 *  parent can lock resize to the asset's true aspect.
 *  effective: precomputed { x, y, w, h } fractions — when omitted falls back
 *  to clip.overlay (or full canvas). */
export default function OverlayClip({ clip, projectId, playheadTime, isPlaying, muted, onAspectKnown, effective }) {
  const ref = useRef(null)
  const src = clip ? `/assets/${projectId}/${encodeURIComponent(clip.source)}` : null
  const prevSourceRef = useRef(null)
  const isImg = IMAGE_EXTS.test(clip?.source ?? '')

  const reportAspect = (w, h) => {
    if (w > 0 && h > 0) onAspectKnown?.(w / h)
  }

  useEffect(() => {
    if (isImg) return
    const v = ref.current
    if (v) v.muted = !!muted
  }, [muted, isImg])

  useEffect(() => {
    if (isImg) return
    const video = ref.current
    if (!video || !clip) return
    if (prevSourceRef.current !== clip.source) {
      prevSourceRef.current = clip.source
      video.src = src
      video.load()
      try { video.preservesPitch = true } catch {}
      video.addEventListener('loadedmetadata', () => {
        const clipSpeed = clip.speed ?? 1
        const seekPos = (clip.trimStart ?? 0) + (playheadTime - clip.start) * clipSpeed
        video.currentTime = Math.max(0, seekPos)
        video.playbackRate = clipSpeed
        if (isPlaying) video.play().catch(() => {})
      }, { once: true })
    }
  }, [clip?.source, isImg])  // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (isImg) return
    const video = ref.current
    if (!video || !clip || !video.src) return
    const clipSpeed = clip.speed ?? 1
    // Apply speed every tick — cheap, idempotent, catches mid-playback
    // speed changes from the EffectsPanel slider.
    if (Math.abs(video.playbackRate - clipSpeed) > 0.005) {
      video.playbackRate = clipSpeed
    }
    if (isPlaying) {
      video.play().catch(() => {})
    } else {
      video.pause()
      const seekPos = (clip.trimStart ?? 0) + (playheadTime - clip.start) * clipSpeed
      if (Math.abs(video.currentTime - seekPos) > 0.05) {
        video.currentTime = Math.max(0, seekPos)
      }
    }
  }, [isPlaying, playheadTime, isImg, clip?.speed])  // eslint-disable-line react-hooks/exhaustive-deps

  // xKF/yKF interpolated position at playhead. Falls back through effective
  // (drag-in-progress) > KF > static > 0. effective wins so a user dragging
  // the clip sees what they drag, not the animated value snapping back.
  const clipT = Math.max(0, playheadTime - (clip?.start ?? 0))
  const ovlForKf = clip?.overlay ?? {}
  const kfX = interpolateKF(ovlForKf.xKF, clipT)
  const kfY = interpolateKF(ovlForKf.yKF, clipT)

  // Solid color fill — render a colored div spanning the overlay rect.
  if (clip?.colorFill) {
    const ovl2 = clip?.overlay ?? {}
    const eff2 = effective ?? {
      x: kfX ?? ovl2.x ?? 0,
      y: kfY ?? ovl2.y ?? 0,
      w: ovl2.width ?? 1,
      h: ovl2.height ?? 1,
    }
    return (
      <div
        className="absolute pointer-events-none"
        style={{
          left:   `${eff2.x * 100}%`,
          top:    `${eff2.y * 100}%`,
          width:  `${eff2.w * 100}%`,
          height: `${eff2.h * 100}%`,
          backgroundColor: clip.colorFill,
          opacity: ovl2.opacity ?? 1,
        }}
      />
    )
  }

  const ovl = clip?.overlay ?? {}
  const eff = effective ?? {
    x: kfX ?? ovl.x      ?? 0,
    y: kfY ?? ovl.y      ?? 0,
    w:       ovl.width   ?? 1,
    h:       ovl.height  ?? 1,
  }

  // Animated opacity: interpolate opacityKF at playhead if present, else
  // fall back to the static overlay.opacity (or 1).
  const kfOpacity = interpolateOpacityKF(clip, playheadTime) ?? (ovl.opacity ?? 1)

  // Fade in/out opacity. On an overlay layer EVERY fade family resolves
  // to a simple opacity fade — the overlay sits on top of either another
  // clip or the canvas, so "fade to black" / "fade to white" / etc. all
  // visually mean "the overlay disappears smoothly to reveal what's
  // beneath". Filtering by type (the previous behaviour) made fade-black
  // / fade-white / blur / slide do nothing on overlay clips and the user
  // saw a hard cut. Slide / blur / zoom are still primary-only, but the
  // overlay's natural rendering for them is the opacity fade.
  const fadeOpacity = (() => {
    if (!clip) return 1
    const fi = clip.fadeIn, fo = clip.fadeOut
    if (fi && playheadTime < clip.start + fi.duration) {
      return Math.max(0, Math.min(1, (playheadTime - clip.start) / fi.duration))
    }
    if (fo && playheadTime > clip.end - fo.duration) {
      return Math.max(0, Math.min(1, 1 - (playheadTime - (clip.end - fo.duration)) / fo.duration))
    }
    return 1
  })()

  const animatedOpacity = kfOpacity * fadeOpacity

  // Default 'fill' = stretch the asset to whatever rect the user dragged
  // (Premiere transform). 'cover' fills with crop, 'contain' letterboxes.
  const ovlFit = clip?.objectFit ?? 'fill'
  const style = {
    left:   `${eff.x * 100}%`,
    top:    `${eff.y * 100}%`,
    width:  `${eff.w * 100}%`,
    height: `${eff.h * 100}%`,
    opacity: animatedOpacity,
    objectFit: ovlFit,
  }

  if (isImg) {
    return (
      <img
        src={src}
        alt=""
        className="absolute pointer-events-none"
        style={style}
        draggable={false}
        onLoad={(e) => reportAspect(e.currentTarget.naturalWidth, e.currentTarget.naturalHeight)}
      />
    )
  }
  return (
    <video
      ref={ref}
      className="absolute pointer-events-none"
      playsInline
      preload="metadata"
      style={style}
      onLoadedMetadata={(e) => reportAspect(e.currentTarget.videoWidth, e.currentTarget.videoHeight)}
    />
  )
}
