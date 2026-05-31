import * as path from 'path'
import {
  Project, TextSegment, VideoSegment, AudioSegment, RenderQuality, resolveResolution,
  isVideoSegment, isTextSegment, isAudioSegment,
} from './types'
import { buildScaleFilters, buildMainVideoChain, buildKFExpr } from './transitionBuilder'
import { renderColorFillClip } from './colorFillRenderer'
import { buildAssFile, resolveFontsDir } from './assRenderer'
import { getMediaInfo } from '../utils/ffprobe'

// A clip that needs to be emitted into the audio graph, paired with the
// ffmpeg input index its source is located at.
import type { Keyframe } from './types'

interface AudioClipRef {
  inputIdx: number
  trimStart: number
  trimEnd: number
  timelineStart: number
  speed: number    // 1 = normal; renders via atempo (pitch-preserving)
  volume: number
  fadeIn: number   // seconds, 0 = none
  fadeOut: number  // seconds, 0 = none
  volumeKF?: Keyframe[]
}

/** Build atempo filter chain. atempo's per-instance range is [0.5, 100],
 * so values below 0.5 are achieved by chaining: 0.25 = 0.5,0.5. Returns
 * an empty array when speed === 1 so the chain stays untouched.
 * Throws on non-positive speed — without the guard, `s = s / 0.5` against 0
 * stays at 0 forever and the while-loop hangs the render thread. ffmpeg
 * itself would reject atempo<=0 anyway, so failing fast here is harmless. */
function buildAtempoChain(speed: number): string[] {
  if (!Number.isFinite(speed) || speed <= 0) {
    throw new Error(`buildAtempoChain: speed must be > 0 and finite, got ${speed}`)
  }
  if (Math.abs(speed - 1) < 0.001) return []
  const out: string[] = []
  let s = speed
  while (s < 0.5) {
    out.push('atempo=0.5')
    s = s / 0.5
  }
  while (s > 100) {
    out.push('atempo=100')
    s = s / 100
  }
  out.push(`atempo=${s.toFixed(4)}`)
  return out
}

export interface FfmpegPlan {
  inputFiles: string[]          // ordered list of input files to pass to ffmpeg
  filterComplex: string         // full -filter_complex string
  videoOutputLabel: string      // label to -map for video
  audioOutputLabel: string | null // label to -map for audio (null → map raw stream)
  audioInputIndex: number | null  // index of audio input file
  hasAudio: boolean
}

/**
 * Collect all text segments from all text tracks into a flat array.
 */
export function collectTextSegments(project: Project): TextSegment[] {
  return project.timeline.tracks
    .filter(t => t.type === 'text' && !t.hidden)
    .sort((a, b) => a.order - b.order)
    .flatMap(t => t.clips.filter(isTextSegment))
}

/**
 * Resolve a source path relative to the project assets directory.
 */
export function resolveSource(source: string, assetDir: string): string {
  if (path.isAbsolute(source)) return source
  return path.join(assetDir, source)
}

/**
 * Build the complete ffmpeg plan for a project.
 */
