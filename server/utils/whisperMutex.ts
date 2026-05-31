import * as fs from 'fs'
import * as path from 'path'
import { getDataDir } from './dataDir'

// Cross-process "last writer wins" lock for whisper.cpp invocations.
//
// Why a file lock and not an in-process mutex:
//   Each Claude session spawns its own MCP server child process, so a
//   process-local mutex doesn't see other sessions. Two whisper-cli.exe
//   instances on the same GPU will fight for VRAM and can hang the driver.
//
// Semantics: the newest acquirer wins. When we see an existing lock we
// SIGTERM the previous whisper-cli child PID (not its owner Node process,
// which may host an unrelated MCP session) and wait for the previous owner
// to release on its own; if it doesn't, we forcibly overwrite.

interface LockData {
  ownerPid: number
  childPid: number | null
  startedAt: number
}

const LOCK_FILENAME = '.whisper.lock'

function getLockPath(): string {
  return path.join(getDataDir(), LOCK_FILENAME)
}

function isProcessAlive(pid: number): boolean {
  if (!pid || pid <= 0) return false
  try {
    process.kill(pid, 0)
    return true
  } catch (e: any) {
    return e.code === 'EPERM'
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms))
}

function readLock(lockPath: string): LockData | null {
  try {
    const raw = fs.readFileSync(lockPath, 'utf-8')
    return JSON.parse(raw) as LockData
  } catch {
    return null
  }
}

export interface WhisperLock {
  setChild: (pid: number) => void
  release: () => void
}

export async function acquireWhisperLock(): Promise<WhisperLock> {
  const lockPath = getLockPath()
  fs.mkdirSync(path.dirname(lockPath), { recursive: true })

  const myData: LockData = {
    ownerPid: process.pid,
    childPid: null,
    startedAt: Date.now(),
  }

  for (let attempt = 0; attempt < 6; attempt++) {
    try {
      fs.writeFileSync(lockPath, JSON.stringify(myData), { flag: 'wx' })
      break
    } catch (e: any) {
      if (e.code !== 'EEXIST') throw e

      const existing = readLock(lockPath)
      if (!existing || !isProcessAlive(existing.ownerPid)) {
        try { fs.unlinkSync(lockPath) } catch {}
        continue
      }

      if (existing.childPid != null) {
        try { process.kill(existing.childPid, 'SIGTERM') } catch {}
      }

      await sleep(800)

      const after = readLock(lockPath)
      if (after && after.ownerPid === existing.ownerPid && after.startedAt === existing.startedAt) {
        // Previous owner didn't release — force takeover.
        try { fs.unlinkSync(lockPath) } catch {}
      }
    }
  }

  let released = false

  const setChild = (pid: number) => {
    if (released) return
    myData.childPid = pid
    try {
      fs.writeFileSync(lockPath, JSON.stringify(myData))
    } catch {}
  }

  const release = () => {
    if (released) return
    released = true
    const current = readLock(lockPath)
    if (current && current.ownerPid === process.pid && current.startedAt === myData.startedAt) {
      try { fs.unlinkSync(lockPath) } catch {}
    }
  }

  return { setChild, release }
}
