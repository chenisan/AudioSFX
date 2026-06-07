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

async function main() {
  const transport = new StdioServerTransport()
  await server.connect(transport)
}
main().catch((err) => { console.error(err); process.exit(1) })
