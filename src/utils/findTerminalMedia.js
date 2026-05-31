// Mirror of `server/ai/workflowTerminal.ts` for frontend use.
// Priority (within the same depth level):
//   video/effect (status='done', videoUrl) > output.selectedUrl
//   > storyboard.generatedUrl > generator.outputs[0]
// Subgraph fallback: when no direct terminal exists at the current level,
// recurse into each subgraph's innerNodes — preserves the contract that
// flat workflows are unaffected, and lets timeline preview pick up output
// produced inside an encapsulated subgraph.
//
// Signature aligned with the backend (`(workflow)` rather than `(nodes)`)
// so a snippet pasted across the mirror boundary doesn't silently get
// `null` from a shape mismatch. Internal helper findInNodes does the
// real recursion.

/**
 * @param {{ nodes?: Array<{ type: string, data?: any }> } | null | undefined} workflow
 * @returns {{ url: string, type: 'image' | 'video' } | null}
 */
export function findTerminalMedia(workflow) {
  return findInNodes(workflow?.nodes)
}

function findInNodes(nodes) {
  if (!nodes?.length) return null

  // Treat seedance the same as video/effect — it's a video producer with
  // the same data.videoUrl + data.status='done' contract.
  const video = nodes.find(n => (n.type === 'video' || n.type === 'effect' || n.type === 'seedance') && n.data?.status === 'done' && n.data?.videoUrl)
  if (video) return { url: video.data.videoUrl, type: 'video' }

  const out = nodes.find(n => n.type === 'output' && n.data?.selectedUrl)
  if (out) return { url: out.data.selectedUrl, type: 'image' }

  // Storyboard ranks above generic Generator: storyboards are typically the
  // refined downstream output (Generator → Storyboard chain), and they're
  // image producers with their own URL field.
  const sb = nodes.find(n => n.type === 'storyboard' && n.data?.generatedUrl)
  if (sb) return { url: sb.data.generatedUrl, type: 'image' }

  const gen = nodes.find(n => n.type === 'generator' && n.data?.outputs?.[0])
  if (gen) return { url: gen.data.outputs[0], type: 'image' }

  for (const n of nodes) {
    if (n.type === 'subgraph' && Array.isArray(n.data?.innerNodes)) {
      const inner = findInNodes(n.data.innerNodes)
      if (inner) return inner
    }
  }

  return null
}
