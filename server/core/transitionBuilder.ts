import { VideoSegment, Keyframe } from './types'

/**
 * Build a piecewise interpolation ffmpeg expression for N keyframes.
 * varName is the time variable used in the expression (e.g. 't' for volume, 'T-3.0' for geq).
 * Keyframe times are clip-relative (0 = clip start).
 */
export function buildKFExpr(kfs: Keyframe[], varName = 't'): string {
  if (!kfs || kfs.length === 0) return '1'
  const sorted = [...kfs].sort((a, b) => a.time - b.time)
  if (sorted.length === 1) return sorted[0].value.toFixed(6)

  let expr = sorted[sorted.length - 1].value.toFixed(6)

  for (let i = sorted.length - 2; i >= 0; i--) {
    const t0 = sorted[i].time.toFixed(6)
    const t1 = sorted[i + 1].time.toFixed(6)
    const v0 = sorted[i].value.toFixed(6)
    const v1 = sorted[i + 1].value.toFixed(6)
    const dur = (sorted[i + 1].time - sorted[i].time)
    if (dur <= 0) continue
    const n = `((${varName})-(${t0}))/${dur.toFixed(6)}`

    let easedN: string
    switch (sorted[i].easing) {
      case 'ease-in':
        easedN = `pow(${n},2)`
        break
      case 'ease-out':
        easedN = `1-pow(1-(${n}),2)`
        break
      case 'ease-in-out':
        easedN = `if(lt(${n},0.5),2*pow(${n},2),1-pow(-2*(${n})+2,2)/2)`
        break
      default:
        easedN = n
    }

    const lerp = `(${v0}+(${v1}-${v0})*(${easedN}))`
    expr = `if(lt((${varName}),${t1}),${lerp},${expr})`
  }

  // Clamp: before first keyframe → first value
  expr = `if(lt((${varName}),${sorted[0].time.toFixed(6)}),${sorted[0].value.toFixed(6)},${expr})`
  return expr
}

/**
 * Build an ffmpeg filter chain that applies opacityKF or static opacity to a
 * main-track clip. Main track has no underlying layer, so RGB is multiplied by
 * alpha (visual = fade toward black) rather than baking alpha for compositing.
 *
 * Returns an empty string when no opacity treatment is needed. Variable `t`
 * is clip-relative (caller must have run setpts=PTS-STARTPTS earlier).
 */
function buildMainTrackOpacityChain(seg: VideoSegment): string {
  const opacityKF = seg.opacityKF
  if (opacityKF && opacityKF.length > 0) {
    const a = buildKFExpr(opacityKF, 't')
    const k = `clamp(${a},0,1)`
    return `format=rgba,geq=r='r(X,Y)*${k}':g='g(X,Y)*${k}':b='b(X,Y)*${k}'`
  }
  const staticOpacity = seg.overlay?.opacity
  if (staticOpacity != null && staticOpacity < 1) {
    return `format=rgba,colorchannelmixer=rr=${staticOpacity}:gg=${staticOpacity}:bb=${staticOpacity}`
  }
  return ''
}

/** Build an ffmpeg colour-grade filter string, or empty string for none */
function buildColorFilter(type: string, intensity: number): string {
  const i = Math.min(1, Math.max(0, intensity))
  switch (type) {
    case 'bw':
      return `hue=s=0`
    case 'vintage':
      return `curves=r='0/0 0.5/${0.5 + i * 0.15} 1/1':g='0/0 0.5/${0.5 - i * 0.05} 1/1':b='0/${i * 0.1} 1/${1 - i * 0.1}'`
    case 'cool':
      return `colorbalance=rs=${-i * 0.2}:gs=0:bs=${i * 0.2}`
    case 'warm':
      return `colorbalance=rs=${i * 0.2}:gs=${i * 0.05}:bs=${-i * 0.15}`
    default:
      return ''
  }
}

/** Map our transition type names to ffmpeg xfade transition names */
const XFADE_MAP: Record<string, string> = {
  crossfade: 'fade',
  'fade-black': 'fadeblack',
  wipe: 'wiperight',
  none: 'fade',
}

export interface ScaledClipRef {
  label: string  // e.g. [v0s]
  duration: number
}

