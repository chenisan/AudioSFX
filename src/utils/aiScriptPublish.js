// Thin fetch wrappers for AI-script publish endpoints. All call sites that move
// workflow output into `clip.source` should go through here so that retry/dedupe
// behaviour stays consistent.

/**
 * Copy a workflow's terminal media URL to assets/ and return the assigned filename.
 * @returns {Promise<string | null>} filename or null on failure
 */
export async function publishWorkflowMedia({ projectId, scriptId, mediaUrl, oldSource }) {
  if (!projectId || !scriptId || !mediaUrl) return null
  try {
    const res = await fetch(
      `/api/projects/${projectId}/ai-scripts/${scriptId}/publish-media`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mediaUrl, oldSource: oldSource || undefined }),
      }
    )
    if (!res.ok) return null
    const { filename } = await res.json()
    return filename ?? null
  } catch {
    return null
  }
}

/**
 * Ask the server to inspect workflow.json, find its terminal media, and publish
 * it to assets/. Used on cold-start to backfill clip.source when the previous
 * session ended without a publish.
 * @returns {Promise<string | null>} filename or null when there is nothing to sync
 */
export async function syncWorkflowSource({ projectId, scriptId, oldSource }) {
  if (!projectId || !scriptId) return null
  try {
    const res = await fetch(
      `/api/projects/${projectId}/ai-scripts/${scriptId}/sync-source`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ oldSource: oldSource || undefined }),
      }
    )
    if (!res.ok) return null
    const { filename } = await res.json()
    return filename ?? null
  } catch {
    return null
  }
}

/**
 * Fetch the saved workflow.json for a script. Returns null when missing.
 */
export async function fetchWorkflow(projectId, scriptId) {
  if (!projectId || !scriptId) return null
  try {
    const res = await fetch(`/api/projects/${projectId}/ai-scripts/${scriptId}/workflow`)
    if (!res.ok) return null
    return await res.json()
  } catch {
    return null
  }
}
