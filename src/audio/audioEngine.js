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
  // (without it the dedup at setClips would skip the rate update). trackId
  // included so moving a clip to another track re-routes it to that track's
  // bus. Effects (EQ/comp/limiter) are NOT in the key — they live on the track
  // bus (see setTrackFx), so changing a track's chain never restarts clips.
  return `${c.trackId ?? ''}|${c.source}|${c.timelineStart}|${c.trimStart}|${c.trimEnd}|${c.speed ?? 1}|${c.fadeIn || 0}|${c.fadeOut || 0}`
}

// Numeric coercion with fallback + clamp helpers for plugin params.
const num = (v, d) => (Number.isFinite(+v) ? +v : d)
const clampNum = (v, lo, hi) => Math.max(lo, Math.min(hi, v))
const dbToLin = (db) => Math.pow(10, db / 20)

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
    // Output monitoring (peak meter) + brickwall limiter. Chain tail is
    // masterGain → analyser (reads PRE-limiter peak, so the clip light tells you
    // the raw signal exceeded 0 dBFS) → limiter → destination.
    this.analyser = null
    this.limiter = null
    this._peakBuf = null
    // Master limiter state (mirrors project.masterLimiter / export ffmpegBuilder
    // buildMasterLimiterFilter). Default = on at -1 dB (legacy 防爆). Driven by
    // setMasterLimiter(); _ensureContext reads these when first building the bus.
    this._masterLimiterEnabled = true
    this._masterCeilingDb = -1

    // Per-track meter buses: trackId → { gain, analyser, buf }. Each clip routes
    // its tail into its track's bus.gain (gain → analyser → masterGain), so the
    // analyser reads that track's post-EQ/post-volume mix for the track meter.
    this.trackBuses = new Map()

    // Track effect chains: trackId → TrackPlugin[]. Set by setTrackFx(); each
    // bus builds its node chain from this. Kept separate from clip descriptors
    // because effects act on the whole-track mix, not per clip.
    this._trackPlugins = new Map()

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

    // Peak meter taps the signal BEFORE the limiter so the UI can show when the
    // raw mix clips (≥ 0 dBFS) even though the limiter then tames it.
    this.analyser = this.ctx.createAnalyser()
    this.analyser.fftSize = 1024
    this._peakBuf = new Float32Array(this.analyser.fftSize)

    // Brickwall-ish soft limiter on the master bus. DynamicsCompressor with a
    // high ratio + hard knee + fast attack catches EQ-boost overs so the
    // hardware output stops hard-clipping ("爆爆" sound).
    this.limiter = this.ctx.createDynamicsCompressor()
    this.limiter.threshold.value = this._masterCeilingDb
    this.limiter.knee.value = 0
    this.limiter.ratio.value = 20
    this.limiter.attack.value = 0.003
    this.limiter.release.value = 0.1

    this.masterGain.connect(this.analyser)
    // analyser → [limiter →] destination, depending on whether the master
    // limiter is enabled. Bypass routes analyser straight to destination.
    if (this._masterLimiterEnabled) {
      this.analyser.connect(this.limiter)
      this.limiter.connect(this.ctx.destination)
    } else {
      this.analyser.connect(this.ctx.destination)
    }
  }

  /** Enable/disable + retune the master-bus brickwall limiter, live. MIRROR:
   *  server/core/ffmpegBuilder.ts buildMasterLimiterFilter (export side). The
   *  meter/CLIP light tap PRE-limiter (masterGain → analyser), so toggling this
   *  never changes what they report — only what actually reaches the output. */
  setMasterLimiter(enabled, ceilingDb) {
    this._masterLimiterEnabled = enabled !== false
    if (typeof ceilingDb === 'number' && isFinite(ceilingDb)) this._masterCeilingDb = ceilingDb
    if (!this.ctx) return  // not built yet — values apply on next _ensureContext
    if (this.limiter) this.limiter.threshold.value = this._masterCeilingDb
    // Re-wire the analyser tail. analyser's only output is this master tail, so
    // disconnecting it is safe (masterGain → analyser stays intact).
    try { this.analyser.disconnect() } catch {}
    try { this.limiter.disconnect() } catch {}
    if (this._masterLimiterEnabled) {
      this.analyser.connect(this.limiter)
      this.limiter.connect(this.ctx.destination)
    } else {
      this.analyser.connect(this.ctx.destination)
    }
  }

  // Scan an analyser's time-domain frame for the linear peak → {peak, db, clip}.
  // clip = sample reached/exceeded 0 dBFS (≥ 1.0). Cheap enough to call per rAF.
  _readPeak(analyser, buf) {
    analyser.getFloatTimeDomainData(buf)
    let max = 0
    for (let i = 0; i < buf.length; i++) {
      const a = Math.abs(buf[i])
      if (a > max) max = a
    }
    return {
      peak: max,
      db: max > 0 ? 20 * Math.log10(max) : -Infinity,
      clip: max >= 1.0,
    }
  }

  // Read the master output peak (pre-limiter). clip=true means the raw mix hit
  // 0 dBFS and the limiter is engaging. Silence when the context isn't up yet.
  getOutputPeak() {
    if (!this.analyser) return { peak: 0, db: -Infinity, clip: false }
    return this._readPeak(this.analyser, this._peakBuf)
  }

  // Per-track bus = input → [plugin nodes] → analyser → masterGain. Clips connect
  // to bus.input; the plugin chain (EQ/comp/limiter) is built by _applyBusPlugins
  // from the track's effect chain. The analyser taps the POST-effect signal, so
  // the track meter shows what's actually heading into the master mix.
  _ensureTrackBus(trackId) {
    if (!trackId || !this.ctx) return null
    let bus = this.trackBuses.get(trackId)
    if (!bus) {
      const input = this.ctx.createGain()
      const analyser = this.ctx.createAnalyser()
      analyser.fftSize = 1024
      input.connect(analyser)
      analyser.connect(this.masterGain)
      bus = { input, analyser, buf: new Float32Array(analyser.fftSize), pluginNodes: [], pluginKey: '' }
      this.trackBuses.set(trackId, bus)
      const plugins = this._trackPlugins.get(trackId)
      if (plugins && plugins.length) this._applyBusPlugins(bus, plugins)
    }
    return bus
  }

  // Replace per-track effect chains and (re)build each live bus. Called by
  // PreviewPanel whenever track.plugins change. `map`: trackId → TrackPlugin[].
  setTrackFx(map) {
    this._ensureContext()
    this._trackPlugins = map instanceof Map ? map : new Map(Object.entries(map || {}))
    for (const [tid, bus] of this.trackBuses) {
      this._applyBusPlugins(bus, this._trackPlugins.get(tid) || [])
    }
  }

  // Build/update a bus's plugin node chain. Same structure (enabled plugin types
  // + EQ band count) → update params in place (smooth, no clicks); otherwise
  // tear down and rebuild the chain.
  _applyBusPlugins(bus, plugins) {
    const enabled = (plugins || []).filter(p => p && p.enabled)
    const key = enabled.map(p => (p.type === 'eq' ? `eq:${p.params?.bands?.length || 0}` : p.type)).join('|')
    if (key === bus.pluginKey) {
      this._updateBusParams(bus, enabled)
    } else {
      this._rebuildBusChain(bus, enabled)
      bus.pluginKey = key
    }
  }

  _rebuildBusChain(bus, enabled) {
    try { bus.input.disconnect() } catch {}
    for (const pn of bus.pluginNodes) for (const n of pn.nodes) { try { n.disconnect() } catch {} }
    bus.pluginNodes = []
    let tail = bus.input
    for (const p of enabled) {
      const made = this._makePluginNodes(p)
      if (!made) continue
      tail.connect(made.entry)
      tail = made.exit
      bus.pluginNodes.push({ type: p.type, refs: made.refs, nodes: made.nodes })
    }
    tail.connect(bus.analyser)
  }

  // Create Web Audio nodes for one plugin → { nodes, entry, exit, refs }. refs
  // lets _updateBusParams tweak params in place. Internal wiring (EQ band chain,
  // comp→makeup) is done here.
  _makePluginNodes(p) {
    const ctx = this.ctx
    if (p.type === 'eq') {
      const bands = p.params?.bands || []
      const nodes = bands.map(b => {
        const f = ctx.createBiquadFilter()
        f.type = (b.type === 'lowshelf' || b.type === 'highshelf') ? b.type : 'peaking'
        f.frequency.value = clampNum(num(b.freq, 1000), 20, 20000)
        f.gain.value = clampNum(num(b.gain, 0), -24, 24)
        f.Q.value = clampNum(num(b.q, 1), 0.1, 20)
        return f
      })
      if (nodes.length === 0) { const g = ctx.createGain(); return { nodes: [g], entry: g, exit: g, refs: [] } }
      for (let i = 0; i < nodes.length - 1; i++) nodes[i].connect(nodes[i + 1])
      return { nodes, entry: nodes[0], exit: nodes[nodes.length - 1], refs: nodes }
    }
    if (p.type === 'compressor') {
      const pr = p.params || {}
      const c = ctx.createDynamicsCompressor()
      c.threshold.value = clampNum(num(pr.threshold, -24), -100, 0)
      c.ratio.value = clampNum(num(pr.ratio, 3), 1, 20)
      c.attack.value = clampNum(num(pr.attack, 10), 0, 1000) / 1000
      c.release.value = clampNum(num(pr.release, 100), 0, 2000) / 1000
      c.knee.value = clampNum(num(pr.knee, 6), 0, 40)
      const m = ctx.createGain()
      m.gain.value = dbToLin(clampNum(num(pr.makeup, 0), -12, 24))
      c.connect(m)
      return { nodes: [c, m], entry: c, exit: m, refs: { comp: c, makeup: m } }
    }
    if (p.type === 'limiter') {
      const pr = p.params || {}
      const l = ctx.createDynamicsCompressor()
      l.threshold.value = clampNum(num(pr.threshold, -1), -60, 0)
      l.knee.value = 0
      l.ratio.value = 20
      l.attack.value = 0.003
      l.release.value = clampNum(num(pr.release, 50), 1, 1000) / 1000
      return { nodes: [l], entry: l, exit: l, refs: { lim: l } }
    }
    if (p.type === 'reverb') {
      // FabFilter Pro-R-inspired (approximate). True wet/dry split here is the
      // accurate audition vs the export's linear aecho chain.
      // input → dry → output  +  input → predelay → convolver → thickness → wet → output.
      const pr = p.params || {}
      const predelay = clampNum(num(pr.predelay, 20), 0, 200) / 1000
      const space = clampNum(num(pr.space, 2), 0.2, 8)
      const character = clampNum(num(pr.character, 50), 0, 100) / 100
      const brightness = clampNum(num(pr.brightness, 60), 0, 100) / 100
      const thickness = clampNum(num(pr.thickness, 30), 0, 100) / 100
      const width = clampNum(num(pr.width, 80), 0, 100) / 100
      const mix = clampNum(num(pr.mix, 25), 0, 100) / 100
      const input = ctx.createGain()
      const output = ctx.createGain()
      const dry = ctx.createGain(); dry.gain.value = 1
      const wet = ctx.createGain(); wet.gain.value = mix
      const pre = ctx.createDelay(0.5); pre.delayTime.value = predelay
      const conv = ctx.createConvolver(); conv.buffer = this._makeReverbIR(space, character, brightness, width)
      const thick = ctx.createBiquadFilter(); thick.type = 'lowshelf'; thick.frequency.value = 200; thick.gain.value = thickness * 6
      input.connect(dry); dry.connect(output)
      input.connect(pre); pre.connect(conv); conv.connect(thick); thick.connect(wet); wet.connect(output)
      return {
        nodes: [input, output, dry, wet, pre, conv, thick],
        entry: input, exit: output,
        refs: { wet, pre, conv, thick, space, character, brightness, width },
      }
    }
    const g = ctx.createGain()
    return { nodes: [g], entry: g, exit: g, refs: {} }
  }

  // Synthesise a stereo reverb impulse. space→length; character→decay
  // density/shape; brightness→high-freq content; width→L/R decorrelation.
  _makeReverbIR(space, character, brightness, width) {
    const ctx = this.ctx
    const rate = ctx.sampleRate
    const len = Math.max(1, Math.floor(space * rate))
    const ir = ctx.createBuffer(2, len, rate)
    const decayPow = 1.5 + (1 - character) * 4   // lower character → faster, sparser tail
    const lp = 0.04 + brightness * 0.6           // brighter → larger coeff (less high-cut)
    const L = ir.getChannelData(0)
    const R = ir.getChannelData(1)
    let lastL = 0, lastR = 0
    for (let i = 0; i < len; i++) {
      const env = Math.pow(1 - i / len, decayPow)
      lastL = lastL + lp * ((Math.random() * 2 - 1) - lastL)
      lastR = lastR + lp * ((Math.random() * 2 - 1) - lastR)
      L[i] = lastL * env
      // width: R blends from identical-to-L (mono) to independent (wide)
      R[i] = ((1 - width) * lastL + width * lastR) * env
    }
    return ir
  }

  _updateBusParams(bus, enabled) {
    const now = this.ctx.currentTime, tc = 0.01
    for (let i = 0; i < bus.pluginNodes.length && i < enabled.length; i++) {
      const pn = bus.pluginNodes[i], p = enabled[i]
      if (pn.type !== p.type) continue
      try {
        if (p.type === 'eq') {
          const bands = p.params?.bands || []
          pn.refs.forEach((f, j) => {
            const b = bands[j]; if (!b) return
            f.frequency.setTargetAtTime(clampNum(num(b.freq, 1000), 20, 20000), now, tc)
            f.gain.setTargetAtTime(clampNum(num(b.gain, 0), -24, 24), now, tc)
            f.Q.setTargetAtTime(clampNum(num(b.q, 1), 0.1, 20), now, tc)
          })
        } else if (p.type === 'compressor') {
          const pr = p.params || {}
          pn.refs.comp.threshold.setTargetAtTime(clampNum(num(pr.threshold, -24), -100, 0), now, tc)
          pn.refs.comp.ratio.setTargetAtTime(clampNum(num(pr.ratio, 3), 1, 20), now, tc)
          pn.refs.comp.attack.setTargetAtTime(clampNum(num(pr.attack, 10), 0, 1000) / 1000, now, tc)
          pn.refs.comp.release.setTargetAtTime(clampNum(num(pr.release, 100), 0, 2000) / 1000, now, tc)
          pn.refs.comp.knee.setTargetAtTime(clampNum(num(pr.knee, 6), 0, 40), now, tc)
          pn.refs.makeup.gain.setTargetAtTime(dbToLin(clampNum(num(pr.makeup, 0), -12, 24)), now, tc)
        } else if (p.type === 'limiter') {
          const pr = p.params || {}
          pn.refs.lim.threshold.setTargetAtTime(clampNum(num(pr.threshold, -1), -60, 0), now, tc)
          pn.refs.lim.release.setTargetAtTime(clampNum(num(pr.release, 50), 1, 1000) / 1000, now, tc)
        } else if (p.type === 'reverb') {
          const pr = p.params || {}
          const predelay = clampNum(num(pr.predelay, 20), 0, 200) / 1000
          const space = clampNum(num(pr.space, 2), 0.2, 8)
          const character = clampNum(num(pr.character, 50), 0, 100) / 100
          const brightness = clampNum(num(pr.brightness, 60), 0, 100) / 100
          const thickness = clampNum(num(pr.thickness, 30), 0, 100) / 100
          const width = clampNum(num(pr.width, 80), 0, 100) / 100
          const mix = clampNum(num(pr.mix, 25), 0, 100) / 100
          pn.refs.wet.gain.setTargetAtTime(mix, now, tc)
          pn.refs.pre.delayTime.setTargetAtTime(predelay, now, tc)
          pn.refs.thick.gain.setTargetAtTime(thickness * 6, now, tc)
          // Regenerate the impulse only when an IR-affecting param changes (costly).
          if (Math.abs(pn.refs.space - space) > 0.01 || Math.abs(pn.refs.character - character) > 0.01 ||
              Math.abs(pn.refs.brightness - brightness) > 0.01 || Math.abs(pn.refs.width - width) > 0.01) {
            pn.refs.conv.buffer = this._makeReverbIR(space, character, brightness, width)
            pn.refs.space = space; pn.refs.character = character
            pn.refs.brightness = brightness; pn.refs.width = width
          }
        }
      } catch {}
    }
  }

  // Read a single track's output peak (post-EQ, post-track-volume, pre-master).
  // Silence when the track has no bus yet (nothing scheduled on it).
  getTrackPeak(trackId) {
    const bus = this.trackBuses.get(trackId)
    if (!bus) return { peak: 0, db: -Infinity, clip: false }
    return this._readPeak(bus.analyser, bus.buf)
  }

  // Frequency-domain magnitudes (0–255 per bin) of a track's post-FX signal —
  // drives the EQ graph's live spectrum overlay. Null when the track has no bus.
  getTrackSpectrum(trackId) {
    const bus = this.trackBuses.get(trackId)
    if (!bus || !bus.analyser) return null
    const a = bus.analyser
    if (!bus.freqBuf || bus.freqBuf.length !== a.frequencyBinCount) {
      bus.freqBuf = new Uint8Array(a.frequencyBinCount)
    }
    a.getByteFrequencyData(bus.freqBuf)
    return { data: bus.freqBuf, sampleRate: this.ctx.sampleRate, fftSize: a.fftSize }
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
        // Owning track id — routes the clip to its per-track meter bus.
        trackId: c.trackId ?? null,
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

    // Track meter buses: ensure one per live track, tear down buses for tracks
    // that no longer have clips. Idempotent — safe to run every setClips.
    const liveTrackIds = new Set(norm.map(c => c.trackId).filter(Boolean))
    for (const tid of liveTrackIds) this._ensureTrackBus(tid)
    for (const [tid, bus] of this.trackBuses) {
      if (!liveTrackIds.has(tid)) {
        try { bus.input.disconnect() } catch {}
        for (const pn of bus.pluginNodes) for (const n of pn.nodes) { try { n.disconnect() } catch {} }
        try { bus.analyser.disconnect() } catch {}
        this.trackBuses.delete(tid)
      }
    }

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
        source.connect(gain)
        // Route the clip into its track's bus input. The bus runs the per-track
        // effect chain (EQ/comp/limiter) → analyser → master. Effects are
        // per-track, not per-clip. Falls back to master when there's no track id.
        const bus = this._ensureTrackBus(clip.trackId)
        gain.connect(bus ? bus.input : this.masterGain)

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
    this.analyser = null
    this.limiter = null
    this._peakBuf = null
    this.trackBuses.clear()
    this._trackPlugins.clear()
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
