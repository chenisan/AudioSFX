import { useRef, useState, useEffect, memo } from 'react'

import { useProjectStore, ASPECT_RATIOS } from '../../stores/projectStore'
import { useClipDrag } from '../../hooks/useDragDrop'
import { timeToPx } from '../../utils/timeFormat'
import SegmentSfxModal from '../audio/SegmentSfxModal'

const TRACK_TYPE_COLORS = {
  video:  '#3b82f6',
  audio:  '#22c55e',
  text:   '#a855f7',
  script: '#f97316',
}

const CLIP_HEIGHT = 44

const IMAGE_EXTS = /\.(jpe?g|png|apng|gif|webp)$/i
const ANIMATED_IMAGE_EXTS = /\.(apng|gif|webp)$/i

// Render the first frame of an animated image (.apng / .gif / animated webp)
// as a static canvas. Browsers always loop these formats in <img>, but
// drawImage on canvas captures whatever frame is currently displayed —
// calling it inside img.onload reliably grabs frame 0. Used for timeline
// clip thumbnails where animation distracts from scrubbing.
function FirstFrameCanvas({ src, className, style }) {
  const canvasRef = useRef(null)
  useEffect(() => {
    const img = new Image()
    img.crossOrigin = 'anonymous'
    img.onload = () => {
      const canvas = canvasRef.current
      if (!canvas) return
      canvas.width = img.naturalWidth
      canvas.height = img.naturalHeight
      const ctx = canvas.getContext('2d')
      ctx.drawImage(img, 0, 0)
    }
    img.src = src
  }, [src])
  return <canvas ref={canvasRef} className={className} style={style} />
}

// Module-level caches shared across clip instances, keyed by `${projectId}/${source}`.
const waveformCache = new Map()
const waveformInflight = new Map()
const thumbstripCache = new Map()
const thumbstripInflight = new Map()

function fetchWaveform(projectId, source) {
  const key = `${projectId}/${source}`
  if (waveformCache.has(key)) return Promise.resolve(waveformCache.get(key))
  if (waveformInflight.has(key)) return waveformInflight.get(key)
  const p = fetch(`/api/projects/${projectId}/assets/waveform-data/${encodeURIComponent(source)}`)
    .then(r => r.ok ? r.json() : Promise.reject(new Error('waveform fetch failed')))
    .then(data => {
      waveformCache.set(key, data)
      waveformInflight.delete(key)
      return data
    })
    .catch(err => {
      waveformInflight.delete(key)
      throw err
    })
  waveformInflight.set(key, p)
  return p
}

function fetchThumbstrip(projectId, source) {
  const key = `${projectId}/${source}`
  if (thumbstripCache.has(key)) return Promise.resolve(thumbstripCache.get(key))
  if (thumbstripInflight.has(key)) return thumbstripInflight.get(key)
  const p = fetch(`/api/projects/${projectId}/assets/thumbstrip/${encodeURIComponent(source)}`)
    .then(r => r.ok ? r.json() : Promise.reject(new Error('thumbstrip fetch failed')))
    .then(data => {
      thumbstripCache.set(key, data)
      thumbstripInflight.delete(key)
      return data
    })
    .catch(err => {
      thumbstripInflight.delete(key)
      throw err
    })
  thumbstripInflight.set(key, p)
  return p
}

