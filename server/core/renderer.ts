import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'
import ffmpeg from 'fluent-ffmpeg'
import { Project, RenderOptions, RenderResult, RenderProgress, VideoSegment, RenderQuality, resolveResolution } from './types'
import { buildFfmpegPlan } from './ffmpegBuilder'
import { getAssetDir, getOutputDir } from './projectManager'
import { detectHwAccel } from '../utils/hwAccel'

export type ProgressCallback = (progress: RenderProgress) => void

export async function renderProject(
  project: Project,
  options: RenderOptions,
  onProgress: ProgressCallback
): Promise<RenderResult> {
  const { quality, format = 'mp4' } = options
  const audioOnly = format === 'wav'
  const [width, height] = resolveResolution(project.aspectRatio, quality)

  const assetDir = getAssetDir(project.id)
  const defaultOutputDir = getOutputDir(project.id)
  const outputDir = options.outputDir || defaultOutputDir
  if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true })
  // Also ensure default dir exists for relativePath
  if (options.outputDir && !fs.existsSync(defaultOutputDir)) fs.mkdirSync(defaultOutputDir, { recursive: true })

  const timestamp = Date.now()
  const ext = audioOnly ? 'wav' : format === 'webm' ? 'webm' : format === 'mov' ? 'mov' : 'mp4'
  const outputFile = audioOnly
    ? `13soul_audio_${timestamp}.${ext}`
    : `13soul_${quality}_${timestamp}.${ext}`
  const outputPath = path.join(outputDir, outputFile)

  // Temp dir for text files
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), '13soul-'))

  let renderFailed = false
  try {
    const hw = detectHwAccel()
    const gpuMsg = audioOnly ? '🎵 僅音訊輸出 (PCM)' : hw.nvenc ? '⚡ GPU 加速 (NVENC)' : '🖥 CPU 渲染 (libx264)'
    onProgress({ status: 'rendering', progress: 5, message: `解析專案... ${gpuMsg}` })

    const plan = await buildFfmpegPlan(project, assetDir, outputPath, quality, tmpDir, audioOnly, options.fps ?? 30, options.applyWatermark === true)

    // Write filter_complex to a script file to avoid Windows 32,767-char command line limit.
    const filterScriptPath = path.join(tmpDir, 'filter_complex.txt')
    fs.writeFileSync(filterScriptPath, plan.filterComplex, 'utf8')
    if (process.env.DEBUG_FFMPEG) {
      console.log('[ffmpeg] filter_complex written to:', filterScriptPath)
      console.log('[ffmpeg] filter_complex length:', plan.filterComplex.length)
      console.log('[ffmpeg] filter_complex HEAD (first 2000 chars):\n', plan.filterComplex.slice(0, 2000))
    }

    onProgress({ status: 'rendering', progress: 15, message: '準備 ffmpeg 輸入...' })

    try {
      await runFfmpeg(plan, outputPath, quality, width, height, onProgress, hw.nvenc, options, filterScriptPath)
    } catch (err) {
      // NVENC can fail when GPU is busy / driver mismatch / session limit reached.
      // Detect those cases and retry once on libx264 so the user still gets a render
      // instead of a hard failure.
      if (hw.nvenc && !audioOnly && isNvencFailure(err)) {
        onProgress({
          status: 'rendering',
          progress: 18,
          message: 'NVENC 失敗，改用 CPU (libx264) 重試...',
        })
        try {
          await runFfmpeg(plan, outputPath, quality, width, height, onProgress, false, options, filterScriptPath)
        } catch (cpuErr) {
          renderFailed = true
          console.log('[ffmpeg] render failed (after NVENC fallback), preserving tmp dir for inspection:', tmpDir)
          throw cpuErr
        }
      } else {
        renderFailed = true
        console.log('[ffmpeg] render failed, preserving tmp dir for inspection:', tmpDir)
        throw err
      }
    }

    const relativePath = `/outputs/${project.id}/${outputFile}`

    onProgress({
      status: 'done',
      progress: 100,
      message: '渲染完成！',
      output: relativePath,
    })

    return {
      outputPath,
      relativePath,
      duration: project.duration,
      resolution: `${width}x${height}`,
    }
  } finally {
    // Keep tmp files on failure so we can inspect filter_complex.txt and text_*.txt
    if (!renderFailed) {
      try { fs.rmSync(tmpDir, { recursive: true }) } catch {}
    }
  }
}

