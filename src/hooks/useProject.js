import { useProjectStore } from '../stores/projectStore'
import { syncWorkflowSource } from '../utils/aiScriptPublish'

// Singleton EventSource for project change notifications. The server emits
// a 'changed' event whenever writeProject() runs (REST PUT, MCP tool, etc.).
// Front-end dedups self-echoes by comparing updatedAt against the local store,
// and skips auto-reload when the user has unsaved local edits (isDirty).
let projectEventSource = null
let subscribedProjectId = null

// Set of updatedAt values we've seen on our own PATCH/PUT responses. Used to
// dedup SSE self-echoes when multiple writes are in flight (e.g. rapid slider
// onChange) and the simple `local.updatedAt === remoteUpdatedAt` check would
// race: PATCH N+1's SSE arrives while local is already past N+1's stamp, so
// equality fails and the page mistakenly auto-reloads — which clobbers
// selection via setProject. Bounded to avoid unbounded memory growth.
const ownUpdatedAts = new Set()
const OWN_UPDATEDAT_MAX = 64
function rememberOwnUpdatedAt(updatedAt) {
  if (!updatedAt) return
  ownUpdatedAts.add(updatedAt)
  while (ownUpdatedAts.size > OWN_UPDATEDAT_MAX) {
    const first = ownUpdatedAts.values().next().value
    ownUpdatedAts.delete(first)
  }
}
let storeUnsub = null
function ensureStoreSubscription() {
  if (storeUnsub) return
  // Track every project.updatedAt that lands in the store, regardless of which
  // mutator wrote it (PATCH, PUT, batch, etc.) — covers all mutation paths
  // without per-action plumbing.
  let last = useProjectStore.getState().project?.updatedAt
  rememberOwnUpdatedAt(last)
  storeUnsub = useProjectStore.subscribe((state) => {
    const cur = state.project?.updatedAt
    if (cur && cur !== last) {
      last = cur
      rememberOwnUpdatedAt(cur)
    }
  })
}

function unsubscribeProjectEvents() {
  if (projectEventSource) {
    projectEventSource.close()
    projectEventSource = null
  }
  subscribedProjectId = null
}

function subscribeProjectEvents(projectId) {
  ensureStoreSubscription()
  if (subscribedProjectId === projectId && projectEventSource) return
  unsubscribeProjectEvents()
  subscribedProjectId = projectId
  const es = new EventSource(`/api/projects/${projectId}/events`)
  es.onmessage = (e) => {
    let data
    try { data = JSON.parse(e.data) } catch { return }
    if (data?.type !== 'changed') return
    handleExternalProjectChange(projectId, data.updatedAt)
  }
  es.onerror = () => {
    // EventSource auto-reconnects on transient errors; we only clean up if
    // the connection is permanently closed (readyState 2 = CLOSED).
    if (es.readyState === 2) {
      if (projectEventSource === es) projectEventSource = null
    }
  }
  projectEventSource = es
}

async function handleExternalProjectChange(projectId, remoteUpdatedAt) {
  // Fast-path self-echo dedup: SSE arrives in the middle of writeProject() on
  // the server (before the REST response returns), so this often runs before
  // the matching PATCH/PUT response has bumped local state. Track every
  // updatedAt we've put in the store and skip if this stamp is one of ours.
  // Without this, rapid slider drags fire dozens of overlapping PATCHes and
  // a stray "external change" reload nukes selection mid-drag.
  if (ownUpdatedAts.has(remoteUpdatedAt)) return
  // Defer slightly: server emits SSE inside writeProject() — that fires before
  // the REST response (PUT/POST) reaches us, so the store's updatedAt and
  // isDirty haven't caught up yet. 200ms is enough for typical loopback latency,
  // but unnoticeable for genuine external (MCP) changes.
  await new Promise(r => setTimeout(r, 200))
  if (ownUpdatedAts.has(remoteUpdatedAt)) return
  const state = useProjectStore.getState()
  const local = state.project
  if (!local || local.id !== projectId) return
  // Self-echo dedup: front-end's own PUT just round-tripped, store already current.
  if (local.updatedAt === remoteUpdatedAt) return
  // Don't trample the user's unsaved edits.
  if (state.isDirty) {
    state.showToast?.('專案有外部修改，但你有未儲存的變更，請手動重整', 'warn')
    return
  }
  try {
    const res = await fetch(`/api/projects/${projectId}`)
    if (!res.ok) return
    const p = await res.json()
    // Re-check: user may have switched projects during the fetch.
    const latest = useProjectStore.getState()
    if (latest.project?.id !== projectId) return
    latest.setProject(p)
  } catch {}
}

