/**
 * HTTP client for the local Python inference services (DEVELOPMENT_PLAN §7):
 *   Woosh   :6302  /generate/sfx (T2A) · /generate/v2a (V2A DVFlow) · /evict
 *   MMAudio :6303  /generate (V2A synced) · /evict
 *
 * VRAM strategy A: MMAudio (~5.8GB) and Woosh-DVFlow (~8.5GB) are mutually
 * exclusive — only one heavy V2A engine fits alongside the always-warm
 * Woosh-DFlow. We enforce it the robust way: before any heavy generation,
 * evict the OTHER heavy engine. /evict is a no-op when nothing is loaded, so
 * this stays correct even if a service was restarted (no shared state to
 * desync). Text→SFX (DFlow) is small and always warm — never needs eviction.
 */
const WOOSH = process.env.WOOSH_URL || 'http://127.0.0.1:6302'
const MMAUDIO = process.env.MMAUDIO_URL || 'http://127.0.0.1:6303'

export class ServiceDownError extends Error {
  constructor(public engine: string) {
    super(`推論服務未啟動（${engine}）。請先在右上「引擎」面板啟動該服務，待轉「就緒」後重試。`)
    this.name = 'ServiceDownError'
  }
}

export interface GenResult {
  buf: Buffer
  ext: 'wav' | 'flac'
  genSeconds: number | null
  durationSec: number | null
}

async function postAudio(base: string, path: string, body: object, engine: string): Promise<GenResult> {
  let res: Response
  try {
    res = await fetch(base + path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
  } catch {
    throw new ServiceDownError(engine)        // ECONNREFUSED / DNS / network
  }
  if (!res.ok) {
    const detail = await res.text().catch(() => '')
    throw new Error(`${engine} ${res.status}: ${detail.slice(0, 300)}`)
  }
  const ab = await res.arrayBuffer()
  const num = (h: string) => {
    const v = res.headers.get(h)
    return v != null && v !== '' ? Number(v) : null
  }
  const ext = (res.headers.get('content-type') || '').includes('flac') ? 'flac' : 'wav'
  return { buf: Buffer.from(ab), ext, genSeconds: num('x-generation-seconds'), durationSec: num('x-duration-seconds') }
}

/** Best-effort evict — used to free VRAM before a conflicting heavy gen. A
 *  down service holds no VRAM, so a failed evict is fine to ignore. */
async function evict(base: string, body?: object): Promise<void> {
  try {
    await fetch(base + '/evict', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body ?? {}),
    })
  } catch {
    /* service down → nothing resident to evict */
  }
}

export async function checkServices(): Promise<{ woosh: boolean; mmaudio: boolean }> {
  const ping = async (base: string) => {
    try {
      const r = await fetch(base + '/ping', { signal: AbortSignal.timeout(2000) })
      return r.ok
    } catch {
      return false
    }
  }
  const [woosh, mmaudio] = await Promise.all([ping(WOOSH), ping(MMAUDIO)])
  return { woosh, mmaudio }
}

/** Text → SFX (Woosh-DFlow, ~0.8s, always warm). */
export function generateSfx(args: { prompt: string; num_steps?: number; cfg?: number; seed?: number }): Promise<GenResult> {
  return postAudio(WOOSH, '/generate/sfx', args, 'Woosh')
}

/** Video → synced底聲 (MMAudio). Evicts Woosh-DVFlow first to make room. */
export async function generateMMAudio(
  args: { video_path: string; prompt?: string; negative_prompt?: string; duration?: number; num_steps?: number; cfg_strength?: number; seed?: number },
): Promise<GenResult> {
  await evict(WOOSH)                          // free DVFlow+Synchformer if resident
  return postAudio(MMAUDIO, '/generate', args, 'MMAudio')
}

/** Video → SFX (Woosh-DVFlow-8s). Evicts MMAudio first to make room. */
export async function generateV2A(
  args: { video_path: string; start?: number; description?: string; num_steps?: number; cfg?: number; seed?: number },
): Promise<GenResult> {
  await evict(MMAUDIO)                         // free MMAudio if resident
  return postAudio(WOOSH, '/generate/v2a', args, 'Woosh')
}