// Match common NVENC failure modes. We only retry on libx264 when the error
// looks GPU-specific — a generic ffmpeg error (bad filter, missing input)
// would just fail again on CPU and waste time.
const NVENC_ERROR_PATTERNS = [
  /nvenc/i,
  /nvcuda/i,
  /cuda/i,
  /no nvidia devices/i,
  /no capable devices/i,
  /OpenEncodeSessionEx/i,
  /InitializeEncoder/i,
  /h264_nvenc/i,
]

function isNvencFailure(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err ?? '')
  return NVENC_ERROR_PATTERNS.some(re => re.test(msg))
}

function getNvencPreset(quality: RenderQuality): string[] {
  switch (quality) {
    case '4k':     return ['-preset', 'p5', '-rc:v', 'vbr', '-cq:v', '18', '-b:v', '0']
    case '2k':     return ['-preset', 'p4', '-rc:v', 'vbr', '-cq:v', '19', '-b:v', '0']
    case 'high':   return ['-preset', 'p4', '-rc:v', 'vbr', '-cq:v', '19', '-b:v', '0']
    case '720p':   return ['-preset', 'p3', '-rc:v', 'vbr', '-cq:v', '23', '-b:v', '0']
    default:       return ['-preset', 'p2', '-rc:v', 'vbr', '-cq:v', '27', '-b:v', '0']
  }
}

function getX264Preset(quality: RenderQuality): string[] {
  switch (quality) {
    case '4k':     return ['-preset', 'slow', '-crf', '18']
    case '2k':     return ['-preset', 'slow', '-crf', '19']
    case 'high':   return ['-preset', 'slow', '-crf', '20']
    case '720p':   return ['-preset', 'medium', '-crf', '24']
    default:       return ['-preset', 'fast', '-crf', '28']
  }
}

