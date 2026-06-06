import { useRef, useEffect, useLayoutEffect, useCallback, useState, useMemo } from 'react'
import { createPortal } from 'react-dom'
import { useProjectStore, ASPECT_RATIOS } from '../../stores/projectStore'
import { useShallow } from 'zustand/react/shallow'
import { formatTimecode } from '../../utils/timeFormat'
import { audioEngine } from '../../audio/audioEngine'
import { getPlugins } from '../../utils/trackPlugins'
import OverlayClip, {
  computeCropStyle,
  getEffectiveOverlay,
  startOverlayMove,
  startOverlayResize,
  ResizeHandle,
  IMAGE_EXTS,
  interpolateOpacityKF,
} from './OverlayClip'
import TextOverlay from './TextOverlay'
import AssetPreview from './AssetPreview'
import { CANONICAL_HEIGHT } from './canonicalRes'

/** Find the active clip in a clips array at the given playheadTime */
function findActiveClip(clips = [], playheadTime) {
  return clips.find(c => playheadTime >= c.start && playheadTime < c.end) ?? null
}


function TimelinePreview({ project, playheadTime, isPlaying, setPlayheadTime, setIsPlaying, playbackSpeed, loopEnabled, containerH, videoHeight }) {
  const selectedClip = useProjectStore(s => s.selectedClip)
  const selectedClips = useProjectStore(s => s.selectedClips)
  const updateClip = useProjectStore(s => s.updateClip)
  // Maps clip identity (source filename) to its asset's intrinsic aspect ratio
  // (width / height in pixels). Set by OverlayClip when its <img>/<video> loads.
  // Used by resize handlers to lock to the actual image aspect, not the canvas
  // aspect — avoids the 9:16-canvas / 2:3-image (gpt-image) letterbox problem.
  const [assetAspects, setAssetAspects] = useState({})
  const setAssetAspect = useCallback((key, aspect) => {
    if (!key || !aspect) return
    setAssetAspects(prev => prev[key] === aspect ? prev : { ...prev, [key]: aspect })
  }, [])

  // Canvas aspect from project (e.g. '9:16' → 0.5625).
  const canvasAspect = useMemo(() => {
    const [aw, ah] = (project?.aspectRatio ?? '9:16').split(':').map(Number)
    return aw && ah ? aw / ah : 0.5625
  }, [project?.aspectRatio])

  // Track stage + container rects so selection rings can be portal'd out of
  // the stage's overflow:hidden (handles stay clickable past canvas) but
  // still get clipped to the preview-area container (so the ring + handles
  // don't bleed onto the playback controls or timeline below).
  //
  // ResizeObserver alone is enough — the rects only change due to layout,
  // not page scroll. The previous global scroll listener fired on every
  // asset-panel / property-panel scroll tick and triggered two setState
  // calls (5–10 useless TimelinePreview re-renders/sec while scrolling
  // unrelated panels).
  const [stageRect, setStageRect] = useState(null)
  const [containerRect, setContainerRect] = useState(null)
  useEffect(() => {
    const stage = document.querySelector('[data-preview-stage="true"]')
    const container = document.querySelector('[data-preview-container="true"]')
    if (!stage || !container) return
    const update = () => {
      setStageRect(stage.getBoundingClientRect())
      setContainerRect(container.getBoundingClientRect())
    }
    update()
    const ro = new ResizeObserver(update)
    ro.observe(stage)
    ro.observe(container)
    window.addEventListener('resize', update)
    return () => {
      ro.disconnect()
      window.removeEventListener('resize', update)
    }
  }, [])
  const videoRef      = useRef(null)
  const rafRef        = useRef(null)
  const activeClipRef = useRef(null)
  const playingRef    = useRef(isPlaying)
  const lastTimeRef   = useRef(null)
  const speedRef      = useRef(playbackSpeed ?? 1)
  const loopRef       = useRef(loopEnabled ?? false)

  useEffect(() => { speedRef.current = playbackSpeed ?? 1 }, [playbackSpeed])
  useEffect(() => { loopRef.current = loopEnabled ?? false }, [loopEnabled])

  // ── Find tracks by type (exclude hidden) ───────────────────────────────────
  // Sorted ascending by `order` so lowest order renders first in DOM (= back
  // layer). Higher-order tracks stack on top naturally via DOM order.
  //
  // Memoized on tracks alone — during playback the playheadTime tick fires
  // 60×/sec and re-renders this component, but tracks stays referentially
  // stable across those ticks (the project narrow selector preserves its
  // identity), so videoTracks doesn't rebuild every frame.
  const videoTracks = useMemo(() =>
    (project?.timeline?.tracks ?? [])
      .filter(t => t.type === 'video' && !t.hidden)
      .sort((a, b) => a.order - b.order),
    [project?.timeline?.tracks]
  )

  // Collect active clip per track in z-order. Tracks without an active clip
  // at this playhead are skipped so higher tracks can show through naturally.
  // findActiveClip is O(clips-per-track), so the cost is bounded; memo deps
  // are kept narrow so an exportRange / aspectRatio change doesn't force a
  // walk that the result wouldn't depend on.
  const activeLayers = useMemo(() =>
    videoTracks
      .map(t => ({ track: t, clip: findActiveClip(t.clips, playheadTime) }))
      .filter(l => l.clip),
    [videoTracks, playheadTime]
  )

  // Primary layer: only the lowest-order *track*'s active clip. Drives master
  // clock, transitions, crop, filter. If the primary track has no clip at
  // this playhead, primary stays null and overlay clips render via OverlayClip
  // (still positionable / resizable) — we don't auto-promote them to primary,
  // which would silently take away their drag/resize handles.
  const primaryTrack = videoTracks[0] ?? null
  const primaryLayer = primaryTrack
    ? (activeLayers.find(l => l.track.id === primaryTrack.id) ?? null)
    : null
  const effectiveVideoClip = primaryLayer?.clip ?? null
  const overlayLayers = activeLayers.filter(l => l !== primaryLayer)

  const videoSrc = effectiveVideoClip && project
    ? `/assets/${project.id}/${encodeURIComponent(effectiveVideoClip.source)}`
    : null

  const isImageClip = effectiveVideoClip ? IMAGE_EXTS.test(effectiveVideoClip.source) : false
  const isColorFillClip = !!effectiveVideoClip?.colorFill

  activeClipRef.current = effectiveVideoClip

  // ── Engine clip descriptors ──────────────────────────────────────────────
  // Engine owns ALL sound: both audio tracks and the audio streams embedded
  // in video files. Chromium's decodeAudioData handles mp4/mov/webm
  // containers natively, so video clips are routed to the engine the same
  // way as audio clips. The <video> elements stay visual-only (always muted).
  //
  // This is architectural, not a shortcut — it gives us a single audio path
  // so mute/volume/fades/AI handoff all operate through one surface
  // (see memory: project_vision.md).
  const engineClipDescriptors = useMemo(() => {
    const tracks = project?.timeline?.tracks ?? []
    const out = []
    for (const t of tracks) {
      if (t.type !== 'audio' && t.type !== 'video') continue
      if (t.hidden) continue
      const trackMuted = !!t.muted
      for (const c of (t.clips ?? [])) {
        if (!c?.source) continue
        // Image clips (PNG/JPG/WEBP/...) on video tracks have no audio stream.
        // Skipping prevents `decodeAudioData` from spamming "Unable to decode
        // audio data" once we land AI-generated images on the timeline.
        if (IMAGE_EXTS.test(c.source) || c.colorFill) continue
        const trimStart = c.trimStart ?? 0
        const clipDur = Math.max(0, (c.end ?? 0) - (c.start ?? 0))
        if (clipDur <= 0) continue
        const clipSpeed = c.speed ?? 1
        // Source range = timeline duration × clipSpeed. With clipSpeed=2 the
        // engine plays 2× the source content over the same timeline window
        // (and at 2× rate so it actually fits). When the clip already has
        // an explicit trimEnd set, prefer that — the source range was
        // pinned by the user via head-trim / split.
        const sourceRange = c.trimEnd != null
          ? (c.trimEnd - trimStart)
          : clipDur * clipSpeed
        out.push({
          source: c.source,
          // Owning track id — engine routes the clip to this track's meter bus.
          trackId: t.id,
          timelineStart: c.start ?? 0,
          trimStart,
          trimEnd: trimStart + sourceRange,
          speed: clipSpeed,
          volume: (c.volume == null ? 1 : c.volume) * (t.volume == null ? 1 : t.volume),
          muted: trackMuted || !!c.muted,
          fadeIn: Math.max(0, Number(c.fadeIn?.duration) || 0),
          fadeOut: Math.max(0, Number(c.fadeOut?.duration) || 0),
        })
      }
    }
    return out
  // Narrowed dependency: only the timeline tracks affect engine clips.
  // The previous [project] dep rebuilt on every project mutation
  // (rename, aspectRatio change, exportRange handle drag) even though
  // none of those touch audio scheduling.
  }, [project?.timeline?.tracks])

  // Per-track effect chains → engine. Built from track.plugins; the engine
  // applies them on each track bus (whole-track mix), not per clip.
  const trackPluginsMap = useMemo(() => {
    const m = new Map()
    for (const t of project?.timeline?.tracks ?? []) {
      const pl = getPlugins(t)
      if (pl.length) m.set(t.id, pl)
    }
    return m
  }, [project?.timeline?.tracks])

  const hasEngineClipsRef = useRef(false)
  hasEngineClipsRef.current = engineClipDescriptors.length > 0

  // Push descriptors → engine whenever they change. Engine diffs internally
  // and no-ops on structural identity, so re-renders are cheap.
  useEffect(() => {
    audioEngine.setProjectId(project?.id ?? null)
  }, [project?.id])

  useEffect(() => {
    audioEngine.setClips(engineClipDescriptors)
  }, [engineClipDescriptors])

  useEffect(() => {
    audioEngine.setTrackFx(trackPluginsMap)
  }, [trackPluginsMap])

  // ── Active text segments ──────────────────────────────────────────────────
  // Two-step memo: the sorted text-track list depends only on tracks; the
  // active-text filter additionally depends on playheadTime. Splitting the
  // filter+sort chain means the sort stays cached during playback ticks
  // even though the visibility filter rebuilds every frame.
  const textTracksSorted = useMemo(() =>
    (project?.timeline?.tracks ?? [])
      .filter(t => t.type === 'text' && !t.hidden)
      .sort((a, b) => a.order - b.order),
    [project?.timeline?.tracks]
  )
  const activeTexts = useMemo(() =>
    textTracksSorted.flatMap(t =>
      (t.clips ?? []).filter(s => playheadTime >= s.start && playheadTime < s.end)
    ),
    [textTracksSorted, playheadTime]
  )

  // ── Calculate the end of actual content (last clip end across all tracks) ──
  // Doesn't depend on playheadTime — memoize on tracks so the O(N×clips)
  // reduce skips during playback (was the most expensive single computation
  // re-running 60×/sec during playback).
  const contentEnd = useMemo(() => {
    const tracks = project?.timeline?.tracks ?? []
    let max = 0
    for (const t of tracks) {
      for (const c of (t.clips ?? [])) {
        if (c.end > max) max = c.end
      }
    }
    return max > 0 ? max : (project?.duration ?? 60)
  }, [project?.timeline?.tracks, project?.duration])

  // ── Unified playback loop (rAF) ───────────────────────────────────────────
  const tick = useCallback(() => {
    if (!playingRef.current) return

    const clip  = activeClipRef.current
    const video = videoRef.current
    const audioIsMaster = hasEngineClipsRef.current

    if (audioIsMaster) {
      // Engine owns the clock: sample-accurate, drift-free (see memory:
      // project_vision.md — preview audio via Web Audio API).
      const timelineTime = audioEngine.getPlayhead()
      setPlayheadTime(timelineTime)

      // Video element is a slave — soft rate-nudge when playing, hard-seek
      // only on catastrophic drift or when paused. Per-clip speed multiplies
      // into the rate (target = master * clipSpeed) and into the source-pos
      // calculation (each timeline second covers clipSpeed source seconds).
      if (clip && video && video.readyState >= 1) {
        const clipSpeed = clip.speed ?? 1
        const targetRate = speedRef.current * clipSpeed
        const expected = (clip.trimStart ?? 0) + (timelineTime - clip.start) * clipSpeed
        if (video.paused) {
          if (Math.abs(video.currentTime - expected) > 0.05) {
            video.currentTime = Math.max(0, expected)
          }
        } else {
          const drift = video.currentTime - expected  // +ve = video ahead
          const absDrift = Math.abs(drift)
          if (absDrift > 0.25) {
            // Jumped too far (tab throttled, seek, etc) — snap.
            video.currentTime = Math.max(0, expected)
            video.playbackRate = targetRate
          } else if (absDrift > 0.015) {
            // Soft correction: nudge rate so video drifts back to sync.
            // drift > 0 → slow down; drift < 0 → speed up.
            const correction = Math.max(-0.1, Math.min(0.1, drift * 0.5))
            const target = targetRate * (1 - correction)
            const clamped = Math.max(0.0625, Math.min(16, target))
            if (Math.abs(video.playbackRate - clamped) > 0.005) {
              video.playbackRate = clamped
            }
          } else if (Math.abs(video.playbackRate - targetRate) > 0.005) {
            // In-sync — restore exact rate.
            video.playbackRate = targetRate
          }
        }
      }
    } else if (clip && video && video.readyState >= 1 && !video.paused) {
      // Video-only fallback: video element is the master clock. Convert
      // source-time to timeline-time using the clip's speed (1 source
      // second = 1/clipSpeed timeline seconds).
      const timeInSource = video.currentTime
      if (!isNaN(timeInSource)) {
        const clipSpeed = clip.speed ?? 1
        const timelineTime = clip.start + (timeInSource - (clip.trimStart ?? 0)) / clipSpeed

        if (timelineTime >= clip.end || video.ended) {
          video.pause()
          setPlayheadTime(clip.end)
          lastTimeRef.current = performance.now()
        } else {
          setPlayheadTime(timelineTime)
        }
      }
    } else {
      // No video, no audio — perf.now() fallback.
      const now = performance.now()
      const last = lastTimeRef.current ?? now
      lastTimeRef.current = now
      const elapsed = Math.min((now - last) / 1000, 0.2)
      if (elapsed > 0.005) {
        setPlayheadTime(t => t + elapsed * speedRef.current)
      }
    }

    // Apply playback rate for non-audio-master branches (audio-master nudges
    // rate itself for drift correction above). Includes per-clip speed.
    if (!audioIsMaster && video && clip) {
      const targetRate = speedRef.current * (clip.speed ?? 1)
      if (Math.abs(video.playbackRate - targetRate) > 0.01) {
        video.playbackRate = targetRate
      }
    }

    const { playheadTime: currentPh, loopExportRange, project: proj } = useProjectStore.getState()
    const range = proj?.exportRange ?? null
    const rangeIn = range?.in ?? 0
    const rangeOut = range?.out ?? contentEnd
    // When loopExportRange is on and we hit the Out point → jump back to In
    if (loopExportRange && range && currentPh >= rangeOut) {
      setPlayheadTime(rangeIn)
    } else if (currentPh >= contentEnd) {
      if (loopRef.current) {
        setPlayheadTime(0)
      } else {
        setPlayheadTime(contentEnd)
        playingRef.current = false
        setIsPlaying(false)
        if (video) video.pause()
        return
      }
    }

    rafRef.current = requestAnimationFrame(tick)
  }, [contentEnd, setPlayheadTime, setIsPlaying])

  // ── Start/stop playback ───────────────────────────────────────────────────
  useEffect(() => {
    playingRef.current = isPlaying
    const video = videoRef.current

    if (isPlaying) {
      lastTimeRef.current = performance.now()

      // Kick the audio engine. Engine is a no-op if no audio clips are loaded.
      audioEngine.play(playheadTime, speedRef.current)

      if (effectiveVideoClip && video) {
        const expectedSrc = `/assets/${project?.id}/${encodeURIComponent(effectiveVideoClip.source)}`
        if (!video.src || !video.src.includes(encodeURIComponent(effectiveVideoClip.source))) {
          video.src = expectedSrc
          video.load()
          video.addEventListener('loadedmetadata', () => {
            const seekPos = (effectiveVideoClip.trimStart ?? 0) + (playheadTime - effectiveVideoClip.start)
            video.currentTime = Math.max(0, seekPos)
            video.play().catch(() => {})
          }, { once: true })
        } else {
          const seekPos = (effectiveVideoClip.trimStart ?? 0) + (playheadTime - effectiveVideoClip.start)
          video.currentTime = seekPos
          video.play().catch(() => {})
        }
      }

      rafRef.current = requestAnimationFrame(tick)
    } else {
      cancelAnimationFrame(rafRef.current)
      audioEngine.pause()
      if (video) video.pause()
    }

    return () => cancelAnimationFrame(rafRef.current)
  }, [isPlaying])  // eslint-disable-line react-hooks/exhaustive-deps

  // Keep engine speed in sync with playback speed.
  useEffect(() => {
    audioEngine.setSpeed(playbackSpeed ?? 1)
  }, [playbackSpeed])

  // Main <video> element is purely visual — sound comes from the engine,
  // including the video file's own audio stream. Always muted whenever
  // there is ANY clip on the timeline. For a truly empty timeline, leave
  // it unmuted as a nicety (asset preview still works).
  const engineOwnsAudio = engineClipDescriptors.length > 0
  useEffect(() => {
    const v = videoRef.current
    if (v) v.muted = engineOwnsAudio
  }, [engineOwnsAudio])

  // User seeked the playhead externally (click on ruler, drag in timeline)
  // while NOT playing. Forward to engine so the next play() starts at the
  // right spot. During playback, engine is master so we don't push back.
  useEffect(() => {
    // When playing, the rAF tick writes engine playhead back to the store
    // every frame. audioEngine.seek() no-ops for tiny diffs (< 20ms) so tick
    // feedback is free, but an external click-to-seek re-anchors the engine.
    audioEngine.seek(playheadTime)
  }, [playheadTime])

  // ── Load new source when clip changes ─────────────────────────────────────
  const prevSourceRef = useRef(null)
  useEffect(() => {
    const video = videoRef.current
    if (!video) return

    if (!effectiveVideoClip) {
      // No active clip on this layer: clear the video element's src so the
      // last-played frame doesn't linger after a fade-out completes (was
      // gated on `!playingRef.current`, which meant the lingering happened
      // during playback past the last clip — fadeOverlay disappeared at
      // clip.end but the underlying video kept the last frame painted).
      prevSourceRef.current = null
      if (video.src) {
        video.removeAttribute('src')
        video.load()
      }
      return
    }

    if (prevSourceRef.current !== effectiveVideoClip.source) {
      prevSourceRef.current = effectiveVideoClip.source
      if (IMAGE_EXTS.test(effectiveVideoClip.source) || effectiveVideoClip.colorFill) {
        video.src = ''
        return
      }
      const wasPlaying = playingRef.current
      video.src = videoSrc
      video.load()
      // Try to keep audio pitch when speed≠1; supported in modern Chromium
      // and Safari, no-op elsewhere. Render path uses ffmpeg atempo for the
      // exported file so the export is always pitch-correct regardless.
      try { video.preservesPitch = true } catch {}
      video.addEventListener('loadedmetadata', () => {
        const clipSpeed = effectiveVideoClip.speed ?? 1
        const seekPos = (effectiveVideoClip.trimStart ?? 0) + (playheadTime - effectiveVideoClip.start) * clipSpeed
        video.currentTime = Math.max(0, seekPos)
        if (wasPlaying) video.play().catch(() => {})
      }, { once: true })
    }
  }, [effectiveVideoClip?.source])  // eslint-disable-line react-hooks/exhaustive-deps

  // ── Seek while paused ─────────────────────────────────────────────────────
  useEffect(() => {
    if (isPlaying) return
    const video = videoRef.current
    if (!video || !effectiveVideoClip || !video.src) return
    const clipSpeed = effectiveVideoClip.speed ?? 1
    const seekPos = (effectiveVideoClip.trimStart ?? 0) + (playheadTime - effectiveVideoClip.start) * clipSpeed
    if (Math.abs(video.currentTime - seekPos) > 0.05) {
      video.currentTime = Math.max(0, seekPos)
    }
  }, [playheadTime, isPlaying])  // eslint-disable-line react-hooks/exhaustive-deps

  // ── Cleanup ───────────────────────────────────────────────────────────────
  useEffect(() => () => { cancelAnimationFrame(rafRef.current); playingRef.current = false }, [])


  // ── Calculate fade / transition overlay ────────────────────────────────────
  let fadeOverlay = null
  let clipTransform = null
  if (effectiveVideoClip) {
    const clip = effectiveVideoClip
    const fi = clip.fadeIn
    const fo = clip.fadeOut

    let effect = null
    let progress = 0

    if (fi && playheadTime < clip.start + fi.duration) {
      progress = Math.max(0, Math.min(1, (playheadTime - clip.start) / fi.duration))
      effect = { ...fi, direction: 'in' }
    } else if (fo && playheadTime > clip.end - fo.duration) {
      progress = Math.max(0, Math.min(1, (playheadTime - (clip.end - fo.duration)) / fo.duration))
      effect = { ...fo, direction: 'out' }
    }

    if (effect) {
      const type = effect.type || ''
      const isIn = effect.direction === 'in'
      // For "in" effects, progress goes 0→1 (0=start, 1=fully visible)
      // For "out" effects, progress goes 0→1 (0=fully visible, 1=end)

      if (type === 'fade' || type === 'crossfade' || type === '') {
        // Simple opacity fade on the clip itself
        clipTransform = { opacity: isIn ? progress : (1 - progress) }
      } else if (type.includes('fade-black') || type.includes('fade-white') || (effect.color && !type.includes('blur') && !type.includes('slide') && !type.includes('zoom'))) {
        // Color fade overlay
        const color = effect.color === '#fff' ? '255,255,255' : '0,0,0'
        const opacity = isIn ? (1 - progress) : progress
        fadeOverlay = { color, opacity }
      } else if (type.includes('blur')) {
        // Blur effect
        const blurAmount = isIn ? (1 - progress) * 20 : progress * 20
        clipTransform = { filter: `blur(${blurAmount}px)` }
      } else if (type.includes('slide-left')) {
        const offset = isIn ? (1 - progress) * -100 : progress * 100
        clipTransform = { transform: `translateX(${offset}%)` }
      } else if (type.includes('slide-right')) {
        const offset = isIn ? (1 - progress) * 100 : progress * 100
        clipTransform = { transform: `translateX(${offset}%)` }
      } else if (type.includes('slide-up')) {
        const offset = isIn ? (1 - progress) * -100 : progress * -100
        clipTransform = { transform: `translateY(${offset}%)` }
      } else if (type.includes('slide-down')) {
        const offset = isIn ? (1 - progress) * 100 : progress * 100
        clipTransform = { transform: `translateY(${offset}%)` }
      } else if (type.includes('zoom')) {
        const scale = isIn ? progress : (1 - progress)
        const opacity = isIn ? progress : (1 - progress)
        clipTransform = { transform: `scale(${0.5 + scale * 0.5})`, opacity }
      } else {
        // Fallback: treat as black fade
        const opacity = isIn ? (1 - progress) : progress
        fadeOverlay = { color: '0,0,0', opacity }
      }
    }
  }

  // ── Crop / zoom style (Ken Burns animated scale if scaleAnim is set) ────────
  const animatedScale = (() => {
    const sa = effectiveVideoClip?.scaleAnim
    if (!sa) return null
    const clipDur = effectiveVideoClip.end - effectiveVideoClip.start
    if (clipDur <= 0) return sa.fromScale
    const animDur = sa.duration != null ? Math.min(sa.duration, clipDur) : clipDur
    const rawT = Math.max(0, Math.min(1, (playheadTime - effectiveVideoClip.start) / animDur))
    let t
    switch (sa.easing) {
      case 'ease-in':     t = rawT * rawT; break
      case 'ease-out':    t = 1 - (1 - rawT) * (1 - rawT); break
      case 'ease-in-out': t = rawT < 0.5 ? 2 * rawT * rawT : 1 - Math.pow(-2 * rawT + 2, 2) / 2; break
      default:            t = rawT
    }
    return sa.fromScale + (sa.toScale - sa.fromScale) * t
  })()
  const cropStyle = computeCropStyle(effectiveVideoClip?.crop, animatedScale)

  // ── Filter CSS ─────────────────────────────────────────────────────────────
  const filterCss = (() => {
    const f = effectiveVideoClip?.filter
    if (!f || f.type === 'none') return ''
    const i = f.intensity ?? 0.5
    switch (f.type) {
      case 'vintage': return `sepia(${i * 0.8}) contrast(${1 + i * 0.2}) brightness(${1 - i * 0.15})`
      case 'cool':    return `hue-rotate(190deg) saturate(${1 + i * 0.5}) brightness(${1 + i * 0.05})`
      case 'warm':    return `hue-rotate(-20deg) saturate(${1 + i * 0.5}) brightness(${1 + i * 0.05})`
      case 'bw':      return `grayscale(${i * 2})`
      default: return ''
    }
  })()

  // Merge clip transition effects + crop + filter
  const combinedVideoStyle = (() => {
    const base = { ...cropStyle }

    // Start with color filter
    if (filterCss) base.filter = filterCss

    if (clipTransform) {
      // Combine transforms if both exist
      if (clipTransform.transform && base.transform) {
        base.transform = `${base.transform} ${clipTransform.transform}`
      } else if (clipTransform.transform) {
        base.transform = clipTransform.transform
      }
      // Combine filters (transition blur + color filter)
      if (clipTransform.filter) {
        base.filter = base.filter ? `${base.filter} ${clipTransform.filter}` : clipTransform.filter
      }
      if (clipTransform.opacity !== undefined) base.opacity = clipTransform.opacity
    }
    // Animated opacity (mirror of ffmpeg main-track opacity chain): opacityKF
    // takes precedence over static overlay.opacity. Multiplied with any
    // transition opacity already on base so fade-in + KF compose correctly.
    const kfO = interpolateOpacityKF(effectiveVideoClip, playheadTime)
    const staticO = effectiveVideoClip?.overlay?.opacity
    const animO = kfO != null ? kfO : (staticO != null ? staticO : 1)
    if (animO < 1) {
      base.opacity = (base.opacity ?? 1) * animO
    }
    return Object.keys(base).length > 0 ? base : undefined
  })()

  return (
    <>
      {/* Primary layer stays in-flow with w-full h-full so its intrinsic size
          gives the stage a real box for layout (the parent has aspectRatio +
          max-* but no explicit width/height, so it relies on content to size).
          Overlay fractions are applied via CSS transform on top of the in-flow
          element — this lets drag-to-position work on the main track too,
          without breaking the layout that `position: absolute` would. */}
      {(() => {
        const primaryAspectKey = effectiveVideoClip?.source ?? effectiveVideoClip?.aiScriptRef ?? null
        const primaryAspect = primaryAspectKey ? assetAspects[primaryAspectKey] : null
        const primaryEff = effectiveVideoClip
          ? getEffectiveOverlay(effectiveVideoClip, primaryAspect, canvasAspect)
          : { x: 0, y: 0, w: 1, h: 1 }
        // Identity transform when overlay is full-canvas (default) — avoid
        // emitting unnecessary CSS that would interfere with crop/transition.
        const isIdentity = primaryEff.x === 0 && primaryEff.y === 0 && primaryEff.w === 1 && primaryEff.h === 1
        const overlayTransform = isIdentity
          ? null
          : `translate(${primaryEff.x * 100}%, ${primaryEff.y * 100}%) scale(${primaryEff.w}, ${primaryEff.h})`
        const baseStyle = combinedVideoStyle || {}
        const mergedTransform = overlayTransform
          ? (baseStyle.transform ? `${overlayTransform} ${baseStyle.transform}` : overlayTransform)
          : baseStyle.transform
        const primaryStyle = {
          ...baseStyle,
          ...(overlayTransform ? { transformOrigin: '0 0' } : {}),
          ...(mergedTransform ? { transform: mergedTransform } : {}),
        }
        return (
          <>
            {isColorFillClip && effectiveVideoClip ? (
              // Solid-color primary uses an inline SVG so the element has both
              // an intrinsic aspect ratio (drives stage size like an <img>
              // would) AND its own paint (the rect fill). Avoids the stage
              // collapse problem from a bare <div>, and stays in-flow so
              // absolute overlays paint on top in DOM order.
              <svg
                viewBox={`0 0 ${canvasAspect} 1`}
                preserveAspectRatio="none"
                className="block w-full"
                style={Object.keys(primaryStyle).length ? primaryStyle : undefined}
              >
                <rect width={canvasAspect} height={1} fill={effectiveVideoClip.colorFill} />
              </svg>
            ) : isImageClip && effectiveVideoClip ? (
              <img
                src={videoSrc}
                alt=""
                className={`w-full h-full ${(() => {
                  const f = effectiveVideoClip.objectFit ?? 'fill'
                  return f === 'cover' ? 'object-cover' : f === 'contain' ? 'object-contain' : 'object-fill'
                })()}`}
                style={Object.keys(primaryStyle).length ? primaryStyle : undefined}
                onLoad={(e) => {
                  const w = e.currentTarget.naturalWidth, h = e.currentTarget.naturalHeight
                  if (primaryAspectKey && w > 0 && h > 0) setAssetAspect(primaryAspectKey, w / h)
                }}
              />
            ) : null}

            <video
              ref={videoRef}
              // Default 'fill' = stretch asset to fill the rect, so the
              // transform box always hugs the visible asset and free-resize
              // works as expected (Premiere transform). 'cover' = canvas-fill
              // with side-crop; 'contain' = letterbox inside the rect.
              className={`w-full h-full ${(() => {
                const f = effectiveVideoClip?.objectFit ?? 'fill'
                return f === 'cover' ? 'object-cover' : f === 'contain' ? 'object-contain' : 'object-fill'
              })()}`}
              playsInline
              preload="metadata"
              style={(isImageClip || isColorFillClip)
                ? { display: 'none', width: '100%', height: '100%' }
                : (Object.keys(primaryStyle).length ? primaryStyle : undefined)}
              onLoadedMetadata={(e) => {
                const w = e.currentTarget.videoWidth, h = e.currentTarget.videoHeight
                if (primaryAspectKey && w > 0 && h > 0) setAssetAspect(primaryAspectKey, w / h)
              }}
            />
          </>
        )
      })()}

      {overlayLayers.map(({ clip, track }, i) => {
        const aspectKey = clip.source || clip.aiScriptRef || `${track.id}-${i}`
        const effective = getEffectiveOverlay(clip, assetAspects[aspectKey], canvasAspect)
        return (
          <OverlayClip
            key={`${track.id}-${clip.source}-${i}`}
            clip={clip}
            projectId={project.id}
            playheadTime={playheadTime}
            isPlaying={isPlaying}
            muted={engineOwnsAudio}
            effective={effective}
            onAspectKnown={(a) => setAssetAspect(aspectKey, a)}
          />
        )
      })}

      {activeTexts.map((seg, i) => (
        <TextOverlay key={i} segment={seg} containerH={containerH} videoHeight={videoHeight} />
      ))}

      {/* Fade in/out overlay */}
      {fadeOverlay && fadeOverlay.opacity > 0.01 && (
        <div
          className="absolute inset-0 pointer-events-none z-20"
          style={{ backgroundColor: `rgba(${fadeOverlay.color},${fadeOverlay.opacity})` }}
        />
      )}

      {/* Selection outlines + resize handles. Portal'd into document.body so
          handles remain clickable even when the overlay extends past the
          stage's overflow:hidden boundary. Two-layer wrapper:
          - Outer: clipped to the preview-area container, so off-canvas ring
            doesn't bleed onto the playback controls / timeline below.
          - Inner: aligned to the stage rect, so selection % positioning
            still works against canvas dimensions. */}
      {stageRect && containerRect && createPortal(
        <div
          style={{
            position: 'fixed',
            left:   containerRect.left,
            top:    containerRect.top,
            width:  containerRect.width,
            height: containerRect.height,
            overflow: 'hidden',
            pointerEvents: 'none',
            zIndex: 30,
          }}
        >
        <div
          style={{
            position: 'absolute',
            left:   stageRect.left - containerRect.left,
            top:    stageRect.top  - containerRect.top,
            width:  stageRect.width,
            height: stageRect.height,
          }}
        >
          {selectedClips.map(sel => {
            const layer = activeLayers.find(l =>
              l.track.id === sel.trackId &&
              l.track.clips[sel.index] === l.clip
            )
            if (!layer) return null
            const isPrimary  = sel.trackId === selectedClip?.trackId && sel.index === selectedClip?.index
            const aspectKey  = layer.clip.source || layer.clip.aiScriptRef || `${layer.track.id}-${activeLayers.indexOf(layer)}`
            const a          = assetAspects[aspectKey]
            const eff        = getEffectiveOverlay(layer.clip, a, canvasAspect)
            return (
              <div
                key={`${sel.trackId}-${sel.index}`}
                className={`absolute pointer-events-none ring-2 ring-inset ${isPrimary ? 'ring-[#6d5efc]' : 'ring-white/60'}`}
                style={{
                  left:   `${eff.x * 100}%`,
                  top:    `${eff.y * 100}%`,
                  width:  `${eff.w * 100}%`,
                  height: `${eff.h * 100}%`,
                }}
              >
                {isPrimary && (
                  <>
                    <ResizeHandle pos="tl" onPointerDown={(e) => startOverlayResize(e, sel.trackId, sel.index, layer.clip, 'tl', updateClip, a, canvasAspect, eff)} />
                    <ResizeHandle pos="tr" onPointerDown={(e) => startOverlayResize(e, sel.trackId, sel.index, layer.clip, 'tr', updateClip, a, canvasAspect, eff)} />
                    <ResizeHandle pos="bl" onPointerDown={(e) => startOverlayResize(e, sel.trackId, sel.index, layer.clip, 'bl', updateClip, a, canvasAspect, eff)} />
                    <ResizeHandle pos="br" onPointerDown={(e) => startOverlayResize(e, sel.trackId, sel.index, layer.clip, 'br', updateClip, a, canvasAspect, eff)} />
                  </>
                )}
              </div>
            )
          })}
        </div>
        </div>,
        document.body,
      )}

      {/* Click-and-drag interaction layer:
          - Click empty canvas: deselect.
          - Click on the topmost overlay clip: select it.
          - Drag a selected overlay clip: move it (updates clip.overlay.x/y).
          - Primary (in-flow) layer is non-positionable — clicking it just selects. */}
      {(() => {
        const topLayer = activeLayers[activeLayers.length - 1]
        const isTopSelected = !!topLayer
          && selectedClip?.trackId === topLayer.track.id
          && selectedClip?.index   === topLayer.track.clips.indexOf(topLayer.clip)
        const cursor = (isTopSelected && !!topLayer) ? 'cursor-move' : 'cursor-pointer'
        return (
          <div
            className={`absolute inset-0 z-[25] ${cursor}`}
            onPointerDown={(e) => {
              if (!topLayer) {
                useProjectStore.getState().deselectClip()
                return
              }
              const trackId = topLayer.track.id
              const clipIdx = topLayer.track.clips.indexOf(topLayer.clip)
              if (!isTopSelected) {
                useProjectStore.getState().selectClip(trackId, clipIdx)
                return
              }
              const aspectKey = topLayer.clip.source || topLayer.clip.aiScriptRef || `${topLayer.track.id}-${activeLayers.indexOf(topLayer)}`
              const eff = getEffectiveOverlay(topLayer.clip, assetAspects[aspectKey], canvasAspect)
              startOverlayMove(e, trackId, clipIdx, topLayer.clip, updateClip, eff)
            }}
          />
        )
      })()}

    </>
  )
}

