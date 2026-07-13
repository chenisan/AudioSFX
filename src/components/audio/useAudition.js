import { useCallback, useEffect, useRef, useState } from 'react'

// Keyboard audition for a file list: ↑/↓ moves a cursor and auto-plays the
// selected item, Space toggles play/pause, Enter fires onEnter (e.g.＋軌).
// The list container must be focusable (tabIndex) and spread {listRef, onKeyDown};
// each row needs data-idx={i} so the cursor can be scrolled into view.
//
//   play(item, true)  → always (re)start (used by ↑/↓ stepping)
//   play(item)        → toggle (used by Space and the ▶ button)
//
// `cap` matches the list's render slice so the cursor never points past a
// non-rendered row (no DOM node to scroll to).
export function useAudition(files, play, { cap = 600, onEnter } = {}) {
  const [cursor, setCursor] = useState(-1)
  const listRef = useRef(null)

  // Reset when the visible set changes (folder switch / search / rescan).
  useEffect(() => { setCursor(-1) }, [files])

  const step = useCallback((delta) => {
    setCursor(prev => {
      const max = Math.min(files.length, cap) - 1
      if (max < 0) return -1
      const next = prev < 0 ? (delta > 0 ? 0 : max)
        : Math.min(max, Math.max(0, prev + delta))
      const item = files[next]
      if (item) {
        play(item, true)
        requestAnimationFrame(() => {
          listRef.current?.querySelector(`[data-idx="${next}"]`)?.scrollIntoView({ block: 'nearest' })
        })
      }
      return next
    })
  }, [files, play, cap])

  const onKeyDown = useCallback((e) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); step(1) }
    else if (e.key === 'ArrowUp') { e.preventDefault(); step(-1) }
    else if (e.key === ' ') { e.preventDefault(); const it = files[cursor]; if (it) play(it) }
    else if (e.key === 'Enter') { e.preventDefault(); const it = files[cursor]; if (it && onEnter) onEnter(it) }
  }, [step, files, cursor, play, onEnter])

  // Call from a row click so ↑/↓ continues from the clicked item.
  const focusAt = useCallback((i) => { setCursor(i); listRef.current?.focus() }, [])

  return { cursor, setCursor, listRef, onKeyDown, focusAt }
}