export async function buildFfmpegPlan(
  project: Project,
  assetDir: string,
  outputPath: string,
  quality: RenderQuality,
  tmpDir: string,
  audioOnly: boolean = false,
  fps: number = 30,
  applyWatermark: boolean = false,
): Promise<FfmpegPlan> {
  const [width, height] = resolveResolution(project.aspectRatio, quality)

  // Gather tracks by type, sorted by order.
  // Hidden video tracks are dropped entirely (video + audio).
  // Muted video tracks keep their video but skip their audio.
  // Hidden OR muted audio tracks are dropped entirely.
  const videoTracks = project.timeline.tracks
    .filter(t => t.type === 'video' && !t.hidden)
    .sort((a, b) => a.order - b.order)
  const audioTracks = project.timeline.tracks
    .filter(t => t.type === 'audio' && !t.hidden && !t.muted)
    .sort((a, b) => a.order - b.order)

  // Pick the first video track that actually has clips as "main"; empty video
  // tracks (user placeholders) are skipped entirely so they don't abort the
  // render. Every other non-empty video track becomes an overlay, preserving
  // z-order from the original track list.
  const mainTrackIdx = videoTracks.findIndex(t => (t.clips ?? []).length > 0)
  const mainVideoTrack = mainTrackIdx >= 0 ? videoTracks[mainTrackIdx] : null
  const overlayVideoTracks = videoTracks.filter((t, i) => i !== mainTrackIdx && (t.clips ?? []).length > 0)

  // Clone + sort main-track clips by timeline position so gap-filling and
  // xfade offsets work correctly when the user has reordered or dragged clips.
  const videoSegments: VideoSegment[] = (mainVideoTrack?.clips ?? [])
    .filter(isVideoSegment)
    .slice()
    .sort((a, b) => a.start - b.start)
  const textSegments = audioOnly ? [] : collectTextSegments(project)

  if (!audioOnly && videoSegments.length === 0) {
    throw new Error('沒有可渲染的視訊片段（所有視訊軌皆為空或被隱藏）')
  }

  // Compute total timeline duration across every track's clips.
  // Main video track must be padded up to this length or -shortest will truncate
  // the output (audio / overlays / text are all absolutely positioned).
  let totalTimelineDuration = 0
  for (const tr of project.timeline.tracks) {
    for (const c of (tr.clips ?? [])) {
      const end = c.end ?? 0
      if (end > totalTimelineDuration) totalTimelineDuration = end
    }
  }
  totalTimelineDuration = Math.max(totalTimelineDuration, project.duration ?? 0)

  const inputFiles: string[] = []
  const filterParts: string[] = []

  // === Pre-render synthetic clips (color fills) to temp .mov ===
  // Color-fill clips have no real source on disk; we materialize them so they
  // slot into the rest of the input/overlay pipeline like any normal video clip.
  const overlayTracks: VideoSegment[][] = overlayVideoTracks.map(t => t.clips.filter(isVideoSegment))
  const syntheticPathMap = new Map<VideoSegment, string>()
  let colorFillIdx = 0
  // Walk both main and overlay tracks (color fills can land on either).
  const allVideoSegs: VideoSegment[] = [...videoSegments, ...overlayTracks.flat()]
  for (const seg of allVideoSegs) {
    if (seg.colorFill) {
      const p = path.join(tmpDir, `colorfill_${colorFillIdx++}.mov`)
      await renderColorFillClip(seg.colorFill, seg.end - seg.start, 30, width, height, p)
      syntheticPathMap.set(seg, p)
    }
  }

  // Record inputIdx for every video clip so the audio graph can reference
  // each clip's embedded audio via [idx:a].
  const mainVideoInputIdx: number[] = []
  videoSegments.forEach(seg => {
    mainVideoInputIdx.push(inputFiles.length)
    inputFiles.push(syntheticPathMap.get(seg) ?? resolveSource(seg.source, assetDir))
  })

  // === Overlay track inputs (every non-empty video track except main) ===
  const overlayInputStartIndex = inputFiles.length
  const overlayInputIdxByTrack: number[][] = []
  for (const trackSegs of overlayTracks) {
    const perTrack: number[] = []
    for (const seg of trackSegs) {
      perTrack.push(inputFiles.length)
      inputFiles.push(syntheticPathMap.get(seg) ?? resolveSource(seg.source, assetDir))
    }
    overlayInputIdxByTrack.push(perTrack)
  }

  // === Audio clip inputs (each audio clip gets its own input, no dedup) ===
  // Parallel array: audioTrackInputIdx[ti][ci] = ffmpeg input index
  const audioTrackInputIdx: number[][] = []
  for (const t of audioTracks) {
    const perTrack: number[] = []
    for (const c of (t.clips ?? []).filter(isAudioSegment)) {
      perTrack.push(inputFiles.length)
      inputFiles.push(resolveSource(c.source, assetDir))
    }
    audioTrackInputIdx.push(perTrack)
  }

  // Pre-probe unique video sources for hasAudio. Audio sources are
  // presumed to have audio; failing to decode will surface as a render error.
  const videoHasAudio = new Map<string, boolean>()
  const uniqueVideoPaths = new Set<string>()
  for (const seg of videoSegments) uniqueVideoPaths.add(resolveSource(seg.source, assetDir))
  for (const trackSegs of overlayTracks) {
    for (const seg of trackSegs) uniqueVideoPaths.add(resolveSource(seg.source, assetDir))
  }
  await Promise.all(
    Array.from(uniqueVideoPaths).map(async (p) => {
      try {
        const info = await getMediaInfo(p)
        videoHasAudio.set(p, !!info.hasAudio)
      } catch {
        videoHasAudio.set(p, false)
      }
    })
  )

  // === Scale filters (track 1) ===
  // In audio-only mode we skip the entire video graph but still need the clip
  // inputs available so their [idx:a] streams can feed the audio graph.
  let videoFinalLabel = ''
  if (!audioOnly) {
    const { filters: scaleFilters, labels: scaledLabels } = buildScaleFilters(
      videoSegments, width, height, fps
    )
    filterParts.push(...scaleFilters)

    // Build main-track chain (handles gap filling + xfade transitions).
    // See transitionBuilder.buildMainVideoChain for the gap/freeze logic.
    const gapMode = mainVideoTrack?.gapMode ?? 'black'
    const { filters: chainFilters, finalLabel: videoBaseLabel } = buildMainVideoChain(
      videoSegments, scaledLabels, width, height, totalTimelineDuration, gapMode
    )
    filterParts.push(...chainFilters)

    // === Overlay tracks (video_2, video_3) applied BEFORE text so text stays on top ===
    videoFinalLabel = videoBaseLabel
    let overlayInputIdx = overlayInputStartIndex

    for (let ti = 0; ti < overlayTracks.length; ti++) {
      const trackSegs = overlayTracks[ti]
      for (let ci = 0; ci < trackSegs.length; ci++) {
        const seg = trackSegs[ci]
        const clipDuration = seg.end - seg.start
        const trimStart = seg.trimStart ?? 0
        const trimEnd = seg.trimEnd !== undefined ? seg.trimEnd : trimStart + clipDuration

        // overlay.{x,y,width,height} are fractions in [0,1] of the canvas — preview
        // and render multiply by their respective dimensions so values are
        // resolution-independent. Default undefined = full canvas.
        const oxF = seg.overlay?.x      ?? 0
        const oyF = seg.overlay?.y      ?? 0
        const owF = seg.overlay?.width  ?? 1
        const ohF = seg.overlay?.height ?? 1
        const ox = Math.round(oxF * width)
        const oy = Math.round(oyF * height)
        // ffmpeg encoders need even dimensions; floor to nearest even.
        const ow = Math.max(2, Math.round(owF * width)  & ~1)
        const oh = Math.max(2, Math.round(ohF * height) & ~1)
        const opacity = seg.overlay?.opacity ?? 1

        const scaledLabel = `ovl_t${ti}_c${ci}`
        const resultLabel = `ovl_out_t${ti}_c${ci}`

        // Trim clip, offset PTS to its timeline position, scale to overlay size
        const opacityKF = seg.opacityKF
        let opacityFilter = ''
        if (opacityKF && opacityKF.length > 0) {
          // T is absolute timeline time after setpts; subtract seg.start for clip-relative KF times
          const kfVar = `T-${seg.start.toFixed(6)}`
          const alphaExpr = buildKFExpr(opacityKF, kfVar)
          opacityFilter = `,format=rgba,geq=r='r(X,Y)':g='g(X,Y)':b='b(X,Y)':a='255*clamp(${alphaExpr},0,1)'`
        } else if (opacity < 1) {
          opacityFilter = `,format=rgba,colorchannelmixer=aa=${opacity}`
        }
        // 'contain' default — preserve the asset's aspect, never crop. With
        // canvas-aspect-locked resize on the preview side, the container should
        // already match the image so no letterbox is visible.
        const fit = (seg.objectFit ?? 'contain')
        const fitFilters = fit === 'cover'
          ? `scale=${ow}:${oh}:force_original_aspect_ratio=increase,` +
            `crop=${ow}:${oh},`
          : `scale=${ow}:${oh}:force_original_aspect_ratio=decrease,` +
            `pad=${ow}:${oh}:(ow-iw)/2:(oh-ih)/2:black@0,`
        // Per-clip speed: compress the trimmed range to (trimEnd-trimStart)/
        // speed seconds, then offset to seg.start on the output timeline.
        // Source range pinned, only the playback rate scales.
        const segSpeed = seg.speed ?? 1
        const speedDiv = Math.abs(segSpeed - 1) < 0.001 ? '(PTS-STARTPTS)' : `(PTS-STARTPTS)/${segSpeed}`
        filterParts.push(
          `[${overlayInputIdx}:v]` +
          `trim=start=${trimStart}:end=${trimEnd},` +
          `setpts=${speedDiv}+${seg.start}/TB,` +
          fitFilters +
          `setsar=1` +
          opacityFilter +
          `[${scaledLabel}]`
        )

        const blendMode = seg.overlay?.blendMode
        const isFullFrame = ox === 0 && oy === 0 && ow === width && oh === height
        // Animated x/y: overlay's `t` variable is timeline-absolute seconds, so
        // subtract seg.start to match the clip-relative time used in opacity
        // (mirrors `T-${seg.start}` pattern above). Keyframe values are canvas
        // fractions, multiplied to pixels in the same way the static fallback
        // is rounded above. Falsy/empty arrays → static value path.
        const xKF = seg.overlay?.xKF
        const yKF = seg.overlay?.yKF
        const hasXkf = !!(xKF && xKF.length > 0)
        const hasYkf = !!(yKF && yKF.length > 0)
        const kfVarOverlay = `t-${seg.start.toFixed(6)}`
        const xArg = hasXkf
          ? `'(${buildKFExpr(xKF!, kfVarOverlay)})*${width}'`
          : `${ox}`
        const yArg = hasYkf
          ? `'(${buildKFExpr(yKF!, kfVarOverlay)})*${height}'`
          : `${oy}`
        if (blendMode && blendMode !== 'normal' && isFullFrame && !hasXkf && !hasYkf) {
          filterParts.push(
            `[${videoFinalLabel}][${scaledLabel}]blend=all_mode=${blendMode}[${resultLabel}]`
          )
        } else {
          // Use format=auto so alpha channel from geq clips is respected
          filterParts.push(
            `[${videoFinalLabel}][${scaledLabel}]overlay=x=${xArg}:y=${yArg}:eof_action=pass:format=auto[${resultLabel}]`
          )
        }
        videoFinalLabel = resultLabel
        overlayInputIdx++
      }
    }

    // === Text overlay via libass (single pass, matches preview fidelity) ===
    // All text segments are baked into one ASS file and burned in via the
    // subtitles filter. libass supports fontFamily, fontWeight, proper center
    // alignment, blurred shadow, outline, and fade/slide animations — things
    // ffmpeg drawtext cannot reproduce.
    if (textSegments.length > 0) {
      // Use canonical 1080-base resolution as PlayResX/Y so font/shadow values
      // are interpreted consistently across qualities (high/2k/4k). libass
      // automatically scales to actual output via ScaledBorderAndShadow.
      const [canonW, canonH] = resolveResolution(project.aspectRatio, 'high')
      const assPath = buildAssFile(textSegments, canonW, canonH, tmpDir)
      // Escape Windows drive colon for the filter_complex parser: D:/… → D\:/…
      const escapeFilterPath = (p: string) => p.replace(/\\/g, '/').replace(/^([A-Za-z]):/, '$1\\:')
      const parts: string[] = [`filename='${escapeFilterPath(assPath)}'`]
      const fontsDir = resolveFontsDir()
      // Point libass at bundled fonts so Noto Sans TC resolves consistently
      // across machines (system fontconfig can be missing the exact face).
      if (fontsDir) parts.push(`fontsdir='${escapeFilterPath(fontsDir)}'`)
      filterParts.push(`[${videoFinalLabel}]subtitles=${parts.join(':')}[vfinal]`)
      videoFinalLabel = 'vfinal'
    }

    // === Free-tier watermark overlay (last video step) ===
    // Sits on top of everything (subtitles, overlay tracks) so users can't
    // mask it with a covering clip. Pre-computed pixel sizes — `scale` filter
    // doesn't see W/H, those are only defined inside `overlay`.
    if (applyWatermark) {
      const wmW    = Math.round(width  * 0.12)        // ~12% of frame width
      const padPx  = Math.round(height * 0.025)       // ~2.5% of frame height padding
      const wmPath = path.resolve(__dirname, '..', 'assets', 'watermark', '13soul-watermark.png')
      // Escape Windows drive colon the same way the subtitles block does.
      const escapeFilterPath = (p: string) => p.replace(/\\/g, '/').replace(/^([A-Za-z]):/, '$1\\:')
      filterParts.push(`movie='${escapeFilterPath(wmPath)}'[wm0]`)
      filterParts.push(`[wm0]scale=${wmW}:-1,format=rgba[wmark]`)
      filterParts.push(`[${videoFinalLabel}][wmark]overlay=x=main_w-overlay_w-${padPx}:y=main_h-overlay_h-${padPx}[vwm]`)
      videoFinalLabel = 'vwm'
    }
  }

  // === Audio graph ===
  // Every clip with audio (unmuted, non-hidden) becomes an entry in
  // audioRefs, mixed with amix. Preview (audioEngine.js) follows the same
  // envelope shape so preview and render stay consistent.
  const audioRefs: AudioClipRef[] = []

  const pushVideoClipAudio = (seg: VideoSegment, inputIdx: number, trackMuted: boolean) => {
    if (trackMuted || seg.muted) return
    const absPath = resolveSource(seg.source, assetDir)
    if (!videoHasAudio.get(absPath)) return
    const clipDur = seg.end - seg.start
    if (clipDur <= 0) return
    const trimStart = seg.trimStart ?? 0
    const speed = seg.speed ?? 1
    // With speed≠1, the source range that gets played is timeline duration
    // × speed (matches engineClipDescriptors on the preview side). Honor
    // an explicit trimEnd if set, otherwise derive.
    const trimEnd = seg.trimEnd !== undefined ? seg.trimEnd : trimStart + clipDur * speed
    audioRefs.push({
      inputIdx,
      trimStart,
      trimEnd,
      timelineStart: seg.start,
      speed,
      volume: seg.volume ?? 1,
      fadeIn: Math.max(0, seg.fadeIn?.duration ?? 0),
      fadeOut: Math.max(0, seg.fadeOut?.duration ?? 0),
    })
  }

  const mainTrackMuted = !!mainVideoTrack?.muted
  videoSegments.forEach((seg, i) => pushVideoClipAudio(seg, mainVideoInputIdx[i], mainTrackMuted))

  overlayTracks.forEach((trackSegs, ti) => {
    const trackMuted = !!overlayVideoTracks[ti]?.muted
    trackSegs.forEach((seg, ci) => {
      pushVideoClipAudio(seg, overlayInputIdxByTrack[ti][ci], trackMuted)
    })
  })

  audioTracks.forEach((t, ti) => {
    const clips = (t.clips ?? []).filter(isAudioSegment)
    clips.forEach((c, ci) => {
      if (c.muted) return
      const clipDur = c.end - c.start
      if (clipDur <= 0) return
      const trimStart = c.trimStart ?? 0
      const speed = c.speed ?? 1
      const trimEnd = c.trimEnd !== undefined ? c.trimEnd : trimStart + clipDur * speed
      audioRefs.push({
        inputIdx: audioTrackInputIdx[ti][ci],
        trimStart,
        trimEnd,
        timelineStart: c.start,
        speed,
        volume: c.volume ?? 1,
        fadeIn: Math.max(0, c.fadeIn?.duration ?? 0),
        fadeOut: Math.max(0, c.fadeOut?.duration ?? 0),
        volumeKF: c.volumeKF,
      })
    })
  })

  let audioOutputLabel: string | null = null
  if (audioRefs.length > 0) {
    const clipLabels: string[] = []
    audioRefs.forEach((ref, i) => {
      // sourceRange = how much of the source we're going to play
      // (atrim window). After atempo, output duration = sourceRange / speed,
      // which matches the timeline duration the user sees. Fades are
      // expressed in TIMELINE seconds (post-atempo), not source seconds.
      const sourceRange = Math.max(0, ref.trimEnd - ref.trimStart)
      if (sourceRange <= 0) return
      const clipDur = sourceRange / ref.speed   // post-atempo output duration
      const maxFade = clipDur / 2
      const fIn = Math.min(ref.fadeIn, maxFade)
      const fOut = Math.min(ref.fadeOut, maxFade)

      const chain: string[] = []
      chain.push(`atrim=start=${ref.trimStart}:end=${ref.trimEnd}`)
      chain.push('asetpts=PTS-STARTPTS')
      // atempo: applied AFTER atrim so the source range is right; applied
      // BEFORE volume/fade so the fade durations are timeline-aligned.
      chain.push(...buildAtempoChain(ref.speed))
      if (ref.volumeKF && ref.volumeKF.length > 0) {
        const volExpr = buildKFExpr(ref.volumeKF, 't')
        chain.push(`volume=volume='${volExpr}':eval=frame`)
      } else if (ref.volume !== 1) {
        chain.push(`volume=${ref.volume}`)
      }
      if (fIn > 0) chain.push(`afade=t=in:st=0:d=${fIn}`)
      if (fOut > 0) chain.push(`afade=t=out:st=${clipDur - fOut}:d=${fOut}`)
      if (ref.timelineStart > 0) {
        const delayMs = Math.round(ref.timelineStart * 1000)
        chain.push(`adelay=${delayMs}:all=1`)
      }

      const label = `aclip${i}`
      filterParts.push(`[${ref.inputIdx}:a]${chain.join(',')}[${label}]`)
      clipLabels.push(`[${label}]`)
    })

    if (clipLabels.length === 1) {
      audioOutputLabel = clipLabels[0].slice(1, -1)
    } else if (clipLabels.length > 1) {
      const mixLabel = 'afinal'
      filterParts.push(
        `${clipLabels.join('')}amix=inputs=${clipLabels.length}:normalize=0:dropout_transition=0[${mixLabel}]`
      )
      audioOutputLabel = mixLabel
    }
  }

  if (audioOnly && audioOutputLabel === null) {
    throw new Error('專案沒有任何音源（所有音訊軌都靜音或為空），無法匯出 WAV')
  }

  return {
    inputFiles,
    filterComplex: filterParts.join(';\n'),
    videoOutputLabel: videoFinalLabel,
    audioOutputLabel,
    audioInputIndex: null,
    hasAudio: audioOutputLabel !== null,
  }
}
