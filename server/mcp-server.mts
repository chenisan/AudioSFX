/**
 * AudioSFX MCP server — lets an AI agent (Claude Code / Codex) drive the running
 * editor over the Model Context Protocol. Tools are thin clients over the REST
 * backend (default http://localhost:6301), so changes hit the SAME live instance
 * the user sees in the browser. Requires the backend to be running (`npm run dev`).
 *
 * `.mts` so it runs as ESM (the MCP SDK is ESM-only + we use top-level await),
 * regardless of the project's default CommonJS. Transport: stdio. Spawned by the
 * agent via .mcp.json (Claude Code) or the agent's own MCP config (Codex).
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { z } from 'zod'

const BASE = process.env.AUDIOSFX_API_BASE || `http://localhost:${process.env.PORT || 6301}`

async function api(path: string, init?: RequestInit): Promise<any> {
  const res = await fetch(BASE + path, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...(init?.headers || {}) },
  })
  const text = await res.text()
  let data: any
  try { data = text ? JSON.parse(text) : null } catch { data = text }
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${typeof data === 'string' ? data : JSON.stringify(data)}`)
  return data
}

const ok = (obj: any) => ({ content: [{ type: 'text' as const, text: typeof obj === 'string' ? obj : JSON.stringify(obj, null, 2) }] })
const fail = (e: any) => ({ content: [{ type: 'text' as const, text: 'Error: ' + (e?.message || String(e)) }], isError: true })

const server = new McpServer({ name: 'audiosfx', version: '0.1.0' })

server.registerTool('list_projects',
  { title: '列出專案', description: 'List all AudioSFX projects (id, name, duration).', inputSchema: {} },
  async () => { try { return ok(await api('/api/projects')) } catch (e) { return fail(e) } })

server.registerTool('create_project',
  { title: '建立專案', description: 'Create a new project.', inputSchema: { name: z.string(), duration: z.number().describe('seconds').default(30) } },
  async ({ name, duration }) => { try { return ok(await api('/api/projects', { method: 'POST', body: JSON.stringify({ name, duration }) })) } catch (e) { return fail(e) } })

server.registerTool('get_project',
  { title: '專案摘要', description: 'Get a project: tracks (id/type/name) and their clips (source/start/end). Use the track ids for add_clip.', inputSchema: { projectId: z.string() } },
  async ({ projectId }) => {
    try {
      const p = await api(`/api/projects/${projectId}`)
      const tracks = (p?.timeline?.tracks ?? []).map((t: any) => ({
        id: t.id, type: t.type, name: t.name, muted: !!t.muted,
        clips: (t.clips ?? []).map((c: any) => ({ source: c.source, start: c.start, end: c.end })),
      }))
      return ok({ id: p.id, name: p.name, duration: p.duration, aspectRatio: p.aspectRatio, tracks })
    } catch (e) { return fail(e) }
  })

server.registerTool('add_track',
  { title: '新增軌道', description: 'Add a timeline track (audio / video / text).', inputSchema: { projectId: z.string(), type: z.enum(['audio', 'video', 'text']), name: z.string().optional() } },
  async ({ projectId, type, name }) => { try { return ok(await api(`/api/projects/${projectId}/timeline/tracks`, { method: 'POST', body: JSON.stringify({ type, name }) })) } catch (e) { return fail(e) } })

server.registerTool('add_clip',
  { title: '加入片段', description: 'Place a clip on a track. `source` is an asset filename in the project (e.g. from generate_sfx). start/end in seconds.', inputSchema: { projectId: z.string(), trackId: z.string(), source: z.string(), start: z.number(), end: z.number() } },
  async ({ projectId, trackId, source, start, end }) => {
    try { return ok(await api(`/api/projects/${projectId}/timeline/tracks/${trackId}/clips`, { method: 'POST', body: JSON.stringify({ source, start, end, sourceDuration: Math.max(0, end - start) }) })) } catch (e) { return fail(e) }
  })

server.registerTool('generate_sfx',
  { title: '生成音效（文字→SFX）', description: 'Generate a sound effect from an English prompt (Sony Woosh). Lands as a project asset; returns { filename, durationSec }. Then use add_clip with that filename. Requires the Woosh engine running.', inputSchema: { projectId: z.string(), prompt: z.string().describe('English description, e.g. "glass shatter"'), name: z.string().optional().describe('optional custom filename') } },
  async ({ projectId, prompt, name }) => { try { return ok(await api('/api/audio/sfx', { method: 'POST', body: JSON.stringify({ projectId, prompt, name }) })) } catch (e) { return fail(e) } })

server.registerTool('save_project',
  { title: '存檔', description: 'Persist the project to disk (project.yaml). In-memory edits are lost on backend reload until saved.', inputSchema: { projectId: z.string() } },
  async ({ projectId }) => { try { return ok(await api(`/api/projects/${projectId}/save`, { method: 'POST' })) } catch (e) { return fail(e) } })

server.registerTool('engine_health',
  { title: '引擎狀態', description: 'Check the Woosh / MMAudio inference engines (needed for SFX generation).', inputSchema: {} },
  async () => { try { return ok(await api('/api/audio/health')) } catch (e) { return fail(e) } })

// ── Convenience: generate SFX straight onto a track ─────────────────────────
server.registerTool('generate_sfx_to_track',
  {
    title: '生成音效並放到軌道', description: 'Generate a text→SFX and place it on a track at `start` in one step (generate_sfx + add_clip). Returns the asset + placement. Requires the Woosh engine.',
    inputSchema: { projectId: z.string(), trackId: z.string(), prompt: z.string().describe('English description'), start: z.number().describe('placement time in seconds'), name: z.string().optional() },
  },
  async ({ projectId, trackId, prompt, start, name }) => {
    try {
      const saved = await api('/api/audio/sfx', { method: 'POST', body: JSON.stringify({ projectId, prompt, name }) })
      const dur = Number(saved?.durationSec) || 5
      const end = start + dur
      await api(`/api/projects/${projectId}/timeline/tracks/${trackId}/clips`, { method: 'POST', body: JSON.stringify({ source: saved.filename, start, end, sourceDuration: dur }) })
      return ok({ ...saved, placedOnTrack: trackId, start, end })
    } catch (e) { return fail(e) }
  })

// ── Effects（音軌效果鏈）─────────────────────────────────────────────────────
server.registerTool('get_track_effects',
  { title: '查軌道效果', description: 'List a track\'s effect chain (track.plugins[]).', inputSchema: { projectId: z.string(), trackId: z.string() } },
  async ({ projectId, trackId }) => {
    try { const p = await api(`/api/projects/${projectId}`); const t = (p?.timeline?.tracks ?? []).find((x: any) => x.id === trackId); return ok(t?.plugins ?? []) } catch (e) { return fail(e) }
  })

server.registerTool('set_track_effects',
  {
    title: '設定軌道效果', description: 'Replace a track\'s whole effect chain. Each plugin: { type, enabled?, params }. type=eq|compressor|limiter|reverb. params — eq:{bands:[{type:lowshelf|peaking|highshelf,freq,gain,q}]} · compressor:{threshold(dB),ratio,attack(ms),release(ms),knee,makeup(dB)} · limiter:{threshold(dB ceiling),release(ms)} · reverb:{predelay(ms),space(0.2-8 s),character,brightness,thickness,width,mix (0-100)}. Missing ids are auto-filled.',
    inputSchema: { projectId: z.string(), trackId: z.string(), plugins: z.array(z.object({ type: z.string(), enabled: z.boolean().optional(), params: z.record(z.any()).optional(), id: z.string().optional() })) },
  },
  async ({ projectId, trackId, plugins }) => {
    try {
      const norm = plugins.map((p: any, i: number) => ({ id: p.id || `${p.type}_${i}_${Math.random().toString(36).slice(2, 7)}`, type: p.type, enabled: p.enabled !== false, params: p.params || {} }))
      return ok(await api(`/api/projects/${projectId}/timeline/tracks/${trackId}`, { method: 'PATCH', body: JSON.stringify({ plugins: norm }) }))
    } catch (e) { return fail(e) }
  })

// ── Volume / mute / master ──────────────────────────────────────────────────
server.registerTool('set_track_volume',
  { title: '軌道音量', description: 'Set a track\'s volume (linear; 1 = unity, 0–4).', inputSchema: { projectId: z.string(), trackId: z.string(), volume: z.number() } },
  async ({ projectId, trackId, volume }) => { try { return ok(await api(`/api/projects/${projectId}/timeline/tracks/${trackId}`, { method: 'PATCH', body: JSON.stringify({ volume }) })) } catch (e) { return fail(e) } })

server.registerTool('set_track_muted',
  { title: '軌道靜音', description: 'Mute / un-mute a track.', inputSchema: { projectId: z.string(), trackId: z.string(), muted: z.boolean() } },
  async ({ projectId, trackId, muted }) => { try { return ok(await api(`/api/projects/${projectId}/timeline/tracks/${trackId}`, { method: 'PATCH', body: JSON.stringify({ muted }) })) } catch (e) { return fail(e) } })

server.registerTool('set_clip_volume',
  { title: '片段音量', description: 'Set a single clip\'s volume (linear, 1 = unity).', inputSchema: { projectId: z.string(), trackId: z.string(), clipIndex: z.number(), volume: z.number() } },
  async ({ projectId, trackId, clipIndex, volume }) => { try { return ok(await api(`/api/projects/${projectId}/timeline/tracks/${trackId}/clips/${clipIndex}`, { method: 'PATCH', body: JSON.stringify({ volume }) })) } catch (e) { return fail(e) } })

server.registerTool('set_master_limiter',
  { title: '母帶 limiter', description: 'Master brickwall limiter on export+preview. enabled + ceilingDb (−3…0).', inputSchema: { projectId: z.string(), enabled: z.boolean(), ceilingDb: z.number().default(-1) } },
  async ({ projectId, enabled, ceilingDb }) => {
    try { const p = await api(`/api/projects/${projectId}`); return ok(await api(`/api/projects/${projectId}`, { method: 'PUT', body: JSON.stringify({ ...p, masterLimiter: { enabled, ceilingDb } }) })) } catch (e) { return fail(e) }
  })

// ── Clip editing / 對位 ─────────────────────────────────────────────────────
server.registerTool('update_clip',
  { title: '裁切片段', description: 'Trim a clip by setting start and/or end (seconds).', inputSchema: { projectId: z.string(), trackId: z.string(), clipIndex: z.number(), start: z.number().optional(), end: z.number().optional() } },
  async ({ projectId, trackId, clipIndex, start, end }) => {
    try { const u: any = {}; if (start != null) u.start = start; if (end != null) u.end = end; return ok(await api(`/api/projects/${projectId}/timeline/tracks/${trackId}/clips/${clipIndex}`, { method: 'PATCH', body: JSON.stringify(u) })) } catch (e) { return fail(e) }
  })

server.registerTool('move_clip',
  { title: '移動片段（對位）', description: 'Move a clip to a new start time, keeping its duration.', inputSchema: { projectId: z.string(), trackId: z.string(), clipIndex: z.number(), newStart: z.number() } },
  async ({ projectId, trackId, clipIndex, newStart }) => {
    try {
      const p = await api(`/api/projects/${projectId}`)
      const t = (p?.timeline?.tracks ?? []).find((x: any) => x.id === trackId)
      const c = t?.clips?.[clipIndex]
      if (!c) throw new Error('clip not found')
      const dur = c.end - c.start
      return ok(await api(`/api/projects/${projectId}/timeline/tracks/${trackId}/clips/${clipIndex}`, { method: 'PATCH', body: JSON.stringify({ start: newStart, end: newStart + dur }) }))
    } catch (e) { return fail(e) }
  })

server.registerTool('split_clip',
  { title: '分割片段', description: 'Split a clip at a timeline time (seconds).', inputSchema: { projectId: z.string(), trackId: z.string(), clipIndex: z.number(), atTime: z.number() } },
  async ({ projectId, trackId, clipIndex, atTime }) => { try { return ok(await api(`/api/projects/${projectId}/timeline/split-clip`, { method: 'POST', body: JSON.stringify({ trackId, clipIndex, atTime }) })) } catch (e) { return fail(e) } })

server.registerTool('duplicate_clip',
  { title: '複製片段', description: 'Duplicate a clip on its track.', inputSchema: { projectId: z.string(), trackId: z.string(), clipIndex: z.number() } },
  async ({ projectId, trackId, clipIndex }) => { try { return ok(await api(`/api/projects/${projectId}/timeline/duplicate-clip`, { method: 'POST', body: JSON.stringify({ trackId, clipIndex }) })) } catch (e) { return fail(e) } })

server.registerTool('delete_clip',
  { title: '刪除片段', description: 'Remove a clip from a track by index.', inputSchema: { projectId: z.string(), trackId: z.string(), clipIndex: z.number() } },
  async ({ projectId, trackId, clipIndex }) => { try { return ok(await api(`/api/projects/${projectId}/timeline/tracks/${trackId}/clips/${clipIndex}`, { method: 'DELETE' })) } catch (e) { return fail(e) } })

server.registerTool('arrange_track_tight',
  { title: '緊排軌道', description: 'Arrange a track\'s clips end-to-end with no gaps.', inputSchema: { projectId: z.string(), trackId: z.string() } },
  async ({ projectId, trackId }) => { try { return ok(await api(`/api/projects/${projectId}/timeline/arrange-clips-tight`, { method: 'POST', body: JSON.stringify({ trackId }) })) } catch (e) { return fail(e) } })

async function main() {
  const transport = new StdioServerTransport()
  await server.connect(transport)
}
main().catch((err) => { console.error(err); process.exit(1) })
