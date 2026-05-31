import { execSync, spawn } from 'child_process'
import * as path from 'path'
import * as fs from 'fs'
import ffmpeg from 'fluent-ffmpeg'
import { getMediaInfo } from './ffprobe'
import { getAssetDir, importSRT, parseSRT } from '../core/projectManager'
import { getWhisperBinPath } from './whisperDownload'
import { extractAudioWavNative } from '../core/mediaEngine'
import { acquireWhisperLock } from './whisperMutex'

// ── Detection ────────────────────────────────────────────────────────────────

export interface WhisperStatus {
  available: boolean
  path: string
}

let _cache: WhisperStatus | null = null

/**
 * Detect whisper.cpp binary. Tries:
 * 1. customPath (from settings)
 * 2. Managed binary (auto-downloaded to userData/whisper/bin/)
 * 3. Common names on PATH
 * Result is cached after the first successful call.
 */
export function detectWhisper(customPath?: string): WhisperStatus {
  if (_cache && !customPath) return _cache

  const managedBin = getWhisperBinPath()
  const candidates = customPath
    ? [customPath]
    : [managedBin, 'whisper-cli', 'whisper-cpp', 'whisper', 'main']

  for (const bin of candidates) {
    try {
      if (bin === managedBin && !fs.existsSync(bin)) continue
      // whisper-cli --help may exit with code 1 (deprecation warning), so use --version or just check existence + run
      execSync(`"${bin}" --version`, { timeout: 5000, stdio: 'pipe' })
      const result = { available: true, path: bin }
      if (!customPath) _cache = result
      return result
    } catch (e: any) {
      // Some versions exit non-zero but still work — check if it's a "not found" error vs "ran but failed"
      if (e.status != null && e.status <= 1 && (e.stdout || e.stderr)) {
        // Binary exists and ran, just returned non-zero
        const result = { available: true, path: bin }
        if (!customPath) _cache = result
        return result
      }
    }
  }

  const result = { available: false, path: '' }
  if (!customPath) _cache = result
  return result
}

/** Clear cached detection (e.g. after settings change) */
export function clearWhisperCache() {
  _cache = null
}

// ── Audio extraction ─────────────────────────────────────────────────────────

/**
 * Extract audio from a media file to 16kHz mono WAV (whisper.cpp requirement).
 *
 * Tries the native Rust pipeline first (symphonia decode → rubato resample → hound writer),
 * then falls back to ffmpeg for containers symphonia can't handle (webm/mkv/avi/etc).
 */
export function extractAudioToWav(inputPath: string, outputWavPath: string): Promise<void> {
  // Try native first — in-process, avoids ffmpeg spawn overhead
  try {
    extractAudioWavNative(inputPath, outputWavPath, 16000, 1)
    return Promise.resolve()
  } catch (err: any) {
    console.warn('[whisper] native audio extract failed, falling back to ffmpeg:', err?.message ?? err)
  }

  // Fallback: ffmpeg for unsupported containers
  return new Promise((resolve, reject) => {
    ffmpeg(inputPath)
      .noVideo()
      .audioFrequency(16000)
      .audioChannels(1)
      .format('wav')
      .output(outputWavPath)
      .on('end', () => resolve())
      .on('error', (err) => reject(err))
      .run()
  })
}

// ── Transcription ────────────────────────────────────────────────────────────

export interface TranscribeOptions {
  wavPath: string
  modelPath: string
  language: string
  audioDuration: number
  whisperPath?: string
  onProgress?: (percent: number) => void
}

/**
 * Run whisper.cpp and produce an SRT file.
 * Returns the path to the generated .srt file.
 */