/** Video thumbnail strip backed by the Rust-generated cache. */
const ClipThumbStrip = memo(function ClipThumbStrip({ clip, width, projectId }) {
  const [manifest, setManifest] = useState(null)

  useEffect(() => {
    if (!projectId || !clip.source || width < 20) return
    let cancelled = false
    fetchThumbstrip(projectId, clip.source)
      .then(data => { if (!cancelled) setManifest(data) })
      .catch(() => {})
    return () => { cancelled = true }
  }, [clip.source, projectId])

  if (!manifest || !manifest.count || !manifest.durationSec) return null

  const { count, files, durationSec, width: thumbW, height: thumbH } = manifest
  const trimStart = clip.trimStart ?? 0
  const clipDur = Math.max(0.001, clip.end - clip.start)

  // One thumbnail per ~source aspect slot on the clip. Keep thumbnails at native
  // pixel size — density adapts with clip width.
  const slotW = Math.max(24, thumbW ? thumbW * 0.75 : 60)
  const slotCount = Math.max(1, Math.round(width / slotW))
  const actualSlotW = width / slotCount

  const slots = []
  for (let i = 0; i < slotCount; i++) {
    const f = (i + 0.5) / slotCount
    const sourceT = trimStart + f * clipDur
    const thumbIdx = Math.max(0, Math.min(count - 1, Math.floor((sourceT / durationSec) * count)))
    slots.push({ idx: thumbIdx, file: files[thumbIdx] })
  }

  return (
    <div className="absolute inset-0 flex overflow-hidden rounded pointer-events-none" style={{ opacity: 0.75 }}>
      {slots.map((s, i) => (
        <img
          key={i}
          src={`/api/projects/${projectId}/assets/thumbstrip/${encodeURIComponent(clip.source)}/${s.file}`}
          alt=""
          className="h-full object-cover shrink-0"
          style={{ width: actualSlotW }}
          draggable={false}
        />
      ))}
    </div>
  )
})

/** Canvas-based waveform for audio clips. align: 'center' (default) or 'bottom'. */
const ClipWaveform = memo(function ClipWaveform({ clip, width, height, projectId, align = 'center' }) {
  const canvasRef = useRef(null)
  const [wave, setWave] = useState(null)

  useEffect(() => {
    if (!projectId || !clip.source || width < 20) return
    let cancelled = false
    fetchWaveform(projectId, clip.source)
      .then(data => { if (!cancelled) setWave(data) })
      .catch(() => {})
    return () => { cancelled = true }
  }, [clip.source, projectId])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas || !wave || width < 2 || height < 2) return
    const { peaksMin, peaksMax, duration, bucketCount } = wave
    if (!peaksMin || !peaksMax || !bucketCount || !duration) return

    const dpr = Math.min(window.devicePixelRatio || 1, 2)
    canvas.width = Math.round(width * dpr)
    canvas.height = Math.round(height * dpr)
    canvas.style.width = `${width}px`
    canvas.style.height = `${height}px`
    const ctx = canvas.getContext('2d')
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.clearRect(0, 0, width, height)

    // The clip only shows a portion of the full audio file
    const trimStart = clip.trimStart ?? 0
    const clipDur = Math.max(0.001, clip.end - clip.start)
    const startIdx = Math.max(0, Math.floor((trimStart / duration) * bucketCount))
    const endIdx = Math.min(bucketCount, Math.ceil(((trimStart + clipDur) / duration) * bucketCount))
    const range = Math.max(1, endIdx - startIdx)

    // One bar per ~2 CSS pixels (zoom-aware: wider clip → more bars)
    const barSpacing = 2
    const barCount = Math.max(1, Math.floor(width / barSpacing))
    const barW = Math.max(1, width / barCount - 0.5)
    const halfH = height / 2 - 1
    const centerY = height / 2

    // On audio tracks the clip bg is already green; use a dark contrast color instead
    ctx.fillStyle = align === 'bottom' ? 'rgba(34,197,94,0.85)' : 'rgba(15,60,25,0.95)'

    for (let i = 0; i < barCount; i++) {
      const from = startIdx + Math.floor((i / barCount) * range)
      const toRaw = startIdx + Math.floor(((i + 1) / barCount) * range)
      const to = Math.max(from + 1, toRaw)

      let maxHi = 0
      let minLo = 0
      for (let j = from; j < to && j < bucketCount; j++) {
        const mx = peaksMax[j]
        const mn = peaksMin[j]
        if (mx > maxHi) maxHi = mx
        if (mn < minLo) minLo = mn
      }

      const x = (i / barCount) * width

      if (align === 'bottom') {
        const amp = Math.max(Math.abs(minLo), Math.abs(maxHi))
        const h = Math.max(1, amp * (height - 2))
        ctx.fillRect(x, height - h, barW, h)
      } else {
        const top = centerY - maxHi * halfH
        const bot = centerY - minLo * halfH
        const h = Math.max(1, bot - top)
        ctx.fillRect(x, top, barW, h)
      }
    }
  }, [wave, width, height, align, clip.trimStart, clip.start, clip.end])

  return (
    <div className="absolute inset-0 overflow-hidden rounded pointer-events-none" style={{ opacity: 0.9 }}>
      <canvas ref={canvasRef} />
    </div>
  )
})

