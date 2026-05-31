// Web Audio API multi-track preview engine for 13SoulMU.
//
// Architecture (see memory: project_vision.md, feedback_performance_architecture.md)
// - Single AudioContext lives in the renderer process → zero IPC, clock in the
//   same process as the UI that reads it.
// - Decode-once cache per source URL (AudioBuffer keyed by source filename).
// - On play(): schedule a fresh AudioBufferSourceNode per active clip via
//   source.start(when, offset, duration) — Chromium's audio thread handles
//   the actual sample-accurate mixing (C++), JS only arranges nodes.
// - Master clock derived from ctx.currentTime, so getPlayhead() is sample-
//   accurate and drift-free. Video element becomes a slave.
// - Engine owns no project state: setClips() takes plain descriptors, any
//   store changes re-enter via setClips().

const CLIP_END_EPSILON = 0.001

function makeClipKey(c) {
  // Speed included so a per-clip speed change re-schedules the source node
  // (without it the dedup at setClips would skip the rate update).
  return `${c.source}|${c.timelineStart}|${c.trimStart}|${c.trimEnd}|${c.speed ?? 1}|${c.fadeIn || 0}|${c.fadeOut || 0}`
}

// Gain at a given source-time position within a clip, given target volume,
// clip source duration, and effective fade-in/out durations.
// Used to pick the initial value when a node starts mid-fade.
function gainAtPos(target, pos, dur, fIn, fOut) {
  let g = target
  if (fIn > 0 && pos < fIn) {
    g = Math.min(g, target * (pos / fIn))
  }
  const fOutStart = dur - fOut
  if (fOut > 0 && pos > fOutStart) {
    g = Math.min(g, target * ((dur - pos) / fOut))
  }
  return Math.max(0, g)
}

class AudioEngine {
  constructor() {
    this.ctx = null
    this.masterGain = null

    // Decoded AudioBuffer cache: source string → Promise<AudioBuffer>
    this.decodeCache = new Map()

    // Current clip descriptors (structurally stable between setClips calls)
    this.clips = []
    this.clipsKey = ''

    // Active scheduled nodes: clipKey → { source, gain }
    this.activeSources = new Map()

    // Playback state
    this.playing = false
    this.speed = 1
    // Timeline time at the moment playback started (or last pause).
    this.playheadAnchor = 0
    // ctx.currentTime at the moment playback started. Only valid when playing.
    this.audioAnchor = 0

    // URL resolver: (source) => URL string. Set by setProjectId().
    this.resolveUrl = null

    // Playhead update subscribers
    this.playheadListeners = new Set()
  }

  // Lazy-init the AudioContext on first user gesture. Chromium blocks
  // construction-time context usage; resume() happens in play().
  _ensureContext() {
    if (this.ctx) return
    const Ctor = window.AudioContext || window.webkitAudioContext
    this.ctx = new Ctor({ latencyHint: 'interactive' })
    this.masterGain = this.ctx.createGain()
    this.masterGain.gain.value = 1
    this.masterGain.connect(this.ctx.destination)
  }

  setProjectId(projectId) {
    this.resolveUrl = projectId
      ? (source) => `/assets/${projectId}/${encodeURIComponent(source)}`
      : null
    // New project: drop decoded cache to avoid holding stale project's buffers.
    this.decodeCache.clear()
  }

  setMasterVolume(v) {
    this._ensureContext()
    this.masterGain.gain.value = Math.max(0, Math.min(1, v))
  }

  // Pre-warm the AudioContext on the first user gesture so the first play()
  // doesn't pay the resume() latency. Safe to call repeatedly.
  warmup() {
    this._ensureContext()
    if (this.ctx.state === 'suspended') {
      this.ctx.resume().catch(() => {})
    }
  }

  // Fetch + decodeAudioData, memoized per source.
  _decode(source) {
    if (this.decodeCache.has(source)) return this.decodeCache.get(source)
    if (!this.resolveUrl) {
      return Promise.reject(new Error('audioEngine: projectId not set'))
    }
    const url = this.resolveUrl(source)
    const p = fetch(url)
      .then(r => {
        if (!r.ok) throw new Error(`fetch ${url}: ${r.status}`)
        return r.arrayBuffer()
      })
      .then(buf => this.ctx.decodeAudioData(buf))
      .catch(err => {
        // Evict failed entries so a retry is possible.
        this.decodeCache.delete(source)
        console.warn(`[audioEngine] decode failed for ${source}:`, err?.message ?? err)
        throw err
      })
    this.decodeCache.set(source, p)
    return p
  }