function runFfmpeg(
  plan: Awaited<ReturnType<typeof buildFfmpegPlan>>,
  outputPath: string,
  quality: RenderQuality,
  width: number,
  height: number,
  onProgress: ProgressCallback,
  useNvenc: boolean = false,
  options: RenderOptions = { quality: 'high' },
  filterScriptPath?: string
): Promise<void> {
  return new Promise((resolve, reject) => {
    let cmd = ffmpeg()

    const IMG_EXTS = new Set(['.png', '.jpg', '.jpeg', '.bmp', '.webp', '.gif'])
    const imgFramerate = options.fps ?? 30
    plan.inputFiles.forEach(f => {
      const ext = path.extname(f).toLowerCase()
      if (IMG_EXTS.has(ext)) {
        cmd = cmd.input(f).inputOptions(['-loop', '1', '-framerate', `${imgFramerate}`])
      } else {
        cmd = cmd.input(f)
      }
    })

    const format = options.format ?? 'mp4'
    const audioOnly = format === 'wav'
    const isWebm = format === 'webm'

    const outputOptions: string[] = audioOnly
      ? [
          '-vn',
          '-c:a', 'pcm_s16le',
          '-ar', '44100',
          '-ac', '2',
          '-y',
        ]
      : isWebm
      ? [
          '-c:v', 'libvpx-vp9',
          ...(options.videoBitrate ? ['-b:v', options.videoBitrate] : ['-crf', '30', '-b:v', '0']),
          '-pix_fmt', 'yuv420p',
          '-y',
        ]
      : useNvenc
        ? [
            '-c:v', 'h264_nvenc',
            ...(options.videoBitrate ? ['-b:v', options.videoBitrate] : getNvencPreset(quality)),
            '-pix_fmt', 'yuv420p',
            '-movflags', '+faststart',
            '-y',
          ]
        : [
            '-c:v', 'libx264',
            ...(options.videoBitrate ? ['-b:v', options.videoBitrate] : getX264Preset(quality)),
            '-pix_fmt', 'yuv420p',
            '-movflags', '+faststart',
            '-y',
          ]

    // FPS (not applicable to audio-only)
    if (!audioOnly && options.fps) {
      outputOptions.push('-r', `${options.fps}`)
    }

    // Export range: trim the rendered output to [startSec, endSec]. Applied
    // as output options so the filter graph still sees the full timeline.
    if (options.startSec !== undefined && options.startSec > 0) {
      outputOptions.push('-ss', String(options.startSec))
    }
    if (options.endSec !== undefined) {
      const start = options.startSec ?? 0
      outputOptions.push('-t', String(Math.max(0.1, options.endSec - start)))
    }

    if (!audioOnly && plan.hasAudio) {
      const audioBitrate = options.audioBitrate ?? '128k'
      if (isWebm) {
        outputOptions.push('-c:a', 'libopus', '-b:a', audioBitrate, '-shortest')
      } else {
        outputOptions.push('-c:a', 'aac', '-b:a', audioBitrate, '-shortest')
      }
    }

    if (filterScriptPath) {
      cmd = cmd.outputOptions(['-filter_complex_script', filterScriptPath])
    } else {
      cmd = cmd.complexFilter(plan.filterComplex)
    }

    if (audioOnly) {
      if (!plan.audioOutputLabel) {
        reject(new Error('專案沒有任何音源'))
        return
      }
      cmd = cmd.outputOptions(outputOptions).map(`[${plan.audioOutputLabel}]`)
    } else {
      cmd
        .outputOptions(outputOptions)
        .map(`[${plan.videoOutputLabel}]`)

      if (plan.hasAudio && plan.audioOutputLabel) {
        cmd = cmd.map(`[${plan.audioOutputLabel}]`)
      }
    }

    const ff = cmd.output(outputPath)
    ff.on('start', (cmdLine: string) => {
      console.log('[ffmpeg] Command:', cmdLine)
      onProgress({ status: 'rendering', progress: 20, message: '開始渲染影片軌...' })
    })
    ff.on('progress', (prog: any) => {
      const pct = prog.percent ? Math.min(90, Math.round(20 + prog.percent * 0.7)) : 50
      onProgress({
        status: 'rendering',
        progress: pct,
        message: `渲染中... ${prog.timemark ?? ''}`,
      })
    })
    ff.on('end', () => {
      resolve()
    })
    ff.on('error', (err: Error, _stdout: string | null, stderr: string | null) => {
      console.error('[ffmpeg] Error:', err.message)
      console.error('[ffmpeg] stderr:', stderr)
      reject(new Error(`ffmpeg failed: ${err.message}\n${stderr ?? ''}`))
    })
    ff.run()
  })
}

/**
 * Render a single preview frame at the given timestamp.
 * Returns the JPEG buffer.
 */
export function renderPreviewFrame(
  project: Project,
  timeSeconds: number,
  tmpDir: string
): Promise<Buffer> {
  const assetDir = getAssetDir(project.id)
  const videoTracks = project.timeline.tracks
    .filter(t => t.type === 'video')
    .sort((a, b) => a.order - b.order)
  const videoSegments = (videoTracks[0]?.clips ?? []) as VideoSegment[]

  // Find which video clip is active at this timestamp
  const activeClip = videoSegments.find(
    seg => timeSeconds >= seg.start && timeSeconds < seg.end
  )

  if (!activeClip) {
    return Promise.reject(new Error('No video clip at the given timestamp'))
  }

  const clipTime = (activeClip.trimStart ?? 0) + (timeSeconds - activeClip.start)
  const clipPath = path.isAbsolute(activeClip.source)
    ? activeClip.source
    : path.join(assetDir, activeClip.source)

  const outputFile = path.join(tmpDir, `preview_${Date.now()}.jpg`)

  return new Promise((resolve, reject) => {
    ffmpeg(clipPath)
      .seekInput(clipTime)
      .frames(1)
      .size('540x960')
      .aspect('9:16')
      .autopad(true, 'black')
      .output(outputFile)
      .outputOptions(['-y'])
      .on('end', () => {
        try {
          const buf = fs.readFileSync(outputFile)
          fs.unlinkSync(outputFile)
          resolve(buf)
        } catch (e) {
          reject(e)
        }
      })
      .on('error', (err: Error) => reject(err))
      .run()
  })
}
