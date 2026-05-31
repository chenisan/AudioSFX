/**
 * Start / stop / monitor the local Python inference services from the UI.
 *
 * Services are launched DETACHED (they outlive nodemon restarts) via their
 * PowerShell launch scripts, and stopped by killing whatever listens on their
 * port (robust against the pwsh→python process tree on Windows). Status is the
 * service's own /ping plus a "starting" grace window right after a spawn.
 *
 * Windows-only (matches the project's platform). localhost-bound dev tool.
 */
import { spawn, exec } from 'child_process'
import * as fs from 'fs'
import * as path from 'path'

export type EngineName = 'woosh' | 'mmaudio'

interface EngineDef {
  port: number
  label: string
}

// The engine name is also its subdir under engines/ (engines/woosh,
// engines/mmaudio), each holding its own .venv + audiosfx_api.py wrapper.
export const ENGINES: Record<EngineName, EngineDef> = {
  woosh:   { port: 6302, label: 'Woosh (文字/影片→音效)' },
  mmaudio: { port: 6303, label: 'MMAudio (影片→同步底聲)' },
}

// When a start was last requested — drives the transient "starting" status
// until the port comes up (uvicorn import + first bind takes a few seconds).
const startedAt: Partial<Record<EngineName, number>> = {}
const STARTING_GRACE_MS = 40_000

export function isEngine(name: string): name is EngineName {
  return name === 'woosh' || name === 'mmaudio'
}

export function startService(name: EngineName, now: number): void {
  // Spawn the venv python directly (not via the .ps1 / pwsh) — fewer moving
  // parts, and PYTHONUNBUFFERED makes the log flush live instead of block-
  // buffering behind a non-TTY pipe. The wrapper itself injects the ffmpeg
  // DLL dir (os.add_dll_directory); we also prepend it to PATH defensively.
  const enginesRoot = path.join(process.cwd(), 'engines')
  const engineDir = path.join(enginesRoot, name)            // engines/woosh | engines/mmaudio
  const python = path.join(engineDir, '.venv', 'Scripts', 'python.exe')
  const ffmpegBin = path.join(enginesRoot, 'ffmpeg-shared', 'bin')
  const logPath = path.join(engineDir, '_svc.log')          // gitignored (_svc.*)
  const out = fs.openSync(logPath, 'a')
  const child = spawn(python, ['audiosfx_api.py'], {
    cwd: engineDir,
    env: { ...process.env, PATH: ffmpegBin + path.delimiter + (process.env.PATH || ''), PYTHONUNBUFFERED: '1' },
    detached: true,
    stdio: ['ignore', out, out],
    windowsHide: true,
  })
  child.on('error', (e) => {
    try { fs.appendFileSync(logPath, `\n[spawn error] ${String(e)}\n`) } catch { /* ignore */ }
  })
  child.unref()
  startedAt[name] = now
}

export function stopService(name: EngineName): Promise<void> {
  const { port } = ENGINES[name]
  delete startedAt[name]
  // Kill the listener on the port (the uvicorn python, regardless of the
  // pwsh parent). -Force; ignore "nothing listening".
  const ps =
    `$p = Get-NetTCPConnection -LocalPort ${port} -State Listen -ErrorAction SilentlyContinue | ` +
    `Select-Object -ExpandProperty OwningProcess -Unique; ` +
    `if ($p) { Stop-Process -Id $p -Force -ErrorAction SilentlyContinue }`
  return new Promise((resolve) => {
    exec(`pwsh -NoProfile -Command "${ps}"`, { windowsHide: true }, () => resolve())
  })
}

interface Ping { status?: string; on_gpu?: unknown; loaded?: unknown }

async function ping(port: number): Promise<Ping | null> {
  try {
    const r = await fetch(`http://127.0.0.1:${port}/ping`, { signal: AbortSignal.timeout(2000) })
    if (!r.ok) return null
    return (await r.json()) as Ping
  } catch {
    return null
  }
}

export interface EngineStatus {
  name: EngineName
  label: string
  port: number
  state: 'ready' | 'starting' | 'stopped'
  onGpu: unknown
  loaded: unknown
}

export async function statusOf(name: EngineName, now: number): Promise<EngineStatus> {
  const def = ENGINES[name]
  const p = await ping(def.port)
  let state: EngineStatus['state']
  if (p) state = 'ready'
  else if (startedAt[name] && now - startedAt[name]! < STARTING_GRACE_MS) state = 'starting'
  else state = 'stopped'
  // Once up, clear the grace marker.
  if (p) delete startedAt[name]
  return { name, label: def.label, port: def.port, state, onGpu: p?.on_gpu ?? null, loaded: p?.loaded ?? null }
}

export function readVram(): Promise<{ usedMiB: number; totalMiB: number } | null> {
  return new Promise((resolve) => {
    exec(
      'nvidia-smi --query-gpu=memory.used,memory.total --format=csv,noheader,nounits',
      { windowsHide: true },
      (err, stdout) => {
        if (err) return resolve(null)
        const [used, total] = stdout.trim().split('\n')[0].split(',').map(s => parseInt(s.trim(), 10))
        if (Number.isNaN(used) || Number.isNaN(total)) return resolve(null)
        resolve({ usedMiB: used, totalMiB: total })
      },
    )
  })
}