  // Replace the active clip list. Incremental: if structurally identical,
  // no-op. Otherwise, if currently playing, stop and reschedule.
  setClips(clips) {
    this._ensureContext()
    // Normalize + filter
    const norm = (clips ?? [])
      .filter(c => c && typeof c.source === 'string')
      .map(c => ({
        source: c.source,
        timelineStart: Number(c.timelineStart) || 0,
        trimStart: Number(c.trimStart) || 0,
        trimEnd: Number(c.trimEnd) || 0,
        // Per-clip playback rate. Multiplied with the engine's master
        // speed at scheduling time. Pitch shifts here (Web Audio's
        // playbackRate doesn't preserve pitch); render side uses atempo
        // so the export is pitch-correct.
        speed: Math.max(0.05, Math.min(8, Number(c.speed) || 1)),
        volume: c.volume == null ? 1 : Number(c.volume),
        muted: !!c.muted,
        fadeIn: Math.max(0, Number(c.fadeIn) || 0),
        fadeOut: Math.max(0, Number(c.fadeOut) || 0),
      }))
      .filter(c => c.trimEnd > c.trimStart)

    const key = norm.map(makeClipKey).join(';')
    if (key === this.clipsKey) {
      // Same structural clip list (source/trim/fade unchanged); volume/mute
      // updates re-apply the envelope in place so slider drags are smooth
      // and don't stop/restart source nodes (which would click).
      this.clips = norm
      for (const c of norm) {
        const ck = makeClipKey(c)
        const node = this.activeSources.get(ck)
        if (!node) continue
        const nowCtx = this.ctx.currentTime
        const elapsed = Math.max(0, nowCtx - node.startedCtx)
        const effRate = this.speed * (node.clip.speed ?? 1)
        const curClipPos = node.startClipPos + elapsed * effRate
        const remaining = (node.clip.trimEnd - node.clip.trimStart) - curClipPos
        if (remaining <= CLIP_END_EPSILON) continue
        node.clip = c
        this._applyGainEnvelope(
          node.gain, c, nowCtx, curClipPos, remaining, effRate, true
        )
      }
      return
    }
    this.clips = norm
    this.clipsKey = key

    // Kick off decodes for new sources (non-blocking).
    const unique = new Set(norm.map(c => c.source))
    for (const src of unique) this._decode(src).catch(() => {})

    if (this.playing) {
      const now = this.getPlayhead()
      this._stopAll()
      this._scheduleFrom(now)
    }
  }

  hasActiveClips() {
    return this.clips.length > 0
  }

  // Compute timeline time now. Clamped to not overshoot last clip.
  getPlayhead() {
    if (!this.playing || !this.ctx) return this.playheadAnchor
    const delta = (this.ctx.currentTime - this.audioAnchor) * this.speed
    return this.playheadAnchor + delta
  }

  onPlayheadUpdate(cb) {
    this.playheadListeners.add(cb)
    return () => this.playheadListeners.delete(cb)
  }

  play(fromTime, speed = 1) {
    this._ensureContext()
    if (this.ctx.state === 'suspended') this.ctx.resume().catch(() => {})

    // If already playing, first stop so we can re-anchor.
    if (this.playing) this._stopAll()

    this.speed = speed || 1
    this.playheadAnchor = fromTime
    this.audioAnchor = this.ctx.currentTime
    this.playing = true

    this._scheduleFrom(fromTime)
  }

  pause() {
    if (!this.playing) return
    const now = this.getPlayhead()
    this._stopAll()
    this.playing = false
    this.playheadAnchor = now
  }

  seek(time) {
    if (this.playing) {
      // Skip re-anchor for tiny diffs so the rAF tick (which writes engine
      // time back to the store every frame) doesn't cause audio clicks.
      const cur = this.getPlayhead()
      if (Math.abs(cur - time) < 0.02) return
      this._stopAll()
      this.playheadAnchor = time
      this.audioAnchor = this.ctx.currentTime
      this._scheduleFrom(time)
    } else {
      this.playheadAnchor = time
    }
  }