/**
 * After a project loads, walk every video clip with an `aiScriptRef` and ask the
 * server whether its workflow.json has a terminal media that is not yet reflected
 * in `clip.source`. Runs in the background; clips are re-located by `aiScriptRef`
 * before writing so concurrent edits do not corrupt state.
 *
 * Dedup by scriptId — duplicating a clip leaves two timeline clips pointing at
 * the same aiScriptRef. Publishing N times in parallel races over the same
 * media file (two copies land in assets/, meta.json gets the last writer).
 * We publish once per script and then patch every clip referencing it.
 */
async function syncAiScriptSources(project) {
  const tracks = project?.timeline?.tracks
  if (!tracks?.length) return

  // scriptId → oldSource (use the first clip's source as the publish hint;
  // server uses it to clean up the previous asset)
  const byScript = new Map()
  for (const track of tracks) {
    if (track.type !== 'video') continue
    for (const clip of track.clips) {
      if (!clip.aiScriptRef) continue
      if (!byScript.has(clip.aiScriptRef)) {
        byScript.set(clip.aiScriptRef, clip.source || undefined)
      }
    }
  }
  if (byScript.size === 0) return

  await Promise.all(Array.from(byScript.entries()).map(async ([scriptId, oldSource]) => {
    const filename = await syncWorkflowSource({
      projectId: project.id,
      scriptId,
      oldSource,
    })
    if (!filename || filename === oldSource) return

    // Patch every clip that still references this scriptId in the latest store.
    // Sequential within a script so optimistic merges chain cleanly.
    const state = useProjectStore.getState()
    const tl = state.project?.timeline
    if (!tl || state.project.id !== project.id) return
    for (const tr of tl.tracks) {
      if (tr.type !== 'video') continue
      for (let idx = 0; idx < tr.clips.length; idx++) {
        const c = tr.clips[idx]
        if (c.aiScriptRef !== scriptId) continue
        if (c.source === filename) continue
        await state.updateClip(tr.id, idx, { source: filename })
      }
    }
  }))
}

/**
 * One-shot backfill of clip.sourceDuration on project load. Pre-AI-publish
 * code paths (one-click pipeline, batch generators) created clips without
 * sourceDuration; the resize-end clamp then fell back to Infinity, letting
 * the user drag the clip's right edge forever past the actual playable
 * content. New publishes set this field correctly via publishMediaToAssets;
 * this function repairs old projects in place.
 *
 * Cheap: reuses the cached /assets endpoint (mtime-keyed ffprobe cache on
 * the server), so a second project load is essentially free.
 */
async function backfillSourceDurations(project) {
  const tracks = project?.timeline?.tracks
  if (!tracks?.length) return

  // Collect missing-duration clips; bail early if nothing to fix.
  const missing = []
  for (const track of tracks) {
    if (track.type !== 'video' && track.type !== 'audio') continue
    track.clips.forEach((clip, idx) => {
      if (!clip.source) return
      if (typeof clip.sourceDuration === 'number') return
      missing.push({ trackId: track.id, index: idx, source: clip.source })
    })
  }
  if (missing.length === 0) return

  let assetMap = null
  try {
    const res = await fetch(`/api/projects/${project.id}/assets`)
    if (!res.ok) return
    const list = await res.json()
    assetMap = new Map(list.map(a => [a.filename, a.duration]))
  } catch { return }
  if (!assetMap) return

  // Re-resolve clip indices via current store state (timeline may have moved
  // by the time fetch returns) and update only those that still match.
  const state = useProjectStore.getState()
  const tl = state.project?.timeline
  if (!tl || state.project.id !== project.id) return

  for (const m of missing) {
    const dur = assetMap.get(m.source)
    if (typeof dur !== 'number' || dur <= 0) continue
    const tr = tl.tracks.find(x => x.id === m.trackId)
    if (!tr) continue
    const c = tr.clips[m.index]
    if (!c || c.source !== m.source) continue
    if (typeof c.sourceDuration === 'number') continue
    state.updateClip(m.trackId, m.index, { sourceDuration: dur })
  }
}

