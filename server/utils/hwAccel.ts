import { execSync } from 'child_process'

export interface HwAccelStatus {
  nvenc: boolean   // h264_nvenc encoder available (GPU encoding)
  cuvid: boolean   // h264_cuvid decoder available (GPU decoding)
}

let _cache: HwAccelStatus | null = null

/**
 * Detect GPU hardware acceleration availability.
 * Result is cached after the first call.
 */
export function detectHwAccel(): HwAccelStatus {
  if (_cache) return _cache

  try {
    const bin = process.env.FFMPEG_PATH ?? 'ffmpeg'
    const encoders = execSync(`"${bin}" -encoders 2>&1`, { timeout: 8000 }).toString()
    const decoders = execSync(`"${bin}" -decoders 2>&1`, { timeout: 8000 }).toString()
    _cache = {
      nvenc: encoders.includes('h264_nvenc'),
      cuvid: decoders.includes('h264_cuvid'),
    }
  } catch {
    _cache = { nvenc: false, cuvid: false }
  }

  if (_cache.nvenc) {
    console.log('[hwaccel] ✓ NVIDIA NVENC detected — GPU encoding enabled')
  } else {
    console.log('[hwaccel] ✗ NVENC not found — falling back to libx264 (CPU)')
  }

  return _cache
}
