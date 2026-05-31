import { useEffect } from 'react'
import { useProjectStore } from '../stores/projectStore'

/**
 * Global keyboard shortcuts for the editor.
 *
 * Space       — play / pause
 * ←           — step back 1 frame (~1/30s)
 * →           — step forward 1 frame
 * J           — step back 5s
 * L           — step forward 5s
 * K           — stop (pause)
 * S           — split clip at playhead
 * D           — duplicate selected clip
 * Q           — delete left part at playhead
 * W           — delete right part at playhead
 * N           — toggle auto-snap (magnetic)
 * Ctrl+Z      — undo
 * Ctrl+Shift+Z / Ctrl+Y — redo
 * Ctrl+C      — copy selected clips (preserves relative offsets, type-locked)
 * Ctrl+V      — paste at the track/time under the mouse cursor
 * I           — set in-point
 * O           — set out-point
 * Delete/Backspace — remove selected clip
 */
export function useKeyboardShortcuts() {
  useEffect(() => {
    const handler = (e) => {
      // Ignore when typing in an input/textarea
      const tag = document.activeElement?.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return

      const {
        project, selectedClip, selectedClips, playheadTime,
        setPlayheadTime, setIsPlaying, isPlaying, togglePlay,
        setInPoint, setOutPoint, removeSelectedClips,
        splitClipAtPlayhead, duplicateClip,
        deleteLeftAtPlayhead, deleteRightAtPlayhead,
        toggleAutoSnap, undo, redo,
        copySelectedClips, pasteClipsAt, lastCursor, clipboard,
      } = useProjectStore.getState()

      if (!project) return

      // Ctrl/Cmd shortcuts
      if (e.ctrlKey || e.metaKey) {
        if (e.code === 'KeyZ' && e.shiftKey) { e.preventDefault(); redo(); return }
        if (e.code === 'KeyZ') { e.preventDefault(); undo(); return }
        if (e.code === 'KeyY') { e.preventDefault(); redo(); return }
        if (e.code === 'KeyC') {
          if (copySelectedClips()) e.preventDefault()
          return
        }
        if (e.code === 'KeyV') {
          if (!clipboard) return
          // Prefer the track under the cursor; fall back to the clipboard's own
          // track type paired with the current playhead if the mouse never
          // hovered a compatible track.
          if (lastCursor) {
            if (pasteClipsAt(lastCursor.trackId, lastCursor.time)) e.preventDefault()
            return
          }
          const firstMatch = project.timeline.tracks.find(t => t.type === clipboard.trackType)
          if (firstMatch) {
            pasteClipsAt(firstMatch.id, playheadTime)
            e.preventDefault()
          }
          return
        }
      }

      switch (e.code) {
        case 'Space':
          e.preventDefault()
          togglePlay()
          break

        case 'ArrowLeft':
          e.preventDefault()
          setIsPlaying(false)
          setPlayheadTime(playheadTime - (e.shiftKey ? 1 : 1 / 30))
          break

        case 'ArrowRight':
          e.preventDefault()
          setIsPlaying(false)
          setPlayheadTime(playheadTime + (e.shiftKey ? 1 : 1 / 30))
          break

        case 'KeyJ':
          setIsPlaying(false)
          setPlayheadTime(playheadTime - 5)
          break

        case 'KeyL':
          setIsPlaying(false)
          setPlayheadTime(playheadTime + 5)
          break

        case 'KeyK':
          setIsPlaying(false)
          break

        case 'KeyI':
          if (selectedClip) {
            setInPoint(selectedClip.trackId, selectedClip.index, playheadTime)
          }
          break

        case 'KeyO':
          if (selectedClip) {
            setOutPoint(selectedClip.trackId, selectedClip.index, playheadTime)
          }
          break

        case 'KeyS':
          if (selectedClip) {
            e.preventDefault()
            splitClipAtPlayhead()
          }
          break

        case 'KeyD':
          if (selectedClip) {
            e.preventDefault()
            duplicateClip()
          }
          break

        case 'KeyQ':
          if (selectedClip) {
            e.preventDefault()
            deleteLeftAtPlayhead()
          }
          break

        case 'KeyW':
          if (selectedClip) {
            e.preventDefault()
            deleteRightAtPlayhead()
          }
          break

        case 'KeyN':
          e.preventDefault()
          toggleAutoSnap()
          break

        case 'Delete':
        case 'Backspace':
          // Always swallow the key so Backspace can't trigger browser back-nav
          // even when there's nothing selected — the timeline owns this shortcut.
          e.preventDefault()
          if (selectedClip || selectedClips.length > 0) removeSelectedClips()
          break
      }
    }

    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [])
}
