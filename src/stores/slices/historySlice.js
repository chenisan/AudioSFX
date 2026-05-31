// @ts-check
/**
 * History slice — owns undo/redo stacks. Snapshots project.timeline ONLY,
 * never UI state (selection, playhead, etc.).
 *
 * Other slices push undo by calling `get()._pushUndo()` BEFORE mutating
 * the timeline. The convention `_pushUndo()` (private) vs `pushUndo()`
 * (public) exists so JSDoc-checked callers get a clear surface.
 */
import { cloneTimeline, MAX_UNDO } from '../utils'

export function createHistorySlice(set, get) {
  return {
    _undoStack: [],
    _redoStack: [],

    _pushUndo() {
      const { project, _undoStack } = get()
      if (!project) return
      const snapshot = cloneTimeline(project.timeline)
      const stack = [..._undoStack, snapshot]
      if (stack.length > MAX_UNDO) stack.shift()
      set({ _undoStack: stack, _redoStack: [] })
    },

    /** Public: call before a drag/edit operation begins to save undo snapshot. */
    pushUndo() {
      get()._pushUndo()
    },

    undo() {
      const { project, _undoStack, _redoStack } = get()
      if (!project || _undoStack.length === 0) return
      const stack = [..._undoStack]
      const prev = stack.pop()
      const redoSnapshot = cloneTimeline(project.timeline)
      set({
        project: { ...project, timeline: prev },
        _undoStack: stack,
        _redoStack: [..._redoStack, redoSnapshot],
        isDirty: true,
        selectedClip: null,
        selectedClips: [],
      })
    },

    redo() {
      const { project, _undoStack, _redoStack } = get()
      if (!project || _redoStack.length === 0) return
      const stack = [..._redoStack]
      const next = stack.pop()
      const undoSnapshot = cloneTimeline(project.timeline)
      set({
        project: { ...project, timeline: next },
        _undoStack: [..._undoStack, undoSnapshot],
        _redoStack: stack,
        isDirty: true,
        selectedClip: null,
      })
    },
  }
}