export default memo(function Clip({ trackId, trackType, index, clip, containerRef, clipHeight }) {
  // isSelected is the only thing we need from selectedClips. Derive a
  // boolean directly in the selector — Zustand will only re-render when
  // the boolean flips, not every time the array reference changes.
  // Critical during rubber-band drag (60 fps × 40 clips × array rebuild
  // = 2400 unnecessary re-renders/sec on the old code).
  const isSelected = useProjectStore(s =>
    s.selectedClips.some(c => c.trackId === trackId && c.index === index)
  )
  const selectClip = useProjectStore(s => s.selectClip)
  const toggleClipSelection = useProjectStore(s => s.toggleClipSelection)
  const rangeSelectClip = useProjectStore(s => s.rangeSelectClip)
  const updateClip = useProjectStore(s => s.updateClip)
  const removeClip = useProjectStore(s => s.removeClip)
  const duplicateClip = useProjectStore(s => s.duplicateClip)
  const splitClipAtPlayhead = useProjectStore(s => s.splitClipAtPlayhead)
  const zoom = useProjectStore(s => s.zoom)
  // Only id + aspectRatio are read from project — narrow so an unrelated
  // field change (duration tick, exportRange handle drag, …) doesn't
  // bust the memo on every Clip.
  const projectId = useProjectStore(s => s.project?.id)
  const ratioId = useProjectStore(s => s.project?.aspectRatio ?? '9:16')
  const ratio = ASPECT_RATIOS.find(r => r.id === ratioId) ?? ASPECT_RATIOS[0]
  const { onMouseDown } = useClipDrag({ trackId, index, containerRef })
  const [ctxMenu, setCtxMenu] = useState(null) // { x, y }
  const [sfxSegOpen, setSfxSegOpen] = useState(false)
  const height = clipHeight ?? CLIP_HEIGHT

  const left = timeToPx(clip.start, zoom)
  const width = Math.max(8, timeToPx(clip.end - clip.start, zoom))
  const isColorFill = trackType === 'video' && !!clip.colorFill
  const isVideoTrack = trackType === 'video'
  // A real video clip (has a source file) can drive audio generation.
  const isVideoClip = isVideoTrack && !!clip.source && !isColorFill

  // Generate audio FROM this clip's video (MMAudio synced底聲 or Woosh V2A SFX),
  // land it as an asset, and drop an audio clip aligned to this clip's start.
  const generateAudioForClip = async (kind) => {
    if (!projectId || !clip.source) return
    const store = useProjectStore.getState()
    if (store.audioGen) { store.showToast?.('已有音效生成進行中，請稍候', 'warn'); return }
    const label = kind === 'mmaudio' ? '同步環境音' : '音效'
    store.beginAudioGen?.(kind === 'mmaudio' ? '正在用 MMAudio 生成同步環境音…' : '正在用 Woosh 生成音效…')
    try {
      const body = { projectId, source: clip.source }
      // MMAudio matches the clip's length (capped to keep VRAM in check).
      // Woosh-DVFlow is a fixed-8s model — duration is ignored there.
      if (kind === 'mmaudio') {
        body.duration = Math.max(1, Math.min(30, Number((clip.end - clip.start).toFixed(2))))
      }
      const res = await fetch(`/api/audio/${kind}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`)
      const dur = data.durationSec || (clip.end - clip.start)
      const newClip = { source: data.filename, start: clip.start, end: clip.start + dur, sourceDuration: dur }
      const audioTrack = store.project?.timeline?.tracks?.find(t => t.type === 'audio')
      if (audioTrack) store.addClip(audioTrack.id, newClip)
      else store.addTrackWithClip('audio', newClip)
      store.bumpAssetVersion?.()
      store.showToast?.(`已生成${label}並加到音軌（${data.genSeconds ?? '?'}s）`, 'success')
    } catch (e) {
      store.showToast?.(`生成失敗：${e.message}`, 'warn')
    } finally {
      store.endAudioGen?.()
    }
  }

  const color = isColorFill
    ? clip.colorFill
    : (TRACK_TYPE_COLORS[trackType] ?? '#888')

  // Close context menu on outside click
  useEffect(() => {
    if (!ctxMenu) return
    const close = () => setCtxMenu(null)
    window.addEventListener('click', close, { once: true })
    return () => window.removeEventListener('click', close)
  }, [ctxMenu])

  const handleContextMenu = (e) => {
    e.preventDefault()
    e.stopPropagation()
    selectClip(trackId, index)
    setCtxMenu({ x: e.clientX, y: e.clientY })
  }

  const label = isColorFill
    ? `🎨 ${clip.colorFill}`
    : trackType === 'text'
      ? (clip.text ?? '文字')
      : clip.source

  const hasFadeIn = !!clip.fadeIn
  const hasFadeOut = !!clip.fadeOut

  return (
    <div
      data-clip-el="true"
      className="absolute top-[2px] rounded select-none"
      style={{
        left,
        width,
        height,
        backgroundColor: color,
        opacity: isSelected ? 1 : 0.85,
        outline: isSelected ? `2px solid white` : 'none',
        outlineOffset: 1,
        cursor: 'grab',
        overflow: 'hidden',
      }}
      onClick={(e) => {
        e.stopPropagation()
        if (e.shiftKey) rangeSelectClip(trackId, index)
        else if (e.ctrlKey || e.metaKey) toggleClipSelection(trackId, index)
        else selectClip(trackId, index)
      }}
      onMouseDown={(e) => onMouseDown(e, 'move')}
      onContextMenu={handleContextMenu}
    >
      {/* Audio track: full-height waveform */}
      {trackType === 'audio' && projectId && (
        <ClipWaveform clip={clip} width={width} height={height} projectId={projectId} />
      )}

      {/* Video track: thumbnails on top, dedicated waveform row at bottom */}
      {isVideoTrack && projectId && (() => {
        const isImg = IMAGE_EXTS.test(clip.source ?? '')
        const waveH = isImg ? 0 : Math.max(16, Math.round(height * 0.32))
        const thumbH = height - waveH
        return (
          <>
            <div className="absolute left-0 right-0 top-0 overflow-hidden" style={{ height: thumbH }}>
              {isImg ? (
                ANIMATED_IMAGE_EXTS.test(clip.source) ? (
                  <FirstFrameCanvas
                    src={`/assets/${projectId}/${encodeURIComponent(clip.source)}`}
                    className="w-full h-full object-cover pointer-events-none"
                    style={{ opacity: 0.75 }}
                  />
                ) : (
                  <img
                    src={`/assets/${projectId}/${encodeURIComponent(clip.source)}`}
                    alt=""
                    className="w-full h-full object-cover pointer-events-none"
                    style={{ opacity: 0.75 }}
                    draggable={false}
                  />
                )
              ) : (
                <ClipThumbStrip clip={clip} width={width} projectId={projectId} />
              )}
            </div>
            {!isImg && clip.source && (
              <div
                className="absolute left-0 right-0 bottom-0 overflow-hidden z-[4] bg-black/45"
                style={{ height: waveH, borderTop: '1px solid rgba(255,255,255,0.15)' }}
              >
                <ClipWaveform clip={clip} width={width} height={waveH} projectId={projectId} align="bottom" />
              </div>
            )}
          </>
        )
      })()}

      {/* Left resize handle */}
      <div
        className="absolute left-0 top-0 w-2 h-full cursor-ew-resize z-10 hover:bg-white/20"
        onMouseDown={(e) => { e.stopPropagation(); onMouseDown(e, 'resize-start') }}
        onClick={(e) => e.stopPropagation()}
      />

      {/* Label (on top of frames) */}
      <div
        className="relative px-2 pt-1 text-white text-[11px] font-medium truncate pointer-events-none z-[5]"
        style={{ maxWidth: width - 16, textShadow: '0 1px 3px rgba(0,0,0,0.8)' }}
      >
        {label}
      </div>
      <div className="relative px-2 text-white/70 text-[10px] font-mono pointer-events-none z-[5]"
        style={{ textShadow: '0 1px 2px rgba(0,0,0,0.8)' }}
      >
        {(clip.end - clip.start).toFixed(1)}s
        {clip.trimStart > 0 && <span className="ml-1 text-yellow-400/70">+{clip.trimStart.toFixed(1)}</span>}
      </div>

      {/* In-point marker */}
      {(clip.trimStart ?? 0) > 0 && (
        <div className="absolute left-0 top-0 w-0 h-0 pointer-events-none z-[5]"
          style={{ borderTop: '8px solid #facc15', borderRight: '8px solid transparent' }} />
      )}

      {/* Fade-in indicator — diagonal line + gradient like CapCut */}
      {hasFadeIn && (() => {
        const fadeW = Math.min(width * 0.4, timeToPx(clip.fadeIn.duration, zoom))
        const isWhite = clip.fadeIn.color === '#fff'
        return (
          <div className="absolute left-0 top-0 h-full pointer-events-none z-[6]" style={{ width: fadeW }}>
            <svg width={fadeW} height={height} className="absolute inset-0" preserveAspectRatio="none">
              <polygon
                points={`0,0 ${fadeW},0 0,${height}`}
                fill={isWhite ? 'rgba(255,255,255,0.45)' : 'rgba(0,0,0,0.45)'}
              />
              <line x1="0" y1={height} x2={fadeW} y2="0" stroke={isWhite ? '#fff' : '#888'} strokeWidth="1.5" opacity="0.7" />
            </svg>
          </div>
        )
      })()}

      {/* Fade-out indicator — diagonal line + gradient like CapCut */}
      {hasFadeOut && (() => {
        const fadeW = Math.min(width * 0.4, timeToPx(clip.fadeOut.duration, zoom))
        const isWhite = clip.fadeOut.color === '#fff'
        return (
          <div className="absolute right-0 top-0 h-full pointer-events-none z-[6]" style={{ width: fadeW }}>
            <svg width={fadeW} height={height} className="absolute inset-0" preserveAspectRatio="none">
              <polygon
                points={`${fadeW},0 ${fadeW},${height} 0,0`}
                fill={isWhite ? 'rgba(255,255,255,0.45)' : 'rgba(0,0,0,0.45)'}
              />
              <line x1="0" y1="0" x2={fadeW} y2={height} stroke={isWhite ? '#fff' : '#888'} strokeWidth="1.5" opacity="0.7" />
            </svg>
          </div>
        )
      })()}

      {/* Keyframe diamond markers */}
      {(() => {
        const kfs = trackType === 'audio' ? clip.volumeKF : clip.opacityKF
        if (!kfs || kfs.length === 0) return null
        const clipDur = Math.max(0.001, clip.end - clip.start)
        return kfs.map((kf, ki) => {
          const x = Math.max(0, Math.min(1, kf.time / clipDur)) * width
          return (
            <div
              key={ki}
              className="absolute bottom-[3px] pointer-events-none z-[7]"
              style={{ left: x - 4, width: 8, height: 8 }}
            >
              <svg width="8" height="8" viewBox="0 0 8 8">
                <polygon points="4,0 8,4 4,8 0,4" fill="#fff" opacity="0.9" />
              </svg>
            </div>
          )
        })
      })()}

      {/* Right resize handle */}
      <div
        className="absolute right-0 top-0 w-2 h-full cursor-ew-resize z-10 hover:bg-white/20"
        onMouseDown={(e) => { e.stopPropagation(); onMouseDown(e, 'resize-end') }}
        onClick={(e) => e.stopPropagation()}
      />

      {/* Context menu */}
      {ctxMenu && (
        <ClipContextMenu
          x={ctxMenu.x}
          y={ctxMenu.y}
          isVideoClip={isVideoClip}
          onClose={() => setCtxMenu(null)}
          onGenMMAudio={() => { setCtxMenu(null); generateAudioForClip('mmaudio') }}
          onGenV2A={() => { setCtxMenu(null); setSfxSegOpen(true) }}
          onDelete={() => {
            setCtxMenu(null)
            removeClip(trackId, index)
          }}
          onDuplicate={() => { setCtxMenu(null); duplicateClip() }}
          onSplit={() => { setCtxMenu(null); splitClipAtPlayhead() }}
        />
      )}

      {sfxSegOpen && <SegmentSfxModal clip={clip} onClose={() => setSfxSegOpen(false)} />}
    </div>
  )
})

