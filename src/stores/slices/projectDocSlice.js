// @ts-check
/**
 * Project document slice — owns the persisted project data (project.yaml).
 * Mutations here:
 *   - DO call `_pushUndo()` before changing state (when undoable)
 *   - DO mark `isDirty: true` so the UI shows unsaved indicator
 *   - DO NOT touch UI-only state (selection, playhead, zoom, …)
 *
 * Cross-slice rules:
 *   - Reads `state.autoSnap` (UI prefs) for clip operations — fine, same store.
 *   - Reads `state.selectedClip` to clear stale selection after deletion.
 *   - May trigger toast via `get().showToast()` from editorUISlice.
 *
 * New timeline mutation rules → first try server/core (projectManager) and
 * call REST. Local mutations only when the operation is purely visual
 * arrangement and doesn't need server-side validation.
 */
/** @typedef {import('../../../server/core/types').Project} Project */
/** @typedef {import('../../../server/core/types').VideoSegment} VideoSegment */
/** @typedef {import('../../../server/core/types').TextSegment} TextSegment */
/** @typedef {import('../../../server/core/types').AudioSegment} AudioSegment */
/** @typedef {import('../../../server/core/types').SketchClip} SketchClip */
/** @typedef {VideoSegment | TextSegment | AudioSegment | SketchClip} Segment */
import {
  findTrack, updateTrackClips, repackClips, nextTrackId,
} from '../utils'
import { ensureTimeline } from '../../utils/migration'
import { parseSRT } from '../../utils/srtParser'