export async function transcribe(opts: TranscribeOptions): Promise<string> {
  const { wavPath, modelPath, language, audioDuration, onProgress } = opts
  const whisperBin = opts.whisperPath || detectWhisper().path
  if (!whisperBin) throw new Error('whisper.cpp not found')

  // Acquire cross-process lock — kills any running whisper-cli child from
  // other sessions so two GPU jobs never overlap.
  const lock = await acquireWhisperLock()

  return new Promise<string>((resolve, reject) => {
    const outputStem = wavPath.replace(/\.wav$/i, '')

    const args = [
      '-m', modelPath,
      '-l', language,
      '--output-srt',
      '-pp',              // print-progress → emits "progress = N%" on stderr
      '-of', outputStem,
      wavPath,
    ]

    console.log(`[whisper] Running: ${whisperBin} ${args.join(' ')}`)

    const proc = spawn(whisperBin, args, { stdio: ['ignore', 'pipe', 'pipe'] })
    if (proc.pid) lock.setChild(proc.pid)

    let lastProgress = 0
    // Keep a tail of stderr so we can surface real errors on failure
    let stderrTail = ''
    const STDERR_TAIL_MAX = 2000

    // Parse stderr for progress. Two signals:
    //   1. "progress = 42%"     — from -pp flag (continuous, preferred)
    //   2. "[hh:mm:ss.mmm --> hh:mm:ss.mmm]"  — per-segment timestamps (fallback)
    proc.stderr.on('data', (data: Buffer) => {
      const text = data.toString()
      stderrTail += text
      if (stderrTail.length > STDERR_TAIL_MAX) {
        stderrTail = stderrTail.slice(-STDERR_TAIL_MAX)
      }

      const pctMatches = text.matchAll(/progress\s*=\s*(\d+)%/g)
      for (const pm of pctMatches) {
        const pct = Math.min(99, parseInt(pm[1], 10))
        if (pct > lastProgress) {
          lastProgress = pct
          onProgress?.(pct)
        }
      }

      const tsMatches = text.matchAll(/\[\d{2}:\d{2}:\d{2}\.\d{3}\s*-->\s*(\d{2}):(\d{2}):(\d{2})\.(\d{3})\]/g)
      for (const m of tsMatches) {
        const endSec = parseInt(m[1]) * 3600 + parseInt(m[2]) * 60 + parseInt(m[3]) + parseInt(m[4]) / 1000
        if (audioDuration > 0) {
          const pct = Math.min(99, Math.round((endSec / audioDuration) * 100))
          if (pct > lastProgress) {
            lastProgress = pct
            onProgress?.(pct)
          }
        }
      }
    })

    proc.stdout.on('data', () => {}) // drain

    proc.on('close', (code, signal) => {
      lock.release()
      const srtPath = outputStem + '.srt'
      if (code === 0 && fs.existsSync(srtPath)) {
        resolve(srtPath)
      } else if (signal === 'SIGTERM') {
        reject(new Error('whisper.cpp aborted: another auto-subtitle job took over (newer request wins)'))
      } else {
        const msg = stderrTail.trim().split('\n').slice(-5).join(' | ') || '(no stderr)'
        reject(new Error(`whisper.cpp exited with code ${code}: ${msg}`))
      }
    })

    proc.on('error', (err) => {
      lock.release()
      reject(err)
    })
  })
}

// ── Full auto-subtitle flow ──────────────────────────────────────────────────

export interface AutoSubtitleOptions {
  projectId: string
  assetFilename: string
  language: string
  modelPath: string
  whisperPath?: string
  onProgress?: (stage: string, percent: number) => void
}

/**
 * Full auto-subtitle pipeline:
 * 1. Extract audio from asset to WAV
 * 2. Transcribe with whisper.cpp
 * 3. Import SRT into project timeline
 */
export async function autoSubtitle(opts: AutoSubtitleOptions): Promise<{ srtContent: string; count: number }> {
  const { projectId, assetFilename, language, modelPath, whisperPath, onProgress } = opts

  const assetDir = getAssetDir(projectId)
  const assetPath = path.join(assetDir, assetFilename)
  if (!fs.existsSync(assetPath)) {
    throw new Error(`Asset not found: ${assetFilename}`)
  }

  // Temp WAV path in the asset directory
  const wavPath = path.join(assetDir, `_whisper_temp_${Date.now()}.wav`)

  try {
    // Step 1: Get duration
    const info = await getMediaInfo(assetPath)

    // Step 2: Extract audio
    onProgress?.('extracting', 0)
    await extractAudioToWav(assetPath, wavPath)
    onProgress?.('extracting', 100)

    // Step 3: Transcribe
    onProgress?.('transcribing', 0)
    const srtPath = await transcribe({
      wavPath,
      modelPath,
      language,
      audioDuration: info.duration,
      whisperPath,
      onProgress: (pct) => onProgress?.('transcribing', pct),
    })

    // Step 4: Read SRT and import
    onProgress?.('importing', 0)
    const srtContent = fs.readFileSync(srtPath, 'utf-8')
    const { count } = await importSRT(projectId, srtContent)

    // Clean up whisper output SRT (it's now in the project)
    try { fs.unlinkSync(srtPath) } catch {}

    onProgress?.('done', 100)
    return { srtContent, count }
  } finally {
    // Always clean up temp WAV
    try { fs.unlinkSync(wavPath) } catch {}
  }
}

// ── Multi-clip auto-subtitle ─────────────────────────────────────────────────