  setSpeed(speed) {
    const s = Math.max(0.1, Math.min(4, speed || 1))
    if (s === this.speed) return
    if (this.playing) {
      const now = this.getPlayhead()
      this._stopAll()
      this.speed = s
      this.playheadAnchor = now
      this.audioAnchor = this.ctx.currentTime
      this._scheduleFrom(now)
    } else {
      this.speed = s
    }
  }

  // Schedule every clip that is active or upcoming from `fromTime`.
  // Decodes in flight will attach once ready (checked via .then).
  _scheduleFrom(fromTime) {
    if (!this.ctx) return
    const anchorAudioTime = this.ctx.currentTime
    const speed = this.speed
    const snapshotAnchor = this.audioAnchor

    for (const clip of this.clips) {
      const clipDurSource = clip.trimEnd - clip.trimStart
      if (clipDurSource <= CLIP_END_EPSILON) continue
      // Per-clip speed multiplies into the effective playback rate. Timeline
      // duration of this clip = sourceRange / clipSpeed; the engine's master
      // speed scales every clip's wall-clock rate on top of that.
      const clipSpeed = clip.speed ?? 1
      const effectiveRate = speed * clipSpeed
      const clipDurTimeline = clipDurSource / clipSpeed
      const clipTimelineEnd = clip.timelineStart + clipDurTimeline
      if (clipTimelineEnd <= fromTime + CLIP_END_EPSILON) continue

      const ck = makeClipKey(clip)

      // whenTimeline = timeline time at which this clip's sample begins to play
      const whenTimeline = Math.max(fromTime, clip.timelineStart)
      // Source buffer offset (in source media seconds). When fromTime lands
      // mid-clip, source offset = trimStart + (timelineSecondsIntoClip ×
      // clipSpeed). clipSpeed=2 means the source advances 2× per timeline
      // second, so after 1 timeline second mid-clip we sample 2 source
      // seconds in.
      const offset = clip.trimStart + (whenTimeline - clip.timelineStart) * clipSpeed
      // Scheduled audio-context time. Only the master `speed` warps the
      // timeline→audio-ctx mapping; per-clip speed lives in playbackRate.
      const when = anchorAudioTime + (whenTimeline - fromTime) / speed
      // How long to play, in source seconds.
      const sourceDuration = clip.trimEnd - offset
      if (sourceDuration <= CLIP_END_EPSILON) continue

      this._decode(clip.source).then(buffer => {
        // Bail if state changed while decoding.
        if (!this.playing) return
        if (this.audioAnchor !== snapshotAnchor) return
        if (this.activeSources.has(ck)) return

        const source = this.ctx.createBufferSource()
        source.buffer = buffer
        source.playbackRate.value = effectiveRate

        const gain = this.ctx.createGain()
        source.connect(gain).connect(this.masterGain)

        // Clamp offset to buffer length (avoids "offset > duration" throws
        // when the trim extends past the actual decoded length).
        const safeOffset = Math.max(0, Math.min(offset, buffer.duration))
        const safeDuration = Math.max(
          0,
          Math.min(sourceDuration, buffer.duration - safeOffset)
        )
        if (safeDuration <= CLIP_END_EPSILON) return

        // If `when` has already slipped into the past (decode took too long),
        // fall back to now and advance offset accordingly. Source advances
        // at effectiveRate, not just the master speed, so per-clip speed has
        // to be in the slip math too.
        let effectiveWhen = when
        let effectiveOffset = safeOffset
        let effectiveDuration = safeDuration
        const nowAudio = this.ctx.currentTime
        if (effectiveWhen < nowAudio) {
          const slip = (nowAudio - effectiveWhen) * effectiveRate
          effectiveWhen = nowAudio
          effectiveOffset = safeOffset + slip
          effectiveDuration = safeDuration - slip
          if (effectiveDuration <= CLIP_END_EPSILON) return
          if (effectiveOffset >= buffer.duration) return
        }

        // Position within the clip (source seconds from clip start) at which
        // this node actually begins playing. Used for envelope scheduling.
        const startClipPos = Math.max(0, effectiveOffset - clip.trimStart)
        this._applyGainEnvelope(
          gain, clip, effectiveWhen, startClipPos, effectiveDuration, effectiveRate
        )

        try {
          source.start(effectiveWhen, effectiveOffset, effectiveDuration)
        } catch {
          return
        }
        source.onended = () => {
          if (this.activeSources.get(ck) === node) {
            this.activeSources.delete(ck)
          }
          try { source.disconnect() } catch {}
          try { gain.disconnect() } catch {}
        }

        const node = {
          source,
          gain,
          clip,
          startedCtx: effectiveWhen,
          startClipPos,
        }
        this.activeSources.set(ck, node)
      }).catch(() => {})
    }
  }

