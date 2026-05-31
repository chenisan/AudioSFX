/**
 * Media analysis utilities for MCP perception tools.
 *
 * All CPU-heavy work goes through the already-compiled Rust native engine
 * (computeWaveform) — no extra FFI deps, no ffmpeg spawns.
 *
 * Tools:
 *   findSilence   — returns silent time spans from amplitude peaks
 *   getBeatGrid   — estimates BPM and beat timestamps via onset detection
 *   analyzeAsset  — combines probe metadata + silence summary + waveform stats
 */

import { computeWaveform } from '../core/mediaEngine'
import { getMediaInfo } from './ffprobe'

// ── Types ───────────────────────────────────────────────────────────────────

export interface SilenceSpan {
  start: number
  end: number
  duration: number
}

export interface BeatGrid {
  bpm: number
  beats: number[]         // timeline timestamps in seconds
  confidence: number      // 0–1, how stable the beat interval is
}

export interface AssetAnalysis {
  filename: string
  duration: number
  hasVideo: boolean
  hasAudio: boolean
  width: number
  height: number
  fps: number
  // Computed
  silenceRatio: number    // 0–1, fraction of total duration that is silent
  silenceSpans: SilenceSpan[]
  loudestMoment: number   // seconds
  rmsAvg: number          // average amplitude 0–1
}

// ── Silence detection ───────────────────────────────────────────────────────

export interface FindSilenceOptions {
  /** Amplitude threshold 0–1 below which audio is considered silent.
   *  Default 0.015 ≈ –36 dB (good for speech/music pauses). */
  threshold?: number
  /** Minimum span length to report (seconds). Default 0.3 */
  minDuration?: number
  /** Waveform resolution: buckets per second. Default 20 (50 ms per bucket). */
  bucketsPerSec?: number
}

export function findSilence(filePath: string, opts: FindSilenceOptions = {}): SilenceSpan[] {
  const {
    threshold = 0.015,
    minDuration = 0.3,
    bucketsPerSec = 20,
  } = opts

  const wf = computeWaveform(filePath, Math.ceil(wf_estimateBuckets(filePath, bucketsPerSec)))
  const secPerBucket = wf.duration / wf.bucketCount
  const spans: SilenceSpan[] = []

  let inSilence = false
  let silenceStart = 0

  for (let i = 0; i < wf.bucketCount; i++) {
    const isSilent = wf.peaks[i] < threshold
    if (isSilent && !inSilence) {
      inSilence = true
      silenceStart = i * secPerBucket
    } else if (!isSilent && inSilence) {
      inSilence = false
      const end = i * secPerBucket
      const duration = end - silenceStart
      if (duration >= minDuration) {
        spans.push({ start: +silenceStart.toFixed(3), end: +end.toFixed(3), duration: +duration.toFixed(3) })
      }
    }
  }
  // close trailing silence
  if (inSilence) {
    const end = wf.duration
    const duration = end - silenceStart
    if (duration >= minDuration) {
      spans.push({ start: +silenceStart.toFixed(3), end: +end.toFixed(3), duration: +duration.toFixed(3) })
    }
  }
  return spans
}

// Estimate bucket count without reading the file (we need duration first).
// We approximate by using a fixed large bucket count and later the actual
// waveform's .duration field corrects things. For the initial call we use
// a safe upper-bound based on a typical 5-minute file.
function wf_estimateBuckets(filePath: string, bucketsPerSec: number): number {
  // computeWaveform always returns exactly the requested bucket count,
  // and the secPerBucket is wf.duration / wf.bucketCount — so we just
  // need to request enough buckets. 6000 = 5 min × 20 bkts/s (generous).
  // For very long files this undershoots slightly; callers can pass more.
  return Math.max(100, bucketsPerSec * 600)   // cap at 600 s = 10 min
}

// ── Beat / BPM detection ────────────────────────────────────────────────────

export interface GetBeatGridOptions {
  /** Waveform resolution in buckets per second. Default 100 (10 ms per bucket). */
  bucketsPerSec?: number
  /** Expected BPM range. Default [60, 200]. */
  bpmRange?: [number, number]
}