/**
 * Build the filter_complex entries for scaling all video clips to target resolution.
 * Returns an array of filter strings and the output labels.
 */
export function buildScaleFilters(
  segments: VideoSegment[],
  width: number,
  height: number,
  fps: number = 30
): { filters: string[]; labels: string[] } {
  const filters: string[] = []
  const labels: string[] = []

  segments.forEach((seg, i) => {
    const inputIdx = i
    const label = `v${i}s`
    // trim input to its actual used portion, scale to target, pad if needed
    const clipDuration = seg.end - seg.start
    const trimStart = seg.trimStart ?? 0
    const trimEnd = seg.trimEnd !== undefined ? seg.trimEnd : trimStart + clipDuration

    // Build colour-grade filter if requested
    const filterType = seg.filter?.type ?? 'none'
    const filterIntensity = seg.filter?.intensity ?? 0.5

    // ── Main-track overlay positioning ───────────────────────────────────────
    // When the user has dragged/resized a primary-track clip in the preview,
    // seg.overlay holds canvas fractions (allowing negative or > 1 values for
    // off-canvas placement). Render path: scale clip to the overlay rect,
    // composite onto a canvas-sized black source so the result still feeds
    // buildMainVideoChain (gap-fill / xfade) at canvas resolution.
    //
    // Limitations under this branch: Ken Burns (scaleAnim) and crop are
    // skipped — the user's drag/resize is the new source of truth. Glow is
    // also skipped (its split+screen blend assumes canvas-sized intermediate);
    // colour grade still applies. Reset button on the preview clears overlay
    // and restores the standard chain.
    const ovl = seg.overlay
    const hasUserOverlay = !!(ovl && (ovl.x != null || ovl.y != null || ovl.width != null || ovl.height != null))
    if (hasUserOverlay) {
      // Warn when overlay positioning silently skips features that require the
      // standard filter chain. Reset the overlay in the preview to restore them.
      const skipped: string[] = []
      if (seg.scaleAnim?.fromScale != null) skipped.push('scaleAnim')
      const c = seg.crop
      if (c && (c.scale > 1 || (c.top ?? 0) + (c.bottom ?? 0) + (c.left ?? 0) + (c.right ?? 0) > 0)) skipped.push('crop')
      if (filterType === 'glow') skipped.push('glow')
      if (skipped.length > 0) {
        console.warn(`[render] overlay on "${seg.source}" silently skips: ${skipped.join(', ')}`)
      }
      if (ovl!.blendMode && ovl!.blendMode !== 'normal') {
        console.warn(`[render] overlay on "${seg.source}" ignores blendMode="${ovl!.blendMode}" (not supported on primary track)`)
      }
      const oxF = ovl!.x ?? 0
      const oyF = ovl!.y ?? 0
      const owF = ovl!.width  ?? 1
      const ohF = ovl!.height ?? 1
      const ox = Math.round(oxF * width)
      const oy = Math.round(oyF * height)
      const ow = Math.max(2, Math.round(owF * width)  & ~1)
      const oh = Math.max(2, Math.round(ohF * height) & ~1)
      const opacity = ovl!.opacity ?? 1

      // Default 'fill' = stretch to fit rect (Premiere transform behavior).
      // 'cover' fills + crops; 'contain' letterboxes inside the rect.
      const fitMode = seg.objectFit ?? 'fill'
      const fitChain =
        fitMode === 'cover'
          ? `scale=${ow}:${oh}:force_original_aspect_ratio=increase,crop=${ow}:${oh}`
          : fitMode === 'contain'
          ? `scale=${ow}:${oh}:force_original_aspect_ratio=decrease,pad=${ow}:${oh}:(ow-iw)/2:(oh-ih)/2:black@0`
          : `scale=${ow}:${oh}`   // fill: stretch


      const grade = buildColorFilter(filterType, filterIntensity)
      const gradeSuffix = (grade && filterType !== 'glow') ? `,${grade}` : ''
      // Opacity: matched to overlay-track behaviour (alpha channel, lets bg show through).
      // KF takes precedence over static opacity. Variable `t` is clip-relative
      // (setpts=PTS-STARTPTS in this chain) so KF times match preview semantics.
      const opacityKF = seg.opacityKF
      let opacityFilter = ''
      if (opacityKF && opacityKF.length > 0) {
        const alphaExpr = buildKFExpr(opacityKF, 't')
        opacityFilter = `,format=rgba,geq=r='r(X,Y)':g='g(X,Y)':b='b(X,Y)':a='255*clamp(${alphaExpr},0,1)'`
      } else if (opacity < 1) {
        opacityFilter = `,format=rgba,colorchannelmixer=aa=${opacity}`
      }

      const preLabel = `${label}_pre`
      const bgLabel  = `${label}_bg`
      // Per-clip speed: compress (or expand) the clip's PTS so the trim
      // window plays at clipSpeed× rate. Source range stays trimStart..
      // trimEnd; output duration = (trimEnd-trimStart)/clipSpeed which
      // matches the timeline `clipDuration` (the EffectsPanel sets end
      // accordingly).
      const speed = seg.speed ?? 1
      const setptsExpr = Math.abs(speed - 1) < 0.001 ? 'PTS-STARTPTS' : `(PTS-STARTPTS)/${speed}`
      filters.push(
        `[${inputIdx}:v]trim=start=${trimStart}:end=${trimEnd},setpts=${setptsExpr},` +
        `${fitChain}${gradeSuffix}${opacityFilter},setsar=1,format=yuva420p[${preLabel}]`
      )
      filters.push(
        `color=black:size=${width}x${height}:rate=${fps}:duration=${clipDuration.toFixed(6)}[${bgLabel}]`
      )
      filters.push(
        `[${bgLabel}][${preLabel}]overlay=x=${ox}:y=${oy}:format=auto:eof_action=pass,format=yuv420p[${label}]`
      )
      labels.push(label)
      return
    }
    const gradeFilter = buildColorFilter(filterType, filterIntensity)

    // Crop + Zoom
    const crop = seg.crop
    const hasZoom = crop && crop.scale > 1
    const hasInset = crop && ((crop.top ?? 0) + (crop.bottom ?? 0) + (crop.left ?? 0) + (crop.right ?? 0)) > 0

    let scaleAndCrop: string
    const sa = seg.scaleAnim
    if (sa?.fromScale != null && sa?.toScale != null) {
      // Ken Burns: animate scale from fromScale → toScale with optional easing
      const fps = 30
      const animDur = sa.duration != null ? Math.min(sa.duration, clipDuration) : clipDuration
      const frames = Math.max(1, Math.round(animDur * fps))
      const from = Math.max(1, sa.fromScale)
      const to = Math.max(1, sa.toScale)
      const diff = to - from
      let zExpr: string
      if (Math.abs(diff) < 0.001) {
        zExpr = from.toFixed(4)
      } else {
        const lo = Math.min(from, to).toFixed(4)
        const hi = Math.max(from, to).toFixed(4)
        const f = from.toFixed(4)
        const d = diff.toFixed(4)
        const n = `on/${frames}`  // normalized time 0→1
        let tExpr: string
        switch (sa.easing) {
          case 'ease-in':
            tExpr = `pow(${n},2)`
            break
          case 'ease-out':
            tExpr = `1-pow(1-${n},2)`
            break
          case 'ease-in-out':
            tExpr = `if(lt(${n},0.5),2*pow(${n},2),1-pow(-2*${n}+2,2)/2)`
            break
          default:  // linear
            tExpr = n
        }
        zExpr = `max(${lo},min(${hi},${f}+${d}*(${tExpr})))`
      }
      scaleAndCrop =
        `scale=${width}:${height}:force_original_aspect_ratio=decrease,` +
        `pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2:black,setsar=1,` +
        `zoompan=z='${zExpr}':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=${frames}:s=${width}x${height}:fps=${fps}`
    } else if (hasZoom || hasInset) {
      let chain = `scale=${width}:${height}:force_original_aspect_ratio=decrease,` +
        `pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2:black`

      // Zoom: scale up then crop center with offset
      if (hasZoom) {
        const s = crop.scale
        const scaledW = Math.round(width * s)
        const scaledH = Math.round(height * s)
        const maxOffsetX = (scaledW - width) / 2
        const maxOffsetY = (scaledH - height) / 2
        const cropX = Math.round(maxOffsetX + ((crop.x ?? 0) / 50) * maxOffsetX)
        const cropY = Math.round(maxOffsetY + ((crop.y ?? 0) / 50) * maxOffsetY)
        chain = `scale=${scaledW}:${scaledH}:force_original_aspect_ratio=decrease,` +
          `pad=${scaledW}:${scaledH}:(ow-iw)/2:(oh-ih)/2:black,` +
          `crop=${width}:${height}:${Math.max(0, cropX)}:${Math.max(0, cropY)}`
      }

      // Inset crop (top/bottom/left/right)
      if (hasInset) {
        const ct = crop.top ?? 0, cb = crop.bottom ?? 0, cl = crop.left ?? 0, cr = crop.right ?? 0
        const cropW = Math.round(width * (100 - cl - cr) / 100)
        const cropH = Math.round(height * (100 - ct - cb) / 100)
        const cropX = Math.round(width * cl / 100)
        const cropY = Math.round(height * ct / 100)
        chain += `,crop=${cropW}:${cropH}:${cropX}:${cropY}`
        chain += `,scale=${width}:${height}:force_original_aspect_ratio=disable`
      }

      scaleAndCrop = chain + `,setsar=1`
    } else {
      // No overlay / no zoom / no inset / no scaleAnim — straight scale to
      // canvas. Default 'fill' stretches to the canvas (Premiere transform
      // default: the rect is the canvas, the asset fills it). 'cover' crops
      // sides; 'contain' letterboxes.
      const fitMode = seg.objectFit ?? 'fill'
      scaleAndCrop =
        fitMode === 'cover'
          ? `scale=${width}:${height}:force_original_aspect_ratio=increase,` +
            `crop=${width}:${height}:(iw-${width})/2:(ih-${height})/2,` +
            `setsar=1`
          : fitMode === 'contain'
          ? `scale=${width}:${height}:force_original_aspect_ratio=decrease,` +
            `pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2:black,` +
            `setsar=1`
          : `scale=${width}:${height},setsar=1`   // fill: stretch
    }

    const opacityChain = buildMainTrackOpacityChain(seg)

    // Per-clip speed warps the trim's PTS so the clip plays at clipSpeed×.
    // Applied here so all main-track render branches (glow / standard /
    // overlay above) share the same speed math.
    const segSpeed = seg.speed ?? 1
    const setptsExpr = Math.abs(segSpeed - 1) < 0.001
      ? 'PTS-STARTPTS'
      : `(PTS-STARTPTS)/${segSpeed}`

    if (filterType === 'glow') {
      // Glow/Bloom: split → blur+boost → screen blend back onto original
      const intensity = Math.min(1, Math.max(0, filterIntensity))
      const sigma = Math.round(5 + intensity * 20)
      const boost = (1 + intensity).toFixed(2)
      const preLabel = `${label}_pre`
      filters.push(
        `[${inputIdx}:v]` +
        `trim=start=${trimStart}:end=${trimEnd},` +
        `setpts=${setptsExpr},` +
        scaleAndCrop +
        `,format=yuv420p` +
        `[${preLabel}]`
      )
      filters.push(`[${preLabel}]split[${label}_o][${label}_c]`)
      filters.push(
        `[${label}_c]gblur=sigma=${sigma},` +
        `colorchannelmixer=rr=${boost}:gg=${boost}:bb=${boost}` +
        `[${label}_b]`
      )
      if (opacityChain) {
        // Apply opacity *after* the glow screen-blend so the bloom itself fades.
        filters.push(`[${label}_o][${label}_b]blend=all_mode=screen[${label}_glow]`)
        filters.push(`[${label}_glow]${opacityChain},format=yuv420p[${label}]`)
      } else {
        filters.push(`[${label}_o][${label}_b]blend=all_mode=screen[${label}]`)
      }
    } else {
      filters.push(
        `[${inputIdx}:v]` +
        `trim=start=${trimStart}:end=${trimEnd},` +
        `setpts=${setptsExpr},` +
        scaleAndCrop +
        (gradeFilter ? `,${gradeFilter}` : '') +
        (opacityChain ? `,${opacityChain}` : '') +
        `,format=yuv420p` +
        `[${label}]`
      )
    }
    labels.push(label)
  })

  return { filters, labels }
}