  // Schedule a linear fade envelope on `gainNode` for a clip starting at
  // `startCtx` in context time, at source position `startClipPos` (seconds
  // from clip start), playing for `nodeDurSource` source seconds at `speed`.
  //
  // Works whether the node starts at the beginning of the clip or mid-fade.
  // Caps fadeIn/fadeOut to half the clip length so very short clips degrade
  // gracefully.
  _applyGainEnvelope(gainNode, clip, startCtx, startClipPos, nodeDurSource, speed, smooth = false) {
    const target = clip.muted ? 0 : clip.volume
    const clipDur = clip.trimEnd - clip.trimStart
    const maxFade = clipDur / 2
    const fIn = Math.min(Math.max(0, clip.fadeIn || 0), maxFade)
    const fOut = Math.min(Math.max(0, clip.fadeOut || 0), maxFade)
    const endClipPos = startClipPos + nodeDurSource

    const g = gainNode.gain
    // When re-scheduling mid-playback (slider drag), capture the currently
    // animated value first so we can ramp into the new envelope in ~10ms
    // instead of snapping (which would click).
    const smoothTime = smooth ? 0.01 : 0
    const currentVal = smooth ? g.value : null
    try { g.cancelScheduledValues(startCtx) } catch {}

    // Short-circuit: muted or no fades → constant value.
    if (target <= 0 || (fIn <= 0 && fOut <= 0)) {
      if (smooth) {
        g.setValueAtTime(currentVal, startCtx)
        g.linearRampToValueAtTime(target, startCtx + smoothTime)
      } else {
        g.setValueAtTime(target, startCtx)
      }
      return
    }

    const posToCtx = (pos) => startCtx + (pos - startClipPos) / speed
    const initGain = gainAtPos(target, startClipPos, clipDur, fIn, fOut)
    if (smooth) {
      g.setValueAtTime(currentVal, startCtx)
      g.linearRampToValueAtTime(initGain, startCtx + smoothTime)
    } else {
      g.setValueAtTime(initGain, startCtx)
    }

    // Candidate breakpoints in clip source-time, in order:
    // fade-in end, fade-out start, clip end.
    const fOutStart = clipDur - fOut
    const candidates = []
    if (fIn > 0) candidates.push(fIn)
    if (fOut > 0) candidates.push(fOutStart)
    candidates.push(clipDur)
    candidates.sort((a, b) => a - b)

    const minCtx = startCtx + smoothTime + 0.0001
    let lastPos = startClipPos
    for (const raw of candidates) {
      const pos = Math.min(raw, endClipPos)
      if (pos <= lastPos + 0.0001) continue
      if (pos > endClipPos + 0.0001) break
      const ctxTime = Math.max(posToCtx(pos), minCtx)
      const val = gainAtPos(target, pos, clipDur, fIn, fOut)
      g.linearRampToValueAtTime(val, ctxTime)
      lastPos = pos
      if (pos >= endClipPos - 0.0001) break
    }
  }

  _stopAll() {
    for (const { source, gain } of this.activeSources.values()) {
      try { source.onended = null } catch {}
      try { source.stop() } catch {}
      try { source.disconnect() } catch {}
      try { gain.disconnect() } catch {}
    }
    this.activeSources.clear()
  }

  dispose() {
    this._stopAll()
    if (this.ctx) {
      try { this.ctx.close() } catch {}
    }
    this.ctx = null
    this.masterGain = null
    this.decodeCache.clear()
    this.clips = []
    this.clipsKey = ''
    this.playing = false
    this.playheadAnchor = 0
  }
}

// HMR-safe singleton — survives Vite module reloads during dev.
const g = typeof globalThis !== 'undefined' ? globalThis : window
if (!g.__13soulmu_audio_engine__) {
  g.__13soulmu_audio_engine__ = new AudioEngine()
}

export const audioEngine = g.__13soulmu_audio_engine__
