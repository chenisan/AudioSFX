import { useCallback, useEffect, useRef, useState } from 'react'
import { useProjectStore } from '../stores/projectStore'
import { findTerminalMedia } from '../utils/findTerminalMedia'
import { fetchWorkflow, publishWorkflowMedia } from '../utils/aiScriptPublish'

// Module-level cache shared across clip instances. Key: `${projectId}/${scriptId}`.
// Persists across remounts so timeline scroll/zoom doesn't re-fetch workflow.json.
const previewCache = new Map()

/**
 * Hook for AI-script-backed video clips. Wraps:
 *   - lazy fetch of workflow.json to derive terminal media for clip preview
 *   - publish flow: copy media to assets/, set clip.source, dedupe by URL
 *   - module-level cache keyed by projectId+scriptId
 *
 * Pass falsy projectId/scriptId to disable; the hook becomes a no-op.
 *
 * @param {object} args
 * @param {string|undefined} args.projectId
 * @param {string|undefined} args.scriptId
 * @param {string} args.trackId
 * @param {number} args.index
 * @param {string|undefined} args.currentSource - clip.source (passed for oldSource cleanup)
 * @returns {{ previewMedia: { url, type } | null, publish: (media) => Promise<void> }}
 */
export function useAiScriptPublish({ projectId, scriptId, trackId, index, currentSource }) {
  const updateClip = useProjectStore(s => s.updateClip)
  const enabled = !!(projectId && scriptId)

  const [previewMedia, setPreviewMedia] = useState(() => {
    if (!enabled) return null
    return previewCache.get(`${projectId}/${scriptId}`) ?? null
  })
  const lastPublishedUrl = useRef(null)

  // Lazy-load workflow.json on mount / when (projectId, scriptId) changes.
  useEffect(() => {
    if (!enabled) return
    const key = `${projectId}/${scriptId}`
    if (previewCache.has(key)) {
      setPreviewMedia(previewCache.get(key))
      return
    }
    let cancelled = false
    fetchWorkflow(projectId, scriptId).then(wf => {
      if (cancelled) return
      const media = findTerminalMedia(wf)
      previewCache.set(key, media)
      setPreviewMedia(media)
    })
    return () => { cancelled = true }
  }, [enabled, projectId, scriptId])

  // Triggered by WorkflowEditor's onPublish callback when terminal media changes.
  const publish = useCallback(async (media) => {
    if (!enabled || !media) return
    previewCache.set(`${projectId}/${scriptId}`, media)
    setPreviewMedia(media)
    if (media.url === lastPublishedUrl.current) return
    lastPublishedUrl.current = media.url
    const filename = await publishWorkflowMedia({
      projectId, scriptId, mediaUrl: media.url, oldSource: currentSource,
    })
    if (filename) updateClip(trackId, index, { source: filename })
  }, [enabled, projectId, scriptId, trackId, index, currentSource, updateClip])

  return { previewMedia, publish }
}
