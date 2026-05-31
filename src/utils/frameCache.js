/**
 * Client-side video frame extractor with caching.
 * Uses a pool of <video> elements + <canvas> to extract JPEG thumbnails
 * at specified timestamps, cached in memory.
 */

const cache = new Map()  // "src@1.50" → dataURL
const pending = new Map() // "src@1.50" → Promise<string>

const THUMB_W = 80

function getThumbH(aspectW = 9, aspectH = 16) {
  return Math.round(THUMB_W * aspectH / aspectW)
}

/**
 * Extract a single frame from a video at the given time.
 * Returns a data URL (JPEG). Results are cached.
 */
export function extractFrame(src, timeSec, aspectW = 9, aspectH = 16) {
  const THUMB_H = getThumbH(aspectW, aspectH)
  const key = `${src}@${timeSec.toFixed(2)}@${aspectW}:${aspectH}`
  if (cache.has(key)) return Promise.resolve(cache.get(key))
  if (pending.has(key)) return pending.get(key)

  const p = new Promise((resolve) => {
    const video = document.createElement('video')
    video.crossOrigin = 'anonymous'
    video.preload = 'metadata'
    video.muted = true
    video.playsInline = true

    let resolved = false
    const cleanup = () => {
      video.removeAttribute('src')
      video.load()
    }
    const fail = () => {
      if (resolved) return
      resolved = true
      pending.delete(key)
      cleanup()
      resolve(null)
    }

    video.addEventListener('error', fail, { once: true })

    video.addEventListener('loadedmetadata', () => {
      const seekTo = Math.min(timeSec, Math.max(0, video.duration - 0.1))
      video.currentTime = seekTo
    }, { once: true })

    video.addEventListener('seeked', () => {
      if (resolved) return
      resolved = true
      try {
        const canvas = document.createElement('canvas')
        canvas.width = THUMB_W
        canvas.height = THUMB_H
        const ctx = canvas.getContext('2d')
        ctx.drawImage(video, 0, 0, THUMB_W, THUMB_H)
        const dataUrl = canvas.toDataURL('image/jpeg', 0.5)
        cache.set(key, dataUrl)
        pending.delete(key)
        cleanup()
        resolve(dataUrl)
      } catch {
        pending.delete(key)
        cleanup()
        resolve(null)
      }
    }, { once: true })

    // Timeout fallback
    setTimeout(fail, 5000)

    video.src = src
  })

  pending.set(key, p)
  return p
}

/**
 * Extract multiple evenly-spaced frames for a clip.
 * Uses a single <video> element to avoid per-frame load overhead.
 * Returns Promise<(string|null)[]>
 */
export async function extractFrames(src, startTime, duration, count, aspectW = 9, aspectH = 16) {
  const THUMB_H = getThumbH(aspectW, aspectH)
  const interval = duration / count
  const times = []
  for (let i = 0; i < count; i++) {
    times.push(startTime + interval * i + interval * 0.5)
  }

  const cacheKey = (t) => `${src}@${t.toFixed(2)}@${aspectW}:${aspectH}`

  // Check cache first — if all cached, return immediately
  const allCached = times.every(t => cache.has(cacheKey(t)))
  if (allCached) {
    return times.map(t => cache.get(cacheKey(t)))
  }

  // Use a single video element for all seeks
  return new Promise((resolve) => {
    const video = document.createElement('video')
    video.crossOrigin = 'anonymous'
    video.preload = 'metadata'
    video.muted = true
    video.playsInline = true

    const results = []
    let idx = 0
    let failed = false

    const cleanup = () => {
      video.removeAttribute('src')
      video.load()
    }

    const fail = () => {
      if (failed) return
      failed = true
      cleanup()
      // Fill remaining with cached or null
      while (results.length < times.length) results.push(null)
      resolve(results)
    }

    const seekNext = () => {
      if (idx >= times.length) {
        cleanup()
        resolve(results)
        return
      }
      const t = times[idx]
      const key = cacheKey(t)
      if (cache.has(key)) {
        results.push(cache.get(key))
        idx++
        seekNext()
        return
      }
      const seekTo = Math.min(t, Math.max(0, video.duration - 0.1))
      video.currentTime = seekTo
    }

    video.addEventListener('error', fail, { once: true })

    video.addEventListener('loadedmetadata', () => {
      seekNext()
    }, { once: true })

    video.addEventListener('seeked', function onSeeked() {
      if (failed) return
      const t = times[idx]
      const key = cacheKey(t)
      try {
        const canvas = document.createElement('canvas')
        canvas.width = THUMB_W
        canvas.height = THUMB_H
        const ctx = canvas.getContext('2d')
        ctx.drawImage(video, 0, 0, THUMB_W, THUMB_H)
        const dataUrl = canvas.toDataURL('image/jpeg', 0.5)
        cache.set(key, dataUrl)
        results.push(dataUrl)
      } catch {
        results.push(null)
      }
      idx++
      seekNext()
    })

    // Timeout fallback
    setTimeout(fail, 15000)

    video.src = src
  })
}