// ── PreviewPanel ───────────────────────────────────────────────────────────────
export default function PreviewPanel() {
  // Narrow project subscription via useShallow over the fields actually
  // consumed downstream. Mutations to fields PreviewPanel doesn't read
  // (exportRange, name, storyboardConfig, createdAt) no longer re-render
  // the playback pipeline. tracks reference still changes on every clip
  // mutation — that's correct, the playhead-driven activeLayers walk
  // must reflect the change.
  const project = useProjectStore(useShallow(s => s.project ? {
    id:          s.project.id,
    aspectRatio: s.project.aspectRatio,
    duration:    s.project.duration,
    timeline:    s.project.timeline,
  } : null))
  const playheadTime = useProjectStore(s => s.playheadTime)
  const setPlayheadTime = useProjectStore(s => s.setPlayheadTime)
  const isPlaying = useProjectStore(s => s.isPlaying)
  const setIsPlaying = useProjectStore(s => s.setIsPlaying)
  const previewAsset = useProjectStore(s => s.previewAsset)
  const updateProjectMeta = useProjectStore(s => s.updateProjectMeta)
  const selectedClip = useProjectStore(s => s.selectedClip)
  const selectedClips = useProjectStore(s => s.selectedClips)
  const updateClip = useProjectStore(s => s.updateClip)

  const containerRef = useRef(null)
  const stageRef = useRef(null)
  const [containerH, setContainerH] = useState(400)
  const [showRatioMenu, setShowRatioMenu] = useState(false)
  const [previewZoom, setPreviewZoom] = useState(1)
  // Inner free area of the preview container (excludes padding). The stage's
  // pixel size is computed off this so 100% always means "fit-to-window" —
  // before this, zoom !== 1 dropped the CSS max constraints and let the stage
  // fall back to its natural (1:1 source) size, so dragging from 100% to 99%
  // made the stage suddenly jump much larger.
  const [innerSize, setInnerSize] = useState({ w: 0, h: 0 })
  const PREVIEW_ZOOM_MIN = 0.25
  const PREVIEW_ZOOM_MAX = 4
  const stepZoom = (delta) => setPreviewZoom(z => Math.max(PREVIEW_ZOOM_MIN, Math.min(PREVIEW_ZOOM_MAX, +(z * delta).toFixed(2))))
  // Slider maps linearly 0..100 to log2(zoom) in [log2(MIN), log2(MAX)] so
  // the midpoint sits at 1× (log2(0.25)=-2, log2(4)=2; midpoint 0 → 2^0 = 1).
  const PREVIEW_ZOOM_LOG_MIN = Math.log2(PREVIEW_ZOOM_MIN)
  const PREVIEW_ZOOM_LOG_MAX = Math.log2(PREVIEW_ZOOM_MAX)
  const zoomToSliderPct = (z) => ((Math.log2(z) - PREVIEW_ZOOM_LOG_MIN) / (PREVIEW_ZOOM_LOG_MAX - PREVIEW_ZOOM_LOG_MIN)) * 100
  const sliderPctToZoom = (s) => +Math.pow(2, PREVIEW_ZOOM_LOG_MIN + (s / 100) * (PREVIEW_ZOOM_LOG_MAX - PREVIEW_ZOOM_LOG_MIN)).toFixed(3)

  // Measure the preview container's inner area (content box, padding excluded).
  // The stage's explicit pixel size is computed off this — see the style block
  // around `data-preview-stage` below.
  useLayoutEffect(() => {
    const el = containerRef.current
    if (!el) return
    const measure = () => {
      const cs = window.getComputedStyle(el)
      const padX = parseFloat(cs.paddingLeft) + parseFloat(cs.paddingRight)
      const padY = parseFloat(cs.paddingTop)  + parseFloat(cs.paddingBottom)
      setInnerSize({
        w: Math.max(0, el.clientWidth  - padX),
        h: Math.max(0, el.clientHeight - padY),
      })
    }
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  // Track preview stage actual rendered height. Drives font scale so preview
  // matches what libass produces at canonical resolution.
  // Use callback ref so observer attaches the moment the element mounts and
  // re-attaches if the element is replaced (e.g. when project loads).
  const setStageRef = useCallback((el) => {
    stageRef.current = el
    if (!el) return
    const measure = () => {
      const h = el.getBoundingClientRect().height
      if (h > 0) setContainerH(h)
    }
    measure()
    const ro = new ResizeObserver(() => measure())
    ro.observe(el)
    if (el._cleanupRO) el._cleanupRO()
    el._cleanupRO = () => ro.disconnect()
  }, [])

  // Drop a sticker directly onto the preview canvas — pin overlay at the cursor
  // position in canvas fractions and dispatch into the dedicated 表情 track.
  const [stickerDragOver, setStickerDragOver] = useState(false)
  const handleStageDragOver = useCallback((e) => {
    if (![...e.dataTransfer.types].includes('application/json')) return
    e.preventDefault()
    e.dataTransfer.dropEffect = 'copy'
    setStickerDragOver(true)
  }, [])
  const handleStageDragLeave = useCallback(() => setStickerDragOver(false), [])
  const handleStageDrop = useCallback(async (e) => {
    setStickerDragOver(false)
    const raw = e.dataTransfer.getData('application/json')
    if (!raw) return
    let payload
    try { payload = JSON.parse(raw) } catch { return }
    if (!payload?.__sticker) return  // only stickers handled here
    e.preventDefault()
    e.stopPropagation()

    const { project, playheadTime: t } = useProjectStore.getState()
    if (!project) return

    const rect = stageRef.current?.getBoundingClientRect()
    if (!rect || rect.width === 0 || rect.height === 0) return

    // Cursor → canvas fractions, centred on the chosen overlay size.
    const w = Math.max(0.05, Math.min(0.9, payload.defaultSize ?? 0.25))
    const h = w
    const cx = (e.clientX - rect.left) / rect.width
    const cy = (e.clientY - rect.top)  / rect.height
    const x = Math.max(0, Math.min(1 - w, cx - w / 2))
    const y = Math.max(0, Math.min(1 - h, cy - h / 2))

    try {
      const r = await fetch('/api/stickers/import-to-project', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ projectId: project.id, stickerId: payload.stickerId }),
      })
      if (!r.ok) return
      const result = await r.json()
      useProjectStore.getState().addStickerClip({
        filename: result.filename,
        duration: result.duration ?? payload.duration ?? 1.5,
        overlay:  { x, y, width: w, height: h, opacity: 1 },
        start:    t,
      })
      useProjectStore.getState().bumpAssetVersion?.()
    } catch {}
  }, [])

  const videoHeight = CANONICAL_HEIGHT[project?.aspectRatio ?? '9:16'] ?? 1920

  const [playbackSpeed, setPlaybackSpeed] = useState(1)
  const [loopEnabled, setLoopEnabled] = useState(false)
  const [showSpeedMenu, setShowSpeedMenu] = useState(false)
  const masterVolume = useProjectStore(s => s.masterVolume)
  const SPEEDS = [0.5, 1, 1.5, 2]

  // Master volume (store) → engine. Persistence is handled by the store action.
  // The master volume / output-meter UI now lives in the left "效果" tab's
  // Main Out strip (MainOutStrip); this only keeps the engine in sync globally.
  useEffect(() => {
    audioEngine.setMasterVolume(masterVolume)
  }, [masterVolume])

  // Pre-warm AudioContext on first user gesture anywhere so the first play()
  // doesn't incur resume() latency (Chromium requires a gesture to start audio).
  useEffect(() => {
    const warm = () => { audioEngine.warmup() }
    window.addEventListener('pointerdown', warm, { once: true, capture: true })
    window.addEventListener('keydown', warm, { once: true, capture: true })
    return () => {
      window.removeEventListener('pointerdown', warm, { capture: true })
      window.removeEventListener('keydown', warm, { capture: true })
    }
  }, [])

  const currentRatio = project?.aspectRatio ?? '9:16'
  const ratio = ASPECT_RATIOS.find(r => r.id === currentRatio) ?? ASPECT_RATIOS[0]

  // Calculate content end (last clip end across all tracks). Memoized so
  // unrelated re-renders (e.g. ratio menu open/close, drag state changes)
  // don't re-walk the whole timeline.
  const contentEnd = useMemo(() => {
    const tracks = project?.timeline?.tracks ?? []
    let max = 0
    for (const t of tracks) {
      for (const c of (t.clips ?? [])) {
        if (c.end > max) max = c.end
      }
    }
    return max > 0 ? max : (project?.duration ?? 60)
  }, [project?.timeline?.tracks, project?.duration])

  const handleRatioChange = (id) => {
    updateProjectMeta({ aspectRatio: id })
    setShowRatioMenu(false)
  }

  return (
    <>
    <div className="flex flex-col h-full bg-[#0d0d0d]">
      {/* Preview area — fixed aspect ratio with padding. data-preview-container
          marks the clipping boundary for portal'd selection rings; anything
          past this (playback controls, timeline) stays unobstructed. */}
      <div
        ref={containerRef} data-preview-container="true"
        className={`flex-1 flex items-center justify-center min-h-0 p-6 bg-[#1a1a1a] ${previewZoom > 1 ? 'overflow-auto' : 'overflow-hidden'}`}
        onWheel={(e) => {
          // Cmd / Ctrl + wheel zooms the preview, like image apps. Plain wheel
          // is left alone so the container can scroll when zoomed > 1.
          if (e.ctrlKey || e.metaKey) {
            e.preventDefault()
            stepZoom(e.deltaY < 0 ? 1.1 : 1 / 1.1)
          }
        }}
      >
        {previewAsset && project ? (
          // Asset-library preview: show the asset at its own intrinsic aspect
          // ratio, NOT constrained by the project's canvas shape. Otherwise a
          // 16:9 source previewed against a 9:16 canvas would get letterboxed
          // into a tiny portrait letterbox, which the user reads as "the asset
          // changed shape" when in fact only the surrounding stage did.
          // Source-monitor semantics: the asset preview is independent of the
          // project canvas; only the timeline preview honors it.
          <div className="w-full h-full flex items-center justify-center">
            <AssetPreview asset={previewAsset} projectId={project.id} />
          </div>
        ) : (
          (() => {
            // 100% = fit-to-window pixel size; the slider then scales the layout
            // box (width × height in px). This keeps semantics consistent: the
            // stage's visual size is always inner-area × zoom, never source-1:1.
            // Falls back to aspect-ratio + max constraints on the first render
            // before innerSize is measured (one frame).
            const aspect = ratio.w / ratio.h
            const measured = innerSize.w > 0 && innerSize.h > 0
            const fitW = measured ? Math.min(innerSize.w, innerSize.h * aspect) : 0
            const fitH = measured ? fitW / aspect : 0
            const stageW = fitW * previewZoom
            const stageH = fitH * previewZoom
            const sized = measured
              ? { width: `${stageW}px`, height: `${stageH}px` }
              : {
                  aspectRatio: `${ratio.w}/${ratio.h}`,
                  maxWidth:  '100%',
                  maxHeight: '100%',
                }
            return (
              <div
                data-preview-stage="true"
                ref={setStageRef}
                onDragOver={handleStageDragOver}
                onDragLeave={handleStageDragLeave}
                onDrop={handleStageDrop}
                className={`relative bg-black rounded shadow-lg shadow-black/50 overflow-hidden flex-shrink-0 ${stickerDragOver ? 'ring-2 ring-[#6d5efc]' : ''}`}
                style={sized}
              >
                <TimelinePreview
                  project={project}
                  playheadTime={playheadTime}
                  isPlaying={isPlaying}
                  setPlayheadTime={setPlayheadTime}
                  setIsPlaying={setIsPlaying}
                  playbackSpeed={playbackSpeed}
                  loopEnabled={loopEnabled}
                  containerH={containerH}
                  videoHeight={videoHeight}
                />
              </div>
            )
          })()
        )}
      </div>

      {/* Playback controls — two rows: time + zoom on top, the rest below */}
      <div className="border-t border-[#2a2a2a] px-3 py-1.5 flex flex-col gap-1.5 shrink-0 relative">
        {/* Row 1: time + preview zoom */}
        <div className="flex items-center">
          <span className="font-mono text-xs tabular-nums">
            <span className="text-[#6d5efc]">{formatTimecode(playheadTime)}</span>
            {project && <span className="text-[#666]"> / {formatTimecode(contentEnd)}</span>}
          </span>
          <div className="flex-1" />
          {/* Preview zoom slider (Ctrl/Cmd+wheel also zooms; % label resets to 100%) */}
          <div className="flex items-center gap-1.5 px-1.5 py-0.5 rounded bg-[#1a1a1a] border border-[#2a2a2a]">
            <button
              onClick={() => setPreviewZoom(1)}
              disabled={previewZoom === 1}
              className={`text-[10px] font-mono w-9 text-center ${previewZoom === 1 ? 'text-[#666]' : 'text-[#6d5efc] hover:text-white'}`}
              title="回 100%"
            >{Math.round(previewZoom * 100)}%</button>
            <input
              type="range"
              value={zoomToSliderPct(previewZoom)}
              min={0} max={100} step={1}
              onChange={e => setPreviewZoom(sliderPctToZoom(+e.target.value))}
              onDoubleClick={() => setPreviewZoom(1)}
              className="w-20 h-1 accent-[#6d5efc] cursor-pointer"
              title="預覽縮放（雙擊回 100%）"
            />
          </div>
        </div>

        {/* Row 2: clip-fit · volume · loop · speed · ratio (wraps when narrow) */}
        <div className="flex flex-wrap items-center justify-end gap-y-1.5">


        {/* Per-clip controls (fit/fill toggle + reset position).
            Reset clears clip.overlay and clip.crop — recovery path when the
            clip has been dragged off-canvas (or any time the user wants to
            return to default aspect-fit). Visible only when the clip has
            been moved or sized away from defaults. */}
        {(() => {
          const track = selectedClip && project?.timeline?.tracks?.find(t => t.id === selectedClip.trackId)
          const clip = track?.type === 'video' ? track.clips[selectedClip.index] : null
          if (!clip) return null
          // Three-way mode for object-fit: fill (stretch, default) → cover
          // (canvas-fill + crop) → contain (letterbox) → fill. Cycle button
          // shows the current mode and the label of what the next click gives.
          const fitMode = clip.objectFit ?? 'fill'
          const FIT_CYCLE = { fill: 'cover', cover: 'contain', contain: 'fill' }
          const FIT_LABEL = { fill: '伸縮', cover: '裁切', contain: '黑邊' }
          const FIT_HINT  = {
            fill:    '素材伸縮貼合變形框（自由變形時無黑邊）',
            cover:   '素材填滿變形框，超出部分裁掉',
            contain: '素材完整顯示，框內留黑邊',
          }
          const ovl = clip.overlay
          const hasOverlay = ovl && (ovl.x != null || ovl.y != null || ovl.width != null || ovl.height != null)
          const hasLegacyCrop = clip.crop && ((clip.crop.scale ?? 1) !== 1 || (clip.crop.x ?? 0) !== 0 || (clip.crop.y ?? 0) !== 0)
          const canReset = hasOverlay || hasLegacyCrop
          // Always show the fit/fill toggle for any video-track clip (image or
          // video), so users can flip cover/contain without first having to
          // drag the clip into a "needs reset" state.
          return (
            <div className="flex items-center gap-1 mr-2">
              <button
                onClick={() => {
                  useProjectStore.getState().pushUndo()
                  updateClip(selectedClip.trackId, selectedClip.index, { objectFit: FIT_CYCLE[fitMode] })
                }}
                className="text-[10px] px-1.5 py-0.5 rounded border border-[#6d5efc] text-[#6d5efc] transition-colors"
                title={`目前：${FIT_HINT[fitMode]}（按下切換為 ${FIT_LABEL[FIT_CYCLE[fitMode]]}）`}
              >
                {FIT_LABEL[fitMode]}
              </button>
              {canReset && (
                <button
                  onClick={() => {
                    useProjectStore.getState().pushUndo()
                    updateClip(selectedClip.trackId, selectedClip.index, { overlay: undefined, crop: undefined })
                  }}
                  className="text-[10px] px-1.5 py-0.5 rounded border border-[#444] text-[#888] hover:border-[#6d5efc] hover:text-[#6d5efc] transition-colors"
                  title="重置位置與大小（回到 canvas 內預設比例）"
                >
                  重置
                </button>
              )}
            </div>
          )
        })()}

        {/* 播放速度 / 循環 / 比例 — 先隱藏（要恢復把下面的 false 改回 true） */}
        {false && (<>
        {/* Loop toggle */}
        <button
          onClick={() => setLoopEnabled(!loopEnabled)}
          className={`w-7 h-7 flex items-center justify-center rounded text-xs transition-colors ${loopEnabled ? 'text-[#6d5efc] bg-[#6d5efc]/10' : 'text-[#555] hover:text-[#aaa]'}`}
          title={loopEnabled ? '關閉循環播放' : '開啟循環播放'}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="17 1 21 5 17 9"/><path d="M3 11V9a4 4 0 0 1 4-4h14"/><polyline points="7 23 3 19 7 15"/><path d="M21 13v2a4 4 0 0 1-4 4H3"/></svg>
        </button>

        {/* Speed picker */}
        <div className="relative">
          <button
            onClick={() => setShowSpeedMenu(!showSpeedMenu)}
            className="h-7 px-1.5 flex items-center text-[#888] hover:text-white bg-[#1a1a1a] hover:bg-[#252525] rounded text-[11px] font-mono"
            title="播放速度"
          >
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="mr-0.5 inline"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
            {playbackSpeed}×
          </button>
          {showSpeedMenu && (
            <>
              <div className="fixed inset-0 z-40" onClick={() => setShowSpeedMenu(false)} />
              <div className="absolute bottom-full right-0 mb-1 bg-[#2a2a2a] border border-[#444] rounded-lg shadow-xl z-50 py-1">
                {SPEEDS.map(s => (
                  <button
                    key={s}
                    onClick={() => { setPlaybackSpeed(s); setShowSpeedMenu(false) }}
                    className={`w-full px-4 py-1.5 text-xs text-left hover:bg-[#3a3a3a] ${s === playbackSpeed ? 'text-[#6d5efc]' : 'text-[#ccc]'}`}
                  >
                    {s}×
                  </button>
                ))}
              </div>
            </>
          )}
        </div>

        {/* Aspect ratio picker */}
        <div className="relative ml-1">
          <button
            onClick={() => setShowRatioMenu(!showRatioMenu)}
            className="h-7 px-2 flex items-center gap-1 text-[#888] hover:text-white bg-[#1a1a1a] hover:bg-[#252525] rounded text-xs font-mono"
            title="比例"
          >
            <RatioIcon w={ratio.w} h={ratio.h} size={14} />
            <span>{currentRatio}</span>
          </button>
          {showRatioMenu && (
            <>
              <div className="fixed inset-0 z-40" onClick={() => setShowRatioMenu(false)} />
              <div className="absolute bottom-full right-0 mb-1 bg-[#2a2a2a] border border-[#444] rounded-lg shadow-xl z-50 py-1 min-w-[140px]">
                {ASPECT_RATIOS.map(r => (
                  <button
                    key={r.id}
                    onClick={() => handleRatioChange(r.id)}
                    className={`w-full flex items-center gap-2.5 px-3 py-1.5 text-xs hover:bg-[#3a3a3a] ${r.id === currentRatio ? 'text-[#6d5efc]' : 'text-[#ccc]'}`}
                  >
                    {r.id === currentRatio && <span className="text-[#6d5efc]">✓</span>}
                    {r.id !== currentRatio && <span className="w-3" />}
                    <RatioIcon w={r.w} h={r.h} size={16} />
                    <span>{r.label}</span>
                  </button>
                ))}
              </div>
            </>
          )}
        </div>
        </>)}
        </div>
      </div>
    </div>
    </>
  )
}

// Small SVG rectangle that visually represents the aspect ratio
function RatioIcon({ w, h, size = 14 }) {
  const max = Math.max(w, h)
  const rw = (w / max) * size * 0.85
  const rh = (h / max) * size * 0.85
  const x = (size - rw) / 2
  const y = (size - rh) / 2
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="shrink-0">
      <rect x={x} y={y} width={rw} height={rh} rx={1} fill="none" stroke="currentColor" strokeWidth={1.2} />
    </svg>
  )
}
