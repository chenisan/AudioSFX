// @ts-check
/**
 * Editor UI slice — per-session interaction state. Lives only in memory,
 * NEVER snapshotted into undo, NEVER persisted to project.yaml.
 *
 * If you find yourself adding `_pushUndo()` to an action here, that action
 * probably belongs in projectDocSlice instead.
 *
 * Owned state:
 *   - selectedClip / selectedClips      — selection (primary + multi)
 *   - clipboard                          — copy/paste buffer
 *   - lastCursor                         — last known mouse pos on a track
 *   - toast                              — transient bottom-right notice
 *   - playheadTime / zoom / isPlaying    — timeline transport
 *   - assetVersion                       — bumped to invalidate asset URL caches
 *   - previewAsset                       — single-asset preview override
 *   - autoSnap                           — magnetic snap toggle
 *   - loopExportRange                    — loop within [in, out] when range set
 *   - exportSettings                     — per-machine export prefs (sticky)
 */
import { DEFAULT_ZOOM, findTrack } from '../utils'

export function createEditorUISlice(set, get) {
  return {
    selectedClip: null,
    selectedClips: [],
    clipboard: null,
    lastCursor: null,
    toast: null,
    playheadTime: 0,
    zoom: DEFAULT_ZOOM,
    isPlaying: false,
    assetVersion: 0,
    previewAsset: null,
    autoSnap: false,
    loopExportRange: false,
    // Master output volume (0–1). UI-only; persisted per-machine to localStorage
    // (not project.yaml). Synced to audioEngine.setMasterVolume by PreviewPanel.
    masterVolume: (() => {
      try {
        const v = Number(localStorage.getItem('13soul.masterVolume'))
        return Number.isFinite(v) && v >= 0 && v <= 1 ? v : 1
      } catch { return 1 }
    })(),
    // Floating video-preview window. UI-only, per-machine (localStorage), never
    // in project.yaml / undo. previewOpen toggles the window; previewRect is its
    // {x,y,w,h} (null = compute bottom-right default on first mount).
    previewOpen: (() => {
      try { return localStorage.getItem('13soul.preview.open') !== '0' } catch { return true }
    })(),
    previewRect: (() => {
      try {
        const r = JSON.parse(localStorage.getItem('13soul.preview.rect') || 'null')
        if (r && ['x', 'y', 'w', 'h'].every(k => Number.isFinite(r[k]))) return r
      } catch {}
      return null
    })(),
    // Persistent indicator for long audio generations (MMAudio/Woosh V2A) that
    // have no sub-step progress. null = idle; otherwise { label, startedAt }.
    audioGen: null,

    exportSettings: {
      format: 'mp4',
      quality: 'high',
      fps: 30,
      videoBitrate: 'auto',
      audioBitrate: '192k',
    },

    // ── Selection ────────────────────────────────────

    selectClip(trackId, index) {
      const entry = { trackId, index }
      set({ selectedClip: entry, selectedClips: [entry] })
    },

    toggleClipSelection(trackId, index) {
      const { selectedClips } = get()
      const pos = selectedClips.findIndex(c => c.trackId === trackId && c.index === index)
      const next = pos >= 0
        ? selectedClips.filter((_, i) => i !== pos)
        : [...selectedClips, { trackId, index }]
      set({ selectedClips: next, selectedClip: next.length > 0 ? next[next.length - 1] : null })
    },

    rangeSelectClip(trackId, index) {
      const { selectedClip, selectedClips, project } = get()
      if (!selectedClip) {
        const entry = { trackId, index }
        set({ selectedClip: entry, selectedClips: [entry] })
        return
      }
      if (selectedClip.trackId !== trackId) {
        const entry = { trackId, index }
        const already = selectedClips.some(c => c.trackId === trackId && c.index === index)
        const next = already ? selectedClips : [...selectedClips, entry]
        set({ selectedClips: next, selectedClip: entry })
        return
      }
      const track = findTrack(project.timeline, trackId)
      if (!track) return
      const lo = Math.min(selectedClip.index, index)
      const hi = Math.max(selectedClip.index, index)
      const range = []
      for (let i = lo; i <= hi; i++) {
        if (track.clips[i]) range.push({ trackId, index: i })
      }
      const others = selectedClips.filter(c => c.trackId !== trackId)
      set({ selectedClips: [...others, ...range], selectedClip: { trackId, index } })
    },

    clearSelection() {
      set({ selectedClip: null, selectedClips: [] })
    },

    setSelectedClipsBatch(entries) {
      if (entries.length === 0) {
        set({ selectedClip: null, selectedClips: [] })
      } else {
        set({ selectedClips: entries, selectedClip: entries[entries.length - 1] })
      }
    },

    // ── Cursor / Toast ───────────────────────────────

    setLastCursor(cursor) {
      set({ lastCursor: cursor })
    },

    /** Transient bottom-right toast. Auto-clears in 2.5s; a new toast pre-empts. */
    showToast(message, kind = 'info') {
      const id = Date.now() + Math.random()
      set({ toast: { id, message, kind } })
      setTimeout(() => {
        if (get().toast?.id === id) set({ toast: null })
      }, 2500)
    },

    // ── Audio generation status (persistent; no auto-clear) ──────────────────

    /** Mark a long audio generation as in-flight (shows the floating indicator). */
    beginAudioGen(label) {
      set({ audioGen: { label, startedAt: Date.now() } })
    },
    endAudioGen() {
      set({ audioGen: null })
    },

    // ── Clipboard (clipboard contents are UI-only — actual paste uses REST in projectDoc) ─

    copySelectedClips() {
      const { project, selectedClips } = get()
      if (!project || selectedClips.length === 0) return false
      let trackType = null
      const clips = []
      for (const sel of selectedClips) {
        const track = findTrack(project.timeline, sel.trackId)
        if (!track) continue
        if (trackType === null) trackType = track.type
        else if (trackType !== track.type) {
          get().showToast('無法複製：不能跨類型多選（影片/音訊/文字）', 'warn')
          return false
        }
        const c = track.clips?.[sel.index]
        if (c) clips.push(JSON.parse(JSON.stringify(c)))
      }
      if (clips.length === 0 || !trackType) return false
      clips.sort((a, b) => (a.start ?? 0) - (b.start ?? 0))
      set({ clipboard: { trackType, clips, baseStart: clips[0].start ?? 0 } })
      get().showToast(`已複製 ${clips.length} 個片段`, 'info')
      return true
    },

    // ── Playhead & Zoom ──────────────────────────────

    setPlayheadTime(timeOrFn) {
      const { project, playheadTime, previewAsset } = get()
      if (!project) return
      // Clamp to last clip end (content end), not project.duration
      const tracks = project.timeline?.tracks ?? []
      let contentEnd = 0
      for (const t of tracks) {
        for (const c of (t.clips ?? [])) {
          if (c.end > contentEnd) contentEnd = c.end
        }
      }
      const max = contentEnd > 0 ? contentEnd : (project.duration ?? 60)
      const raw = typeof timeOrFn === 'function' ? timeOrFn(playheadTime) : timeOrFn
      if (isNaN(raw)) return
      const update = { playheadTime: Math.max(0, Math.min(raw, max)) }
      if (previewAsset) update.previewAsset = null
      set(update)
    },

    setZoom(zoom) {
      set({ zoom: Math.max(2, Math.min(200, zoom)) })
    },

    setIsPlaying(v) {
      set({ isPlaying: v })
    },

    togglePlay() {
      const { project, isPlaying } = get()
      if (!project) return
      set({ isPlaying: !isPlaying })
    },

    // ── Asset / Preview ──────────────────────────────

    bumpAssetVersion() {
      set(s => ({ assetVersion: s.assetVersion + 1 }))
    },

    setPreviewAsset(filename, type) {
      set({ previewAsset: { filename, type } })
    },

    clearPreviewAsset() {
      set({ previewAsset: null })
    },

    // ── Toggles ──────────────────────────────────────

    toggleLoopExportRange() {
      set(s => ({ loopExportRange: !s.loopExportRange }))
    },

    toggleAutoSnap() {
      set(s => ({ autoSnap: !s.autoSnap }))
    },

    setExportSettings(settings) {
      set(state => ({ exportSettings: { ...state.exportSettings, ...settings } }))
    },

    // ── Master output ────────────────────────────────

    /** Master output volume (0–1). Accepts a value or updater fn. Persisted to
     *  localStorage; PreviewPanel syncs it to audioEngine. */
    setMasterVolume(v) {
      const next = Math.max(0, Math.min(1, typeof v === 'function' ? v(get().masterVolume) : v))
      set({ masterVolume: next })
      try { localStorage.setItem('13soul.masterVolume', String(next)) } catch {}
    },

    // ── Floating preview window ───────────────────────

    /** Show/hide the floating preview. Accepts a value or updater fn. Persisted. */
    setPreviewOpen(v) {
      const next = typeof v === 'function' ? v(get().previewOpen) : !!v
      set({ previewOpen: next })
      try { localStorage.setItem('13soul.preview.open', next ? '1' : '0') } catch {}
    },
    togglePreviewOpen() {
      get().setPreviewOpen(!get().previewOpen)
    },
    /** Persist the floating preview's {x,y,w,h}. Called on drag/resize end. */
    setPreviewRect(rect) {
      set({ previewRect: rect })
      try { localStorage.setItem('13soul.preview.rect', JSON.stringify(rect)) } catch {}
    },

    // ── Derived helpers ──────────────────────────────

    getSelectedClipData() {
      const { project, selectedClip } = get()
      if (!project || !selectedClip) return null
      const track = findTrack(project.timeline, selectedClip.trackId)
      return track?.clips[selectedClip.index] ?? null
    },
  }
}
