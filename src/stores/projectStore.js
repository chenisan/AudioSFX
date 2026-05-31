// @ts-check
/**
 * Composed store. Slices live in ./slices/ — each owns a coherent group of
 * state + actions. They share the same zustand store via (set, get) so any
 * slice can read or write any state, but the file boundaries enforce the
 * intended ownership:
 *
 *   - projectDocSlice    : project document (timeline, tracks, clips, exportRange)
 *   - editorUISlice      : selection, playhead, zoom, transient UI state
 *   - historySlice       : undo / redo stacks
 *
 * See ./slices/<name>.js headers for what belongs in each + when to call
 * `_pushUndo()`. CLAUDE.md "協作治理守則" #4 also documents the rules.
 *
 * Re-exports ASPECT_RATIOS / EXPORT_RESOLUTIONS from utils so existing
 * `import { ASPECT_RATIOS } from '../../stores/projectStore'` paths still work.
 */
import { create } from 'zustand'
import { createProjectDocSlice } from './slices/projectDocSlice'
import { createEditorUISlice } from './slices/editorUISlice'
import { createHistorySlice } from './slices/historySlice'

export { ASPECT_RATIOS, EXPORT_RESOLUTIONS } from './utils'

export const useProjectStore = create((set, get) => ({
  ...createHistorySlice(set, get),
  ...createProjectDocSlice(set, get),
  ...createEditorUISlice(set, get),
}))