export function createProjectDocSlice(set, get) {
  return {
    project: null,
    isDirty: false,

    // ── Lifecycle ────────────────────────────────────

    /** @param {Project} project */
    setProject(project) {
      const timeline = ensureTimeline(project.timeline)
      const aspectRatio = project.aspectRatio ?? '9:16'
      set({
        project: { ...project, timeline, aspectRatio },
        isDirty: false,
        selectedClip: null,
        selectedClips: [],
        playheadTime: 0,
        isPlaying: false,
        _undoStack: [],
        _redoStack: [],
      })
    },

    clearProject() {
      set({
        project: null, selectedClip: null, selectedClips: [],
        playheadTime: 0, isDirty: false, isPlaying: false,
        _undoStack: [], _redoStack: [],
      })
    },

    async updateProjectMeta(updates) {
      const { project } = get()
      if (!project) return
      set(state => ({
        project: { ...state.project, ...updates },
        isDirty: true,
      }))
      try {
        const res = await fetch(`/api/projects/${project.id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ...project, ...updates }),
        })
        if (!res.ok) throw new Error(`updateProjectMeta failed: ${res.status}`)
        const updated = await res.json()
        set({ project: updated, isDirty: false })
      } catch (e) {
        console.error('[updateProjectMeta]', e)
      }
    },

    /**
     * Set the project's export range. Pass null to reset (use contentEnd).
     * @param {{ in: number, out: number } | null} range
     */
    async setExportRange(range) {
      const { project } = get()
      if (!project) return
      set(state => ({
        project: { ...state.project, exportRange: range },
        isDirty: true,
      }))
      try {
        const res = await fetch(`/api/projects/${project.id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ...project, exportRange: range }),
        })
        if (!res.ok) throw new Error(`setExportRange failed: ${res.status}`)
        const updated = await res.json()
        set({ project: updated, isDirty: false })
      } catch (e) {
        console.error('[setExportRange]', e)
      }
    },

    // ── Track actions ────────────────────────────────

    /** @returns {Promise<string|null>} new track id (or null on failure) */
    async addTrack(type) {
      const { project } = get()
      if (!project) return null
      get()._pushUndo()
      try {
        const res = await fetch(`/api/projects/${project.id}/timeline/tracks`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ type }),
        })
        if (!res.ok) throw new Error(`addTrack failed: ${res.status}`)
        const { project: updated, trackId } = await res.json()
        set({ project: updated, isDirty: false })
        return trackId
      } catch (e) {
        console.error('[addTrack]', e)
        return null
      }
    },

    /** @returns {Promise<string|null>} new track id */
    async addTrackWithClip(type, clip) {
      const { project } = get()
      if (!project) return null
      get()._pushUndo()
      try {
        const res = await fetch(`/api/projects/${project.id}/timeline/tracks`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ type, initialClip: clip }),
        })
        if (!res.ok) throw new Error(`addTrackWithClip failed: ${res.status}`)
        const { project: updated, trackId } = await res.json()
        set({ project: updated, isDirty: false })
        return trackId
      } catch (e) {
        console.error('[addTrackWithClip]', e)
        return null
      }
    },

    /** Ensure one script track exists; return its id. Idempotent server-side. */
    async ensureScriptTrack() {
      const { project } = get()
      if (!project) return null
      // Fast path — already in local state, skip the round-trip
      const existing = project.timeline.tracks.find(t => t.type === 'script')
      if (existing) return existing.id
      try {
        const res = await fetch(`/api/projects/${project.id}/timeline/tracks/ensure-script`, {
          method: 'POST',
        })
        if (!res.ok) throw new Error(`ensureScriptTrack failed: ${res.status}`)
        const { project: updated, trackId } = await res.json()
        set({ project: updated, isDirty: false })
        return trackId
      } catch (e) {
        console.error('[ensureScriptTrack]', e)
        return null
      }
    },

    /**
     * Add a solid-color background clip on a new video track.
     * No source file; color stored as `clip.colorFill` and pre-rendered
     * to a temp .mov by ffmpegBuilder before the main filter graph runs.
     * @param {string} [color] hex color, defaults to black
     */
    /** @returns {Promise<string|null>} new track id */
    async addColorFillClip(color = '#000000') {
      const { project } = get()
      if (!project) return null
      get()._pushUndo()
      try {
        const res = await fetch(`/api/projects/${project.id}/timeline/tracks/color-fill`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ color }),
        })
        if (!res.ok) throw new Error(`addColorFillClip failed: ${res.status}`)
        const { project: updated, trackId } = await res.json()
        set({
          project: updated,
          isDirty: false,
          selectedClip: { trackId, index: 0 },
          selectedClips: [{ trackId, index: 0 }],
        })
        return trackId
      } catch (e) {
        console.error('[addColorFillClip]', e)
        return null
      }
    },

    /**
     * Drop a sticker (already imported into the project's assets/) onto a
     * dedicated "表情" video track at the current playhead time. Reuses an
     * existing 表情 track if present so consecutive drops stack on the same
     * layer; otherwise spawns a new top-of-stack overlay track.
     *
     * @param {object} params
     * @param {string} params.filename     in-project asset filename
     * @param {number} params.duration     clip duration in seconds
     * @param {object} params.overlay      { x, y, width, height, opacity } in canvas fractions
     * @param {number} params.start        timeline start time in seconds
     */
    async addStickerClip({ filename, duration, overlay, start }) {
      get()._pushUndo()

      // Optimistic update: snap the sticker into the timeline immediately so
      // the canvas doesn't blink while the PUT round-trips. We persist right
      // after — without persistence, server-side ops (Delete key, refresh,
      // export) can't see the clip and produce stale state.
      let trackId, clipIndex
      set(state => {
        const timeline = state.project.timeline
        const STICKER_TRACK_NAME = '表情'

        let track = timeline.tracks.find(t => t.type === 'video' && t.name === STICKER_TRACK_NAME)
        let tracks = timeline.tracks

        if (!track) {
          const maxOrder = Math.max(-1, ...timeline.tracks.map(t => t.order))
          track = {
            id: nextTrackId(),
            type: 'video',
            name: STICKER_TRACK_NAME,
            order: maxOrder + 1,
            clips: [],
            locked: false,
            hidden: false,
          }
          tracks = [...timeline.tracks, track]
        }

        const newClip = {
          source: filename,
          start,
          end: start + (duration ?? 1.5),
          overlay: { ...overlay },
        }

        const updatedTracks = tracks.map(t =>
          t.id === track.id ? { ...t, clips: [...(t.clips ?? []), newClip] } : t
        )
        trackId = track.id
        clipIndex = (track.clips?.length ?? 0)

        return {
          project: { ...state.project, timeline: { tracks: updatedTracks } },
          isDirty: true,
          selectedClip:  { trackId, index: clipIndex },
          selectedClips: [{ trackId, index: clipIndex }],
        }
      })

      const { project } = get()
      if (!project) return
      try {
        const res = await fetch(`/api/projects/${project.id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(project),
        })
        if (res.ok) {
          const updated = await res.json()
          set({ project: updated, isDirty: false })
        }
      } catch (e) {
        console.error('[addStickerClip persist]', e)
      }
    },

    /**
     * @param {string} srtContent
     * @param {string} [targetTrackId]
     * @returns {Promise<number>}
     */
    async importSRT(srtContent, targetTrackId) {
      const { project } = get()
      if (!project) return 0

      // Early-out: avoid a server round-trip for empty content
      const preCheck = parseSRT(srtContent)
      if (preCheck.length === 0) return 0

      get()._pushUndo()
      try {
        const res = await fetch(`/api/projects/${project.id}/timeline/import-srt`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ srtContent, trackId: targetTrackId }),
        })
        if (!res.ok) {
          const err = await res.json().catch(() => ({}))
          throw new Error(err.error || `import-srt failed: ${res.status}`)
        }
        const { project: updated, count } = await res.json()
        set({ project: updated, isDirty: false })
        return count
      } catch (e) {
        console.error('[importSRT]', e)
        return 0
      }
    },

    async removeTrack(trackId) {
      const { project } = get()
      if (!project) return
      get()._pushUndo()
      // Optimistic — drop the track + any selection that pointed at it
      set(state => {
        const timeline = state.project.timeline
        const tracks = timeline.tracks.filter(t => t.id !== trackId)
        const selected = state.selectedClip?.trackId === trackId ? null : state.selectedClip
        const selectedClips = state.selectedClips.filter(c => c.trackId !== trackId)
        return {
          project: { ...state.project, timeline: { tracks } },
          selectedClip: selected,
          selectedClips,
          isDirty: true,
        }
      })
      try {
        const res = await fetch(`/api/projects/${project.id}/timeline/tracks/${encodeURIComponent(trackId)}`, {
          method: 'DELETE',
        })
        if (!res.ok) throw new Error(`removeTrack failed: ${res.status}`)
        const updated = await res.json()
        set({ project: updated, isDirty: false })
      } catch (e) {
        console.error('[removeTrack]', e)
      }
    },

    /** Patch one track field via PATCH /tracks/:trackId. */
    async _patchTrack(trackId, patch, optimistic) {
      const { project } = get()
      if (!project) return
      // Optimistic local merge
      set(state => ({
        project: {
          ...state.project,
          timeline: {
            tracks: state.project.timeline.tracks.map(t =>
              t.id === trackId ? optimistic(t) : t
            ),
          },
        },
        isDirty: true,
      }))
      try {
        const res = await fetch(`/api/projects/${project.id}/timeline/tracks/${encodeURIComponent(trackId)}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(patch),
        })
        if (!res.ok) throw new Error(`patchTrack failed: ${res.status}`)
        const updated = await res.json()
        set({ project: updated, isDirty: false })
      } catch (e) {
        console.error('[patchTrack]', e)
      }
    },

    renameTrack(trackId, newName) {
      get()._pushUndo()
      return get()._patchTrack(trackId, { name: newName }, t => ({ ...t, name: newName }))
    },

    reorderTrack(trackId, newOrder) {
      return get()._patchTrack(trackId, { order: newOrder }, t => ({ ...t, order: newOrder }))
    },

    /** Two-track order swap via the bulk reorder endpoint (atomic). */
    async swapTrackOrder(trackId1, trackId2) {
      const { project } = get()
      if (!project) return
      const tracks = project.timeline.tracks
      const t1 = tracks.find(t => t.id === trackId1)
      const t2 = tracks.find(t => t.id === trackId2)
      if (!t1 || !t2) return
      const o1 = t1.order, o2 = t2.order
      // Optimistic swap
      set(state => ({
        project: {
          ...state.project,
          timeline: {
            tracks: state.project.timeline.tracks.map(t => {
              if (t.id === trackId1) return { ...t, order: o2 }
              if (t.id === trackId2) return { ...t, order: o1 }
              return t
            }),
          },
        },
        isDirty: true,
      }))
      try {
        const res = await fetch(`/api/projects/${project.id}/timeline/tracks/reorder`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ orderMap: [
            { trackId: trackId1, order: o2 },
            { trackId: trackId2, order: o1 },
          ] }),
        })
        if (!res.ok) throw new Error(`reorder failed: ${res.status}`)
        const updated = await res.json()
        set({ project: updated, isDirty: false })
      } catch (e) {
        console.error('[swapTrackOrder]', e)
      }
    },

    toggleTrackLocked(trackId) {
      const t = findTrack(get().project?.timeline, trackId)
      if (!t) return
      const next = !t.locked
      return get()._patchTrack(trackId, { locked: next }, x => ({ ...x, locked: next }))
    },

    toggleTrackHidden(trackId) {
      const t = findTrack(get().project?.timeline, trackId)
      if (!t) return
      const next = !t.hidden
      return get()._patchTrack(trackId, { hidden: next }, x => ({ ...x, hidden: next }))
    },

    toggleTrackMuted(trackId) {
      const t = findTrack(get().project?.timeline, trackId)
      if (!t) return
      const next = !t.muted
      return get()._patchTrack(trackId, { muted: next }, x => ({ ...x, muted: next }))
    },

    setTrackHeight(trackId, height) {
      return get()._patchTrack(trackId, { heightSize: height }, t => ({ ...t, heightSize: height }))
    },

    /** Gap mode only applies when this track renders as the main video track. */
    setTrackGapMode(trackId, mode) {
      return get()._patchTrack(trackId, { gapMode: mode }, t => ({ ...t, gapMode: mode }))
    },

    // ── Clip actions ─────────────────────────────────

    /**
     * @param {string} trackId
     * @param {Partial<Segment>} clip
     */
    async addClip(trackId, clip) {
      const { project } = get()
      if (!project) return
      const track = findTrack(project.timeline, trackId)
      if (track?.locked) return
      get()._pushUndo()

      // Optimistic: snap into local state with the same overlap rule the
      // server applies, so the clip appears immediately without flicker.
      set(state => {
        const timeline = updateTrackClips(state.project.timeline, trackId, clips => {
          const duration = clip.end - clip.start
          let start = clip.start
          const overlapping = clips.filter(c => start < c.end && (start + duration) > c.start)
          if (overlapping.length > 0) {
            start = Math.max(...overlapping.map(c => c.end))
          }
          return [...clips, { ...clip, start, end: start + duration }]
        })
        return { project: { ...state.project, timeline }, isDirty: true }
      })

      try {
        const res = await fetch(`/api/projects/${project.id}/timeline/tracks/${encodeURIComponent(trackId)}/clips`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(clip),
        })
        if (!res.ok) throw new Error(`addClip failed: ${res.status}`)
        const updated = await res.json()
        set({ project: updated, isDirty: false })
      } catch (e) {
        console.error('[addClip]', e)
      }
    },

    /**
     * Local-only clip mutation — no fetch. Use during high-frequency drags
     * (overlay move/resize, preview transforms) to avoid a PATCH per pointermove,
     * then call `updateClip` once on pointerup to persist the final value.
     *
     * @param {string} trackId
     * @param {number} index
     * @param {Partial<Segment>} updates
     */
    updateClipLocal(trackId, index, updates) {
      set(state => {
        const track = findTrack(state.project.timeline, trackId)
        if (track?.locked) return {}
        const timeline = updateTrackClips(state.project.timeline, trackId, clips => {
          clips[index] = { ...clips[index], ...updates }
          return clips
        })
        return { project: { ...state.project, timeline }, isDirty: true }
      })
    },

    /**
     * Batch-apply N clip patches in a single server round-trip. Use this when
     * multi-select fans out an attribute change (e.g. 338 字幕 toggle shadow):
     * without batching that would be 338 parallel PATCH calls and 338 disk
     * writes, plus 338 isDirty=true→false flickers in the autosave indicator.
     *
     * Mirrors updateClip's optimistic-merge-then-network shape, but in one
     * step: locally apply all patches, then POST /timeline/update-clips-batch.
     * @param {Array<{ trackId: string, index: number, updates: Partial<Segment> }>} ops
     */
    async updateClipsBatch(ops) {
      const { project } = get()
      if (!project || !Array.isArray(ops) || ops.length === 0) return

      // Drop ops targeting locked tracks (server would skip them anyway —
      // mirror the silent-skip so optimistic state stays consistent).
      const filtered = ops.filter(op => {
        const track = findTrack(project.timeline, op.trackId)
        return track && !track.locked && Number.isInteger(op.index)
      })
      if (filtered.length === 0) return

      // Optimistic local merge — group by trackId so we walk each track once.
      const byTrack = new Map()
      for (const op of filtered) {
        if (!byTrack.has(op.trackId)) byTrack.set(op.trackId, [])
        byTrack.get(op.trackId).push(op)
      }
      set(state => {
        let timeline = state.project.timeline
        for (const [trackId, opsForTrack] of byTrack) {
          timeline = updateTrackClips(timeline, trackId, clips => {
            for (const { index, updates } of opsForTrack) {
              if (clips[index]) clips[index] = { ...clips[index], ...updates }
            }
            return clips
          })
        }
        return { project: { ...state.project, timeline }, isDirty: true }
      })

      try {
        const res = await fetch(`/api/projects/${project.id}/timeline/update-clips-batch`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ops: filtered.map(op => ({
            trackId: op.trackId, clipIndex: op.index, updates: op.updates,
          })) }),
        })
        if (!res.ok) throw new Error(`updateClipsBatch failed: ${res.status}`)
        const { project: updated } = await res.json()
        if (updated) set({ project: updated, isDirty: false })
      } catch (e) {
        console.error('[updateClipsBatch]', e)
      }
    },

    /**
     * @param {string} trackId
     * @param {number} index
     * @param {Partial<Segment>} updates
     */
    async updateClip(trackId, index, updates) {
      const { project } = get()
      if (!project) return
      const track = findTrack(project.timeline, trackId)
      if (track?.locked) return

      // Optimistic local merge
      set(state => {
        const timeline = updateTrackClips(state.project.timeline, trackId, clips => {
          clips[index] = { ...clips[index], ...updates }
          return clips
        })
        return { project: { ...state.project, timeline }, isDirty: true }
      })

      try {
        const res = await fetch(`/api/projects/${project.id}/timeline/tracks/${encodeURIComponent(trackId)}/clips/${index}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(updates),
        })
        if (!res.ok) throw new Error(`updateClip failed: ${res.status}`)
        const updated = await res.json()
        set({ project: updated, isDirty: false })
      } catch (e) {
        console.error('[updateClip]', e)
      }
    },

    async removeClip(trackId, index) {
      const { project } = get()
      if (!project) return
      const track = findTrack(project.timeline, trackId)
      if (track?.locked) return
      get()._pushUndo()

      // Optimistic local removal + clear stale selection
      set(state => {
        const timeline = updateTrackClips(state.project.timeline, trackId, clips => {
          clips.splice(index, 1)
          if (state.autoSnap) repackClips(clips)
          return clips
        })
        const selected = state.selectedClip
        const newSelected =
          selected?.trackId === trackId && selected?.index === index ? null : selected
        return { project: { ...state.project, timeline }, selectedClip: newSelected, isDirty: true }
      })

      try {
        const res = await fetch(`/api/projects/${project.id}/timeline/tracks/${encodeURIComponent(trackId)}/clips/${index}`, {
          method: 'DELETE',
        })
        if (!res.ok) throw new Error(`removeClip failed: ${res.status}`)
        const updated = await res.json()
        set({ project: updated, isDirty: false })
      } catch (e) {
        console.error('[removeClip]', e)
      }
    },

    moveClip(trackId, index, newStart) {
      set(state => {
        const track = findTrack(state.project.timeline, trackId)
        if (track?.locked) return {}
        const timeline = updateTrackClips(state.project.timeline, trackId, clips => {
          const clip = clips[index]
          const duration = clip.end - clip.start
          let start = Math.max(0, newStart)
          if (state.autoSnap) {
            const others = clips.filter((_, i) => i !== index)
            const overlapping = others.filter(c => start < c.end && (start + duration) > c.start)
            if (overlapping.length > 0) {
              const dragCenter = start + duration / 2
              const nearest = overlapping.reduce((a, b) =>
                Math.abs((a.start + a.end) / 2 - dragCenter) < Math.abs((b.start + b.end) / 2 - dragCenter) ? a : b
              )
              if (dragCenter <= (nearest.start + nearest.end) / 2) {
                start = Math.max(0, Math.min(...overlapping.map(c => c.start)) - duration)
              } else {
                start = Math.max(...overlapping.map(c => c.end))
              }
            }
          }
          clips[index] = { ...clip, start, end: start + duration }
          return clips
        })
        return { project: { ...state.project, timeline }, isDirty: true }
      })
    },

    /** Atomic batch move — used by multi-clip drag. moves: Array<{trackId, index, newStart}>. */
    moveClipsBatch(moves) {
      set(state => {
        let timeline = state.project.timeline
        for (const { trackId, index, newStart } of moves) {
          const track = findTrack(timeline, trackId)
          if (track?.locked) continue
          timeline = updateTrackClips(timeline, trackId, clips => {
            const clip = clips[index]
            if (!clip) return clips
            const duration = clip.end - clip.start
            const start = Math.max(0, newStart)
            clips[index] = { ...clip, start, end: start + duration }
            return clips
          })
        }
        return { project: { ...state.project, timeline }, isDirty: true }
      })
    },

    /** Cross-track move. Called once on mouseup (not per mousemove), so REST-direct. */
    async moveClipToTrack(fromTrackId, index, toTrackId, newStart) {
      const { project } = get()
      if (!project) return
      const fromTrack = findTrack(project.timeline, fromTrackId)
      const toTrack = findTrack(project.timeline, toTrackId)
      if (!fromTrack || !toTrack) return
      if (fromTrack.type !== toTrack.type) return
      if (fromTrack.locked || toTrack.locked) return
      const clip = fromTrack.clips[index]
      if (!clip) return
      get()._pushUndo()

      try {
        const res = await fetch(`/api/projects/${project.id}/timeline/clips/move-to-track`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ fromTrackId, clipIndex: index, toTrackId, newStart }),
        })
        if (!res.ok) throw new Error(`moveClipToTrack failed: ${res.status}`)
        const { project: updated, newIndex } = await res.json()
        set({
          project: updated,
          isDirty: false,
          selectedClip: { trackId: toTrackId, index: newIndex },
        })
      } catch (e) {
        console.error('[moveClipToTrack]', e)
      }
    },

    resizeClipStart(trackId, index, newStart) {
      set(state => {
        const track = findTrack(state.project.timeline, trackId)
        if (track?.locked) return {}
        const timeline = updateTrackClips(state.project.timeline, trackId, clips => {
          const clip = clips[index]
          // Premiere/CapCut-style head trim: dragging the left edge inward
          // skips the *start* of the source content (advances trimStart),
          // dragging it outward exposes earlier source frames (decreases
          // trimStart). Without this, the timeline span shrank but trimStart
          // stayed at 0, so the renderer still played source[0..N] —
          // looking like the END of the source got cut, not the start.
          const oldTrimStart = clip.trimStart ?? 0
          // speed scales how much source 1 timeline second covers, so
          // timeline↔source conversions throughout this function multiply by
          // speed. Default 1 = identity.
          const speed = clip.speed ?? 1
          // Clamp left: can't drag further left than what's available before
          // trimStart hits zero (in timeline seconds = oldTrimStart/speed).
          // Clamp right: keep at least 0.5s of clip and, when trimEnd is
          // explicit (post-split), keep trimStart strictly below trimEnd.
          // Without the trimEnd guard, dragging the left edge far inward on a
          // split half lets trimStart pass trimEnd and ffmpeg gets
          // `trim=start=X:end=Y` with Y<X — output is empty, that span
          // renders as black on the timeline.
          const minStart = Math.max(0, clip.start - oldTrimStart / speed)
          const trimEpsilon = 0.05
          let maxStart = clip.end - 0.5
          if (typeof clip.trimEnd === 'number') {
            // newTrimStart = oldTrimStart + (start - clip.start)*speed ≤ trimEnd - eps
            // → start ≤ clip.start + (trimEnd - eps - oldTrimStart) / speed
            const trimCap = clip.start + (clip.trimEnd - trimEpsilon - oldTrimStart) / speed
            maxStart = Math.min(maxStart, trimCap)
          }
          const start = Math.max(minStart, Math.min(newStart, maxStart))
          const delta = start - clip.start
          const trimStart = Math.max(0, oldTrimStart + delta * speed)
          // trimEnd anchors the end of the source playback window. When the
          // left edge moves on the timeline the END of the source window
          // shouldn't shift — only the start. So leave trimEnd alone.
          clips[index] = { ...clip, start, trimStart }
          if (state.autoSnap) repackClips(clips, index)
          return clips
        })
        return { project: { ...state.project, timeline }, isDirty: true }
      })
    },

    resizeClipEnd(trackId, index, newEnd) {
      set(state => {
        const track = findTrack(state.project.timeline, trackId)
        if (track?.locked) return {}
        const timeline = updateTrackClips(state.project.timeline, trackId, clips => {
          const clip = clips[index]
          // Cap the timeline end to the playable source length so users can't
          // drag a video clip beyond its actual content. trimStart shifts the
          // playable window into the source, so subtract it from sourceDuration.
          // Image clips (no sourceDuration) and unknown-duration clips stay
          // unbounded — image content can extend arbitrarily.
          // When trimEnd is explicit (post-split half), the source window is
          // [trimStart, trimEnd] regardless of sourceDuration — cap to that
          // window so the timeline stays in sync with the trim range. Without
          // this, the timeline can grow past the trimmed window and the
          // renderer plays only up to trimEnd, leaving a black tail.
          // speed≠1 compresses/stretches source onto timeline, so the playable
          // *timeline* range = playable_source / speed.
          const trimStart = clip.trimStart ?? 0
          const speed = clip.speed ?? 1
          let playableSource = null
          if (typeof clip.trimEnd === 'number') {
            playableSource = clip.trimEnd - trimStart
          } else if (typeof clip.sourceDuration === 'number') {
            playableSource = clip.sourceDuration - trimStart
          }
          const minEnd = clip.start + 0.5
          const maxEnd = playableSource != null ? clip.start + playableSource / speed : Infinity
          const end = Math.min(maxEnd, Math.max(minEnd, newEnd))
          clips[index] = { ...clip, end }
          if (state.autoSnap) repackClips(clips, index)
          return clips
        })
        return { project: { ...state.project, timeline }, isDirty: true }
      })
    },

    // ── REST-backed timeline ops (split / delete halves / duplicate / batch remove / paste) ──

    /** Server delegates trimEnd recomputation + fadeIn/fadeOut redistribution. */
    /** @returns {Promise<void>} */
    async splitClipAtPlayhead() {
      const { selectedClip, playheadTime, project } = get()
      if (!project || !selectedClip) return
      const track = findTrack(project.timeline, selectedClip.trackId)
      if (!track || track.locked) return
      const clip = track.clips[selectedClip.index]
      if (!clip) return
      if (playheadTime <= clip.start || playheadTime >= clip.end) return

      get()._pushUndo()
      try {
        const res = await fetch(`/api/projects/${project.id}/timeline/split-clip`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            trackId: selectedClip.trackId,
            clipIndex: selectedClip.index,
            atTime: playheadTime,
          }),
        })
        if (!res.ok) {
          const err = await res.json().catch(() => ({}))
          throw new Error(err.error || `split-clip failed: ${res.status}`)
        }
        const updated = await res.json()
        set({
          project: updated,
          isDirty: false,
          selectedClip: { trackId: selectedClip.trackId, index: selectedClip.index + 1 },
          // Nudge the playhead 10ms into the right half so the user can
          // press split again immediately. Without this the playhead sits
          // exactly on the new clip's `start`, the guard above (`playheadTime
          // <= clip.start`) bails, and split appears to be "one-shot only".
          // Clamp to the new clip's end so a near-zero-width split doesn't
          // overshoot.
          playheadTime: Math.min(playheadTime + 0.01, clip.end - 0.001),
        })
      } catch (e) {
        console.error('[splitClipAtPlayhead]', e)
      }
    },

    /** @returns {Promise<void>} */
    async deleteLeftAtPlayhead() {
      const { selectedClip, playheadTime, project } = get()
      if (!project || !selectedClip) return
      const track = findTrack(project.timeline, selectedClip.trackId)
      if (!track || track.locked) return
      const clip = track.clips[selectedClip.index]
      if (!clip) return
      if (playheadTime <= clip.start || playheadTime >= clip.end) return

      get()._pushUndo()
      try {
        const res = await fetch(`/api/projects/${project.id}/timeline/delete-left-at-playhead`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ trackId: selectedClip.trackId, clipIndex: selectedClip.index, atTime: playheadTime }),
        })
        if (!res.ok) {
          const err = await res.json().catch(() => ({}))
          throw new Error(err.error || `delete-left-at-playhead failed: ${res.status}`)
        }
        const updated = await res.json()
        set({ project: updated, isDirty: false })
      } catch (e) {
        console.error('[deleteLeftAtPlayhead]', e)
      }
    },

    /** @returns {Promise<void>} */
    async deleteRightAtPlayhead() {
      const { selectedClip, playheadTime, project } = get()
      if (!project || !selectedClip) return
      const track = findTrack(project.timeline, selectedClip.trackId)
      if (!track || track.locked) return
      const clip = track.clips[selectedClip.index]
      if (!clip) return
      if (playheadTime <= clip.start || playheadTime >= clip.end) return

      get()._pushUndo()
      try {
        const res = await fetch(`/api/projects/${project.id}/timeline/delete-right-at-playhead`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ trackId: selectedClip.trackId, clipIndex: selectedClip.index, atTime: playheadTime }),
        })
        if (!res.ok) {
          const err = await res.json().catch(() => ({}))
          throw new Error(err.error || `delete-right-at-playhead failed: ${res.status}`)
        }
        const updated = await res.json()
        set({ project: updated, isDirty: false })
      } catch (e) {
        console.error('[deleteRightAtPlayhead]', e)
      }
    },

    /** @returns {Promise<void>} */
    async duplicateClip() {
      const { selectedClip, project } = get()
      if (!project || !selectedClip) return
      const track = findTrack(project.timeline, selectedClip.trackId)
      if (!track || track.locked) return
      if (!track.clips[selectedClip.index]) return

      get()._pushUndo()
      try {
        const res = await fetch(`/api/projects/${project.id}/timeline/duplicate-clip`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ trackId: selectedClip.trackId, clipIndex: selectedClip.index }),
        })
        if (!res.ok) {
          const err = await res.json().catch(() => ({}))
          throw new Error(err.error || `duplicate-clip failed: ${res.status}`)
        }
        const updated = await res.json()
        set({
          project: updated,
          isDirty: false,
          selectedClip: { trackId: selectedClip.trackId, index: selectedClip.index + 1 },
        })
      } catch (e) {
        console.error('[duplicateClip]', e)
      }
    },

    /**
     * Delete every currently-selected clip (primary + multi-select) in one pass.
     * Server groups by track + splices in descending index order.
     */
    /** @returns {Promise<void>} */
    async removeSelectedClips() {
      const { project, selectedClips, selectedClip } = get()
      if (!project) return
      const all = selectedClips.length > 0
        ? selectedClips
        : (selectedClip ? [selectedClip] : [])
      if (all.length === 0) return

      get()._pushUndo()
      try {
        const refs = all.map(sel => ({ trackId: sel.trackId, clipIndex: sel.index }))
        const res = await fetch(`/api/projects/${project.id}/timeline/remove-clips`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ refs }),
        })
        if (!res.ok) {
          const err = await res.json().catch(() => ({}))
          throw new Error(err.error || `remove-clips failed: ${res.status}`)
        }
        const updated = await res.json()
        set({ project: updated, isDirty: false, selectedClip: null, selectedClips: [] })
      } catch (e) {
        console.error('[removeSelectedClips]', e)
      }
    },

    /**
     * Paste clipboard at the given time on the given track. Type-mismatched
     * tracks return false. Auto-selects the pasted clips on success.
     * @param {string} trackId
     * @param {number} time
     * @returns {Promise<boolean>}
     */
    async pasteClipsAt(trackId, time) {
      const { project, clipboard } = get()
      if (!project || !clipboard || clipboard.clips.length === 0) return false
      const track = findTrack(project.timeline, trackId)
      if (!track) return false
      if (track.locked) {
        get().showToast('軌道已鎖定，無法貼上', 'warn')
        return false
      }
      if (track.type !== clipboard.trackType) {
        const typeLabel = { video: '影片', audio: '音訊', text: '文字' }
        get().showToast(`無法貼到${typeLabel[track.type] ?? track.type}軌（剪貼簿是${typeLabel[clipboard.trackType] ?? clipboard.trackType}）`, 'warn')
        return false
      }

      get()._pushUndo()
      try {
        const res = await fetch(`/api/projects/${project.id}/timeline/paste-clips`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ trackId, atTime: time, clips: clipboard.clips }),
        })
        if (!res.ok) {
          const err = await res.json().catch(() => ({}))
          throw new Error(err.error || `paste-clips failed: ${res.status}`)
        }
        const updated = await res.json()
        const firstNewIndex = track.clips.length
        set({ project: updated, isDirty: false })
        const newSelection = clipboard.clips.map((_, i) => ({
          trackId, index: firstNewIndex + i,
        }))
        if (newSelection.length > 0) {
          set({ selectedClip: newSelection[newSelection.length - 1], selectedClips: newSelection })
        }
        return true
      } catch (e) {
        console.error('[pasteClipsAt]', e)
        return false
      }
    },

    // ── Precision trim (I/O point) ───────────────────

    /** I-point: shift clip start to playhead, keep playable window via trimStart. */
    setInPoint(trackId, index, playheadTime) {
      const { project } = get()
      if (!project) return
      const track = findTrack(project.timeline, trackId)
      const clip = track?.clips[index]
      if (!clip) return
      if (playheadTime <= clip.start || playheadTime >= clip.end) return
      const offset = playheadTime - clip.start
      const updates = {
        start: playheadTime,
        trimStart: (clip.trimStart ?? 0) + offset,
      }
      get()._pushUndo()
      return get().updateClip(trackId, index, updates)
    },

    /** O-point: clamp clip end to playhead. */
    setOutPoint(trackId, index, playheadTime) {
      const { project } = get()
      if (!project) return
      const track = findTrack(project.timeline, trackId)
      const clip = track?.clips[index]
      if (!clip) return
      if (playheadTime <= clip.start || playheadTime >= clip.end) return
      get()._pushUndo()
      return get().updateClip(trackId, index, { end: playheadTime })
    },

    // ── Drag commit ─────────────────────────────────────
    //
    // moveClip / moveClipsBatch / resizeClipStart / resizeClipEnd run on every
    // mousemove — they keep mutations local to avoid a fetch storm. The drag
    // handler calls commitDragChanges(refs) once on mouseup to persist the
    // final positions via the batch endpoint.
    /** @param {{trackId: string, index: number}[]} refs */
    async commitDragChanges(refs) {
      const { project } = get()
      if (!project || !refs || refs.length === 0) return
      const ops = []
      for (const ref of refs) {
        const track = findTrack(project.timeline, ref.trackId)
        const clip = track?.clips[ref.index]
        if (!clip) continue
        ops.push({
          trackId: ref.trackId,
          clipIndex: ref.index,
          updates: { start: clip.start, end: clip.end },
        })
      }
      if (ops.length === 0) return
      try {
        const res = await fetch(`/api/projects/${project.id}/timeline/update-clips-batch`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ops }),
        })
        if (!res.ok) throw new Error(`commitDragChanges failed: ${res.status}`)
        const { project: updated } = await res.json()
        set({ project: updated, isDirty: false })
      } catch (e) {
        console.error('[commitDragChanges]', e)
      }
    },

    // ── UI folder grouping (asset / script / sketch / track) ──────────────
    // Thin wrappers around POST/PATCH/DELETE /api/projects/:id/folders/:ns/*.
    // Each call replaces project from server response (folders mutate
    // project.folderGroups; updatedAt bumps; SSE will echo, dedup by useProject).
    // No undo entries — these are organisational metadata, not edits.

    /** @returns {Promise<{id, name, itemIds, collapsed?} | null>} new folder, or null on failure */
    async createFolder(ns, name) {
      const { project } = get()
      if (!project) return null
      try {
        const res = await fetch(`/api/projects/${project.id}/folders/${ns}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name }),
        })
        if (!res.ok) throw new Error(`createFolder failed: ${res.status}`)
        const { project: updated, folder } = await res.json()
        set({ project: updated })
        return folder
      } catch (e) {
        console.error('[createFolder]', e)
        return null
      }
    },

    async renameFolder(ns, folderId, name) {
      const { project } = get()
      if (!project) return
      try {
        const res = await fetch(`/api/projects/${project.id}/folders/${ns}/${folderId}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name }),
        })
        if (!res.ok) throw new Error(`renameFolder failed: ${res.status}`)
        const updated = await res.json()
        set({ project: updated })
      } catch (e) {
        console.error('[renameFolder]', e)
      }
    },

    async deleteFolder(ns, folderId) {
      const { project } = get()
      if (!project) return
      try {
        const res = await fetch(`/api/projects/${project.id}/folders/${ns}/${folderId}`, {
          method: 'DELETE',
        })
        if (!res.ok) throw new Error(`deleteFolder failed: ${res.status}`)
        const updated = await res.json()
        set({ project: updated })
      } catch (e) {
        console.error('[deleteFolder]', e)
      }
    },

    /** folderId === null means "remove from any folder" (back to 未分類). */
    async moveItemToFolder(ns, itemId, folderId) {
      const { project } = get()
      if (!project) return
      try {
        const res = await fetch(`/api/projects/${project.id}/folders/${ns}/move-item`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ itemId, folderId }),
        })
        if (!res.ok) throw new Error(`moveItemToFolder failed: ${res.status}`)
        const updated = await res.json()
        set({ project: updated })
      } catch (e) {
        console.error('[moveItemToFolder]', e)
      }
    },

    /**
     * Bulk move. Pass either folderId (move to existing) or createFolderName
     * (create new folder + move into it atomically). folderId === null means
     * remove from any folder (uncategorise).
     * @returns {Promise<{id, name, itemIds, collapsed?} | null>} the target
     *   folder (newly created or existing), or null if uncategorising.
     */
    async moveItemsToFolder(ns, itemIds, { folderId = null, createFolderName } = {}) {
      const { project } = get()
      if (!project || !itemIds?.length) return null
      try {
        const body = createFolderName
          ? { itemIds, createFolderName }
          : { itemIds, folderId }
        const res = await fetch(`/api/projects/${project.id}/folders/${ns}/move-items`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        })
        if (!res.ok) throw new Error(`moveItemsToFolder failed: ${res.status}`)
        const { project: updated, folder } = await res.json()
        set({ project: updated })
        return folder
      } catch (e) {
        console.error('[moveItemsToFolder]', e)
        return null
      }
    },

    async setFolderCollapsed(ns, folderId, collapsed) {
      const { project } = get()
      if (!project) return
      // Optimistic — collapse is purely visual, snap UI immediately.
      set(state => {
        const groups = state.project?.folderGroups
        const list = groups?.[ns]
        const folder = list?.find(f => f.id === folderId)
        if (!folder) return {}
        return {
          project: {
            ...state.project,
            folderGroups: {
              ...groups,
              [ns]: list.map(f => f.id === folderId ? { ...f, collapsed: !!collapsed } : f),
            },
          },
        }
      })
      try {
        const res = await fetch(`/api/projects/${project.id}/folders/${ns}/${folderId}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ collapsed }),
        })
        if (!res.ok) throw new Error(`setFolderCollapsed failed: ${res.status}`)
      } catch (e) {
        console.error('[setFolderCollapsed]', e)
      }
    },
  }
}