export function getBeatGrid(filePath: string, opts: GetBeatGridOptions = {}): BeatGrid {
  const {
    bucketsPerSec = 100,
    bpmRange = [60, 200],
  } = opts

  const wf = computeWaveform(filePath, Math.ceil(wf_estimateBuckets(filePath, bucketsPerSec)))
  const secPerBucket = wf.duration / wf.bucketCount
  const peaks = wf.peaks

  // ── Step 1: compute onset strength ──────────────────────────────────────
  // Onset strength = positive energy flux (HFC-inspired, uses amplitude proxy)
  const onset: number[] = new Array(peaks.length).fill(0)
  for (let i = 1; i < peaks.length; i++) {
    // squared amplitude ≈ energy proxy
    const diff = peaks[i] ** 2 - peaks[i - 1] ** 2
    onset[i] = Math.max(0, diff)
  }

  // ── Step 2: local-mean normalise onset ──────────────────────────────────
  const W = Math.round(bucketsPerSec * 0.2)    // 200 ms local window
  const onsetNorm: number[] = new Array(onset.length).fill(0)
  for (let i = 0; i < onset.length; i++) {
    let sum = 0, count = 0
    for (let j = Math.max(0, i - W); j <= Math.min(onset.length - 1, i + W); j++) {
      sum += onset[j]; count++
    }
    const local = sum / count
    onsetNorm[i] = local > 0 ? onset[i] / local : 0
  }

  // ── Step 3: peak picking (local max within ±minBeatGap) ─────────────────
  const minBeatSec = 60 / bpmRange[1]          // shortest beat at max BPM
  const minGap = Math.round(minBeatSec / secPerBucket)
  const onsetTimes: number[] = []
  let lastPeak = -minGap
  for (let i = 1; i < onsetNorm.length - 1; i++) {
    if (
      onsetNorm[i] > onsetNorm[i - 1] &&
      onsetNorm[i] >= onsetNorm[i + 1] &&
      onsetNorm[i] > 1.5 &&                    // above local mean × 1.5
      i - lastPeak >= minGap
    ) {
      onsetTimes.push(i * secPerBucket)
      lastPeak = i
    }
  }

  if (onsetTimes.length < 4) {
    // Not enough onsets — return a default 120 BPM grid
    const bpm = 120
    const beatDur = 60 / bpm
    const beats: number[] = []
    for (let t = 0; t < wf.duration; t += beatDur) beats.push(+t.toFixed(3))
    return { bpm, beats, confidence: 0 }
  }

  // ── Step 4: estimate BPM from inter-onset intervals ─────────────────────
  const intervals: number[] = []
  for (let i = 1; i < onsetTimes.length; i++) {
    intervals.push(onsetTimes[i] - onsetTimes[i - 1])
  }

  // Build histogram of tempo candidates (1/IOI → BPM, consider 1x, 2x, 0.5x)
  const bpmCandidates: Record<number, number> = {}
  for (const ioi of intervals) {
    for (const mult of [1, 2, 0.5]) {
      const bpmCand = Math.round(60 / ioi * mult)
      if (bpmCand >= bpmRange[0] && bpmCand <= bpmRange[1]) {
        bpmCandidates[bpmCand] = (bpmCandidates[bpmCand] ?? 0) + 1
      }
    }
  }
  const bpm = +Object.entries(bpmCandidates)
    .sort(([, a], [, b]) => b - a)[0][0]

  // ── Step 5: compute confidence (std-dev of dominant interval) ───────────
  const beatDur = 60 / bpm
  const deviations = intervals
    .map(d => {
      const snapped = Math.round(d / beatDur) * beatDur
      return Math.abs(d - snapped)
    })
  const meanDev = deviations.reduce((s, v) => s + v, 0) / deviations.length
  const confidence = Math.max(0, Math.min(1, 1 - meanDev / beatDur))

  // ── Step 6: snap onset times to a regular grid ──────────────────────────
  const firstOnset = onsetTimes[0]
  const beats: number[] = []
  for (let t = firstOnset; t <= wf.duration + beatDur; t += beatDur) {
    beats.push(+t.toFixed(3))
  }

  return { bpm, beats, confidence: +confidence.toFixed(3) }
}

// ── Comprehensive asset analysis ────────────────────────────────────────────

export async function analyzeAsset(filePath: string, filename: string): Promise<AssetAnalysis> {
  const info = await getMediaInfo(filePath)
  let silenceSpans: SilenceSpan[] = []
  let loudestMoment = 0
  let rmsAvg = 0

  if (info.hasAudio) {
    try {
      silenceSpans = findSilence(filePath, { threshold: 0.015, minDuration: 0.3 })

      // Compute waveform stats for loudest moment + RMS avg
      const wf = computeWaveform(filePath, Math.min(3000, Math.ceil(info.duration * 10)))
      const secPerBucket = info.duration / wf.bucketCount
      let maxPeak = 0
      let sum = 0
      for (let i = 0; i < wf.bucketCount; i++) {
        sum += wf.peaks[i] ** 2
        if (wf.peaks[i] > maxPeak) {
          maxPeak = wf.peaks[i]
          loudestMoment = +(i * secPerBucket).toFixed(3)
        }
      }
      rmsAvg = +Math.sqrt(sum / wf.bucketCount).toFixed(4)
    } catch { /* native engine unavailable */ }
  }

  const silenceDur = silenceSpans.reduce((s, sp) => s + sp.duration, 0)
  const silenceRatio = info.duration > 0 ? +(silenceDur / info.duration).toFixed(3) : 0

  return {
    filename,
    duration: +info.duration.toFixed(3),
    hasVideo: !!info.hasVideo,
    hasAudio: !!info.hasAudio,
    width: info.width,
    height: info.height,
    fps: +info.fps.toFixed(2),
    silenceRatio,
    silenceSpans,
    loudestMoment,
    rmsAvg,
  }
}