/** A single clip on the timeline referencing an asset file. */
export interface ClipSpec {
  source: string        // filename inside project assets dir
  timelineStart: number // clip.start on the timeline (seconds)
  trimStart: number     // clip.trimStart (seconds into the source) — default 0
  trimEnd: number       // trimStart + (clip.end - clip.start)
}

export interface AutoSubtitleAllOptions {
  projectId: string
  clips: ClipSpec[]
  language: string
  modelPath: string
  whisperPath?: string
  onProgress?: (stage: string, percent: number, detail?: string) => void
}

interface Cue { start: number; end: number; text: string }

/**
 * Transcribe every supplied clip and merge the results into one subtitle track.
 *
 *  - Groups clips by source → each source is extracted & transcribed **once**
 *  - For each clip: keep cues inside [trimStart, trimEnd], offset by (timelineStart - trimStart)
 *  - Merges, sorts by time, rebuilds SRT content → importSRT
 */
export async function autoSubtitleAll(
  opts: AutoSubtitleAllOptions,
): Promise<{ count: number }> {
  const { projectId, clips, language, modelPath, whisperPath, onProgress } = opts
  if (clips.length === 0) throw new Error('No clips to transcribe')

  const assetDir = getAssetDir(projectId)

  // Group clips by source so we transcribe each source file only once
  const sourceToClips = new Map<string, ClipSpec[]>()
  for (const c of clips) {
    if (!c.source) continue
    const arr = sourceToClips.get(c.source) ?? []
    arr.push(c)
    sourceToClips.set(c.source, arr)
  }
  const sources = [...sourceToClips.keys()]
  if (sources.length === 0) throw new Error('No clips with source file')

  // Transcribe each source once
  const sourceCues = new Map<string, Cue[]>()
  for (let i = 0; i < sources.length; i++) {
    const source = sources[i]
    const sourceLabel = `[${i + 1}/${sources.length}] ${source}`
    const assetPath = path.join(assetDir, source)
    if (!fs.existsSync(assetPath)) {
      console.warn(`[autoSubtitleAll] asset not found, skipping: ${source}`)
      continue
    }

    const wavPath = path.join(assetDir, `_whisper_temp_${Date.now()}_${i}.wav`)
    try {
      onProgress?.('extracting', Math.round((i / sources.length) * 100), sourceLabel)
      await extractAudioToWav(assetPath, wavPath)

      const info = await getMediaInfo(assetPath)

      onProgress?.('transcribing', 0, sourceLabel)
      const srtPath = await transcribe({
        wavPath,
        modelPath,
        language,
        audioDuration: info.duration,
        whisperPath,
        onProgress: (pct) => {
          // Overall progress = (completed sources + current pct) / total sources
          const overall = Math.round(((i + pct / 100) / sources.length) * 100)
          onProgress?.('transcribing', overall, sourceLabel)
        },
      })

      const srtContent = fs.readFileSync(srtPath, 'utf-8')
      sourceCues.set(source, parseSRT(srtContent) as Cue[])
      try { fs.unlinkSync(srtPath) } catch {}
    } finally {
      try { fs.unlinkSync(wavPath) } catch {}
    }
  }

  // For each clip, filter cues by its trim window and offset to timeline position
  const merged: Cue[] = []
  for (const clip of clips) {
    const cues = sourceCues.get(clip.source)
    if (!cues) continue
    const offset = clip.timelineStart - clip.trimStart
    for (const cue of cues) {
      // Keep any cue that overlaps the trim window
      if (cue.end <= clip.trimStart || cue.start >= clip.trimEnd) continue
      const cs = Math.max(cue.start, clip.trimStart)
      const ce = Math.min(cue.end, clip.trimEnd)
      merged.push({
        start: cs + offset,
        end: ce + offset,
        text: cue.text,
      })
    }
  }

  // Sort by time, rebuild SRT content
  merged.sort((a, b) => a.start - b.start)

  onProgress?.('importing', 0)
  const mergedSrt = formatSRT(merged)
  const { count } = await importSRT(projectId, mergedSrt)

  onProgress?.('done', 100)
  return { count }
}

/** Serialize cues back to SRT format. */
function formatSRT(cues: Cue[]): string {
  return cues.map((c, i) => {
    return `${i + 1}\n${formatSrtTs(c.start)} --> ${formatSrtTs(c.end)}\n${c.text}\n`
  }).join('\n')
}

function formatSrtTs(seconds: number): string {
  if (seconds < 0) seconds = 0
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  const s = Math.floor(seconds % 60)
  const ms = Math.round((seconds - Math.floor(seconds)) * 1000)
  const pad = (n: number, w = 2) => String(n).padStart(w, '0')
  return `${pad(h)}:${pad(m)}:${pad(s)},${pad(ms, 3)}`
}