/**
 * Build the main-track concat/xfade chain with gap fillers.
 *
 * Absolute positioning: each clip sits at its seg.start, gaps between clips
 * (and a tail up to totalTimelineDuration) are filled with black color sources
 * so overlays, audio, and text beyond the last main clip still render.
 *
 * Transitions only apply between two consecutive *real* clips — a gap on
 * either side forces a plain concat, which is the right call because xfade
 * across a silent black span makes no visual sense.
 *
 * gapMode === 'freeze' clones each clip's last frame forward across the
 * post-gap (via `tpad=stop_mode=clone`) instead of inserting black. Leading
 * gap (before the first clip) still uses black because there is no previous
 * content to hold.
 */
export function buildMainVideoChain(
  segments: VideoSegment[],
  scaledLabels: string[],
  width: number,
  height: number,
  totalTimelineDuration: number,
  gapMode: 'black' | 'freeze' = 'black'
): { filters: string[]; finalLabel: string } {
  const filters: string[] = []

  type ChainItem = { kind: 'clip' | 'gap', label: string, duration: number, seg?: VideoSegment }
  const items: ChainItem[] = []
  let cursor = 0
  let gapCount = 0

  const pushBlackGap = (dur: number) => {
    const label = `vgap${gapCount++}`
    filters.push(
      `color=c=black:s=${width}x${height}:d=${dur.toFixed(3)}:r=30,format=yuv420p,setsar=1[${label}]`
    )
    items.push({ kind: 'gap', label, duration: dur })
  }

  segments.forEach((seg, i) => {
    const preGap = seg.start - cursor
    if (preGap > 0.001 && (gapMode === 'black' || i === 0)) {
      // Leading gap is always black (no prior frame to clone).
      // Internal black-mode gaps get their own color source.
      // Internal freeze-mode gaps are absorbed into the previous clip's tpad.
      pushBlackGap(preGap)
    }

    let clipLabel = scaledLabels[i]
    let clipDuration = seg.end - seg.start
    let advance = seg.end

    if (gapMode === 'freeze') {
      const nextStart = i + 1 < segments.length ? segments[i + 1].start : totalTimelineDuration
      const postGap = Math.max(0, nextStart - seg.end)
      if (postGap > 0.001) {
        const padded = `vpad${i}`
        filters.push(`[${clipLabel}]tpad=stop_mode=clone:stop_duration=${postGap.toFixed(3)}[${padded}]`)
        clipLabel = padded
        clipDuration += postGap
        advance = seg.end + postGap
      }
    }

    items.push({ kind: 'clip', label: clipLabel, duration: clipDuration, seg })
    cursor = Math.max(cursor, advance)
  })

  if (totalTimelineDuration > cursor + 0.001) {
    // Only reachable in 'black' mode (freeze already extended the last clip).
    pushBlackGap(totalTimelineDuration - cursor)
  }

  if (items.length === 0) return { filters, finalLabel: '' }
  if (items.length === 1) return { filters, finalLabel: items[0].label }

  let currentLabel = items[0].label
  let cumulative = items[0].duration
  for (let i = 1; i < items.length; i++) {
    const prev = items[i - 1]
    const curr = items[i]
    const outLabel = `tc${i}`

    let transDur = 0
    let xfadeType = 'fade'
    if (prev.kind === 'clip' && curr.kind === 'clip' && prev.seg?.transition && prev.seg.transition.type !== 'none') {
      const td = prev.seg.transition.duration ?? 0
      if (td > 0) {
        transDur = td
        xfadeType = XFADE_MAP[prev.seg.transition.type] ?? 'fade'
      }
    }

    if (transDur > 0) {
      const offset = Math.max(0, cumulative - transDur)
      filters.push(
        `[${currentLabel}][${curr.label}]xfade=transition=${xfadeType}:duration=${transDur}:offset=${offset.toFixed(3)}[${outLabel}]`
      )
    } else {
      filters.push(
        `[${currentLabel}][${curr.label}]concat=n=2:v=1:a=0[${outLabel}]`
      )
    }

    currentLabel = outLabel
    cumulative += curr.duration - transDur
  }

  return { filters, finalLabel: currentLabel }
}