export function useProject() {
  // Narrowed — useProject is consumed by ~10 components (Header, AssetPanel,
  // App, …); the old `s => s.project` subscription forced every consumer to
  // re-render on any clip mutation. saveProject + deleteProject read the
  // full project at CALL time via store.getState() so we don't have to
  // subscribe to it just to keep the closure fresh.
  const isDirty = useProjectStore(s => s.isDirty)
  const setProject = useProjectStore(s => s.setProject)
  const clearProject = useProjectStore(s => s.clearProject)
  const updateProjectMeta = useProjectStore(s => s.updateProjectMeta)

  async function fetchProjects() {
    const res = await fetch('/api/projects')
    if (!res.ok) throw new Error('Failed to fetch projects')
    return res.json()
  }

  async function createProject(name, duration = 30) {
    const res = await fetch('/api/projects', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, duration, timeline: {} }),
    })
    if (!res.ok) throw new Error('Failed to create project')
    const p = await res.json()
    setProject(p)
    return p
  }

  async function loadProject(id) {
    const res = await fetch(`/api/projects/${id}`)
    if (!res.ok) throw new Error('Failed to load project')
    const p = await res.json()
    setProject(p)
    subscribeProjectEvents(id)
    // Fire-and-forget: backfill clip.source for AI-script clips whose workflow.json
    // has produced media but the clip never received a publish-media update
    // (e.g. previous session crashed before WorkflowEditor was reopened).
    syncAiScriptSources(p)
    // Also backfill sourceDuration on legacy clips whose publish path didn't
    // set it — without this resize-end has no clamp and lets the user drag
    // the right edge forever.
    backfillSourceDurations(p)
    return p
  }

  async function saveProject() {
    // Manual save: edits are staged in server memory during the session; this
    // flushes the client's authoritative full project to disk. setProject()
    // resets isDirty:false (clean).
    const project = useProjectStore.getState().project
    if (!project) return
    const res = await fetch(`/api/projects/${project.id}/save`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(project),
    })
    if (!res.ok) throw new Error('Failed to save project')
    const updated = await res.json()
    setProject(updated)
    return updated
  }

  async function deleteProject(id) {
    const res = await fetch(`/api/projects/${id}`, { method: 'DELETE' })
    if (!res.ok) throw new Error('Failed to delete project')
    if (useProjectStore.getState().project?.id === id) {
      unsubscribeProjectEvents()
      clearProject()
    }
  }

  async function fetchAssets(projectId) {
    const res = await fetch(`/api/projects/${projectId}/assets`)
    if (!res.ok) throw new Error('Failed to fetch assets')
    return res.json()
  }

  async function uploadAsset(projectId, file) {
    const form = new FormData()
    form.append('file', file)
    const res = await fetch(`/api/projects/${projectId}/assets`, {
      method: 'POST',
      body: form,
    })
    if (!res.ok) throw new Error('Failed to upload asset')
    return res.json()
  }

  // Upload with XHR so we get upload progress events
  function uploadAssetWithProgress(projectId, file, onProgress) {
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest()
      const form = new FormData()
      form.append('file', file)

      xhr.upload.onprogress = (e) => {
        if (e.lengthComputable) onProgress(Math.round((e.loaded / e.total) * 100))
      }
      xhr.onload = () => {
        if (xhr.status >= 200 && xhr.status < 300) {
          resolve(JSON.parse(xhr.responseText))
        } else {
          reject(new Error(`Upload failed: ${xhr.status}`))
        }
      }
      xhr.onerror = () => reject(new Error('Network error'))
      xhr.open('POST', `/api/projects/${projectId}/assets`)
      xhr.send(form)
    })
  }

  return {
    isDirty,
    fetchProjects,
    createProject,
    loadProject,
    saveProject,
    deleteProject,
    fetchAssets,
    uploadAsset,
    uploadAssetWithProgress,
  }
}
