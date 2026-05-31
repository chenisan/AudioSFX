import * as path from 'path'

let native: any | null = null

function getNativePath(): string {
  return path.resolve(__dirname, '..', '..', 'native', 'media-engine')
}

function ensureLoaded() {
  if (native) return native
  const p = getNativePath()
  try {
    native = require(p)
  } catch (e: any) {
    throw new Error(`Failed to load media-engine at ${p}: ${e.message}`)
  }
  return native
}

interface WaveformRaw {
  sampleRate: number
  durationSec: number
  channels: number
  bucketCount: number
  peaks: Buffer
}

export interface WaveformResult {
  sampleRate: number
  duration: number
  channels: number
  bucketCount: number
  /** Absolute-max normalized 0..1 per bucket (backward compatible format) */
  peaks: number[]
  /** Signed min per bucket, normalized -1..1 */
  peaksMin: number[]
  /** Signed max per bucket, normalized -1..1 */
  peaksMax: number[]
  totalSamples: number
}

export function computeWaveform(audioPath: string, buckets: number): WaveformResult {
  const m = ensureLoaded()
  const raw: WaveformRaw = m.generateWaveform(audioPath, buckets)
  const count = raw.bucketCount
  const peaksMin = new Array<number>(count)
  const peaksMax = new Array<number>(count)
  const peaks = new Array<number>(count)
  for (let i = 0; i < count; i++) {
    const minI = raw.peaks.readInt16LE(i * 4)
    const maxI = raw.peaks.readInt16LE(i * 4 + 2)
    const minN = minI / 32767
    const maxN = maxI / 32767
    peaksMin[i] = minN
    peaksMax[i] = maxN
    peaks[i] = Math.max(Math.abs(minN), Math.abs(maxN))
  }
  return {
    sampleRate: raw.sampleRate,
    duration: raw.durationSec,
    channels: raw.channels,
    bucketCount: count,
    peaks,
    peaksMin,
    peaksMax,
    totalSamples: Math.round(raw.sampleRate * raw.durationSec),
  }
}

export interface ThumbnailStripResult {
  durationSec: number
  count: number
  width: number
  height: number
  files: string[]
  outputDir: string
}

export function generateThumbnailStrip(params: {
  videoPath: string
  outputDir: string
  ffmpegPath: string
  ffprobePath: string
  height: number
}): ThumbnailStripResult {
  const m = ensureLoaded()
  return m.generateThumbnails(
    params.videoPath,
    params.outputDir,
    params.ffmpegPath,
    params.ffprobePath,
    params.height,
  )
}

export interface ProbedMediaInfo {
  duration: number
  width: number
  height: number
  fps: number
  hasAudio: boolean
  hasVideo: boolean
}

/**
 * Probe media metadata natively (no ffprobe spawn).
 * Returns `null` for formats the native probe does not handle,
 * so the caller can fall back to ffprobe.
 */
export function probeMediaNative(filePath: string): ProbedMediaInfo | null {
  const m = ensureLoaded()
  return m.probeMedia(filePath) ?? null
}

export interface AudioConvertResult {
  durationSec: number
  sourceSampleRate: number
  sourceChannels: number
  targetSampleRate: number
  targetChannels: number
  outputFrames: number
}

/**
 * Decode any symphonia-supported audio/video and write PCM16 WAV at the target rate.
 * Currently only mono output is supported (target_channels=1).
 * Throws on unsupported containers (webm/mkv/avi) — caller should fall back to ffmpeg.
 */
export function extractAudioWavNative(
  inputPath: string,
  outputPath: string,
  targetSampleRate: number,
  targetChannels: number = 1,
): AudioConvertResult {
  const m = ensureLoaded()
  return m.extractAudioWav(inputPath, outputPath, targetSampleRate, targetChannels)
}

/** Returns true if the native module is loadable (diagnostic use). */
export function isMediaEngineAvailable(): boolean {
  try {
    ensureLoaded()
    return true
  } catch {
    return false
  }
}
