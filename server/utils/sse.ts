import type { Response } from 'express'

// Close-safe wrapper around the Server-Sent Events boilerplate used by every
// long-running endpoint (render, workflowRun, transcribe, aiPipeline). The
// shared shape:
//   1. set the SSE headers + flush
//   2. a `send` that JSON-encodes and writes one event
//   3. a 15s keep-alive `: ping` so proxies don't time the socket out
//   4. graceful teardown when the client disconnects
//
// Every res.write is wrapped in try/catch because Node throws
// ERR_STREAM_WRITE_AFTER_END the moment the client closes the connection.
// Without this guard the orchestrator's error handler would itself crash, and
// what should be a benign client-disconnect ended up tripping unhandled
// rejection handlers. render.ts and workflowRun.ts grew the same pattern
// inline after the bug bit them; this helper centralises it so transcribe
// (which still raw-wrote) and any future caller inherit the same behaviour.

export interface SseStream {
  /** Write one event. No-ops once the client has disconnected. */
  send(data: unknown): void
  /** Send the keep-alive comment. Normally invoked by the internal interval. */
  ping(): void
  /** Stop the keep-alive timer + res.end() once. Safe to call multiple times. */
  close(): void
  /** True once the stream has been marked closed (client gone or close() called). */
  isClosed(): boolean
}

export interface SseOptions {
  /** Ping interval in ms; default 15000. Set to 0 to disable. */
  keepAliveMs?: number
}

export function setupSse(res: Response, options: SseOptions = {}): SseStream {
  res.setHeader('Content-Type', 'text/event-stream')
  res.setHeader('Cache-Control', 'no-cache')
  res.setHeader('Connection', 'keep-alive')
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.flushHeaders()

  let closed = false

  const send = (data: unknown) => {
    if (closed) return
    try {
      res.write(`data: ${JSON.stringify(data)}\n\n`)
    } catch {
      closed = true
    }
  }

  const ping = () => {
    if (closed) return
    try {
      res.write(': ping\n\n')
    } catch {
      closed = true
    }
  }

  const interval = options.keepAliveMs ?? 15000
  const keepAlive = interval > 0 ? setInterval(ping, interval) : null

  const close = () => {
    if (closed) {
      if (keepAlive) clearInterval(keepAlive)
      return
    }
    closed = true
    if (keepAlive) clearInterval(keepAlive)
    try { res.end() } catch {}
  }

  res.on('close', () => {
    closed = true
    if (keepAlive) clearInterval(keepAlive)
  })

  return {
    send,
    ping,
    close,
    isClosed: () => closed,
  }
}