function ClipContextMenu({ x, y, onClose, onDelete, onDuplicate, onSplit, isVideoClip, onGenMMAudio, onGenV2A }) {
  // Adjust position so menu stays within viewport
  const menuRef = useRef(null)
  const [pos, setPos] = useState({ x, y })

  useEffect(() => {
    if (!menuRef.current) return
    const rect = menuRef.current.getBoundingClientRect()
    const vw = window.innerWidth, vh = window.innerHeight
    setPos({
      x: x + rect.width > vw ? x - rect.width : x,
      y: y + rect.height > vh ? y - rect.height : y,
    })
  }, [x, y])

  const items = [
    ...(isVideoClip ? [
      { label: '同步環境音 · 跟畫面長度 (MMAudio)', action: onGenMMAudio, accent: true },
      { label: '音效 SFX · 分段配音 (Woosh)', action: onGenV2A, accent: true },
      { divider: true },
    ] : []),
    { label: '分割片段', shortcut: 'S', action: onSplit },
    { label: '複製片段', shortcut: 'D', action: onDuplicate },
    { divider: true },
    { label: '刪除片段', shortcut: 'Del', action: onDelete, danger: true },
  ]

  return (
    <div
      ref={menuRef}
      className="fixed bg-[#2a2a2a] border border-[#444] rounded-lg shadow-2xl z-[9999] py-1 min-w-[140px]"
      style={{ left: pos.x, top: pos.y }}
      onClick={e => e.stopPropagation()}
      onContextMenu={e => e.preventDefault()}
    >
      {items.map((item, i) =>
        item.divider ? (
          <div key={i} className="border-t border-[#3a3a3a] my-1" />
        ) : (
          <button
            key={i}
            onClick={item.action}
            className={`w-full flex items-center justify-between px-3 py-1.5 text-xs hover:bg-[#3a3a3a] ${item.danger ? 'text-red-400' : item.accent ? 'text-[#f97316]' : 'text-[#ccc]'}`}
          >
            <span>{item.label}</span>
            {item.shortcut && <span className="text-[10px] text-[#555] ml-4">{item.shortcut}</span>}
          </button>
        )
      )}
    </div>
  )
}
