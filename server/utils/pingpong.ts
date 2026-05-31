import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import { spawn, execFile } from 'child_process'
import { promisify } from 'util'
import { detectHwAccel } from './hwAccel'
import { getAssetDir } from '../core/projectManager'

const execFileAsync = promisify(execFile)

interface ProbeResult {
  duration: number
  fps: number
  frameCount: number
}

async function probeVideo(filePath: string): Promise<ProbeResult> {
  const ffprobe = process.env.FFPROBE_PATH || 'ffprobe'
  const { stdout } = await execFileAsync(ffprobe, [
    '-v', 'error',
    '-select_streams', 'v:0',
    '-show_entries', 'stream=r_frame_rate,nb_frames,duration',
    '-of', 'json',
    filePath,
  ], { timeout: 10000 })
  const streams = JSON.parse(stdout).streams
  if (!streams || streams.length === 0) throw new Error('no video stream')
  const s = streams[0]
  const duration = parseFloat(s.duration)
  const parts = (s.r_frame_rate as string).split('/').map(Number)
  const num = parts[0] ?? 0
  const den = parts[1] ?? 1
  const fps = den > 0 ? num / den : 0
  let frameCount = parseInt(s.nb_frames ?? '0', 10)
  if (!Number.isFinite(frameCount) || frameCount <= 0) {
    frameCount = Math.round(duration * fps)
  }
  if (!Number.isFinite(duration) || duration <= 0) throw new Error('invalid duration')
  if (!fps || fps <= 0) throw new Error('invalid fps')
  if (frameCount < 3) throw new Error('video has too few frames for ping-pong (need >=3)')
  return { duration, fps, frameCount }
}

function runFfmpeg(args: string[], timeoutMs = 600000): Promise<void> {
  const ffmpegBin = process.env.FFMPEG_PATH || 'ffmpeg'
  return new Promise((resolve, reject) => {
    const child = spawn(ffmpegBin, args, { stdio: ['ignore', 'pipe', 'pipe'] })
    let stderr = ''
    const t = setTimeout(() => {
      child.kill('SIGKILL')
      reject(new Error('ffmpeg timeout'))
    }, timeoutMs)
    child.stderr.on('data', d => { stderr += d.toString() })
    child.on('error', (e) => { clearTimeout(t); reject(e) })
    child.on('exit', (code) => {
      clearTimeout(t)
      if (code === 0) resolve()
      else reject(new Error(`ffmpeg exited ${code}: ${stderr.slice(-1500)}`))
    })
  })
}

function encoderArgs(useNvenc: boolean): string[] {
  return useNvenc
    ? ['-c:v', 'h264_nvenc', '-preset', 'p4', '-rc:v', 'vbr', '-cq:v', '19', '-b:v', '0']
    : ['-c:v', 'libx264', '-preset', 'fast', '-crf', '18']
}

export interface MakePingpongOptions {
  projectId: string
  source: string
  totalDuration?: number
}

export interface MakePingpongResult {
  filename: string
  duration: number
  pairDuration: number
  pairsConcat: number
}

export async function makePingpongAsset(opts: MakePingpongOptions): Promise<MakePingpongResult> {
  const { projectId, source, totalDuration } = opts
  const assetDir = getAssetDir(projectId)
  const srcPath = path.join(assetDir, source)
  if (!fs.existsSync(srcPath)) throw new Error(`Asset not found: ${source}`)

  const { fps, frameCount } = await probeVideo(srcPath)
  const pairDur = (2 * frameCount - 2) / fps
  const target = totalDuration ?? pairDur
  if (target <= 0) throw new Error('totalDuration must be positive')
  const pairsNeeded = Math.max(1, Math.ceil(target / pairDur))

  const { nvenc } = detectHwAccel()

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), '13soul-pingpong-'))
  const pairPath = path.join(tmpDir, 'pair.mp4')
  const outName = `${path.parse(source).name}_pingpong.mp4`
  const outPath = path.join(assetDir, outName)

  try {
    const filter =
      `[0:v]split=2[a][b];` +
      `[b]reverse,trim=start_frame=1:end_frame=${frameCount - 1},setpts=PTS-STARTPTS[rev];` +
      `[a][rev]concat=n=2:v=1:a=0[v]`
    await runFfmpeg([
      '-y',
      '-i', srcPath,
      '-filter_complex', filter,
      '-map', '[v]',
      '-an',
      ...encoderArgs(nvenc),
      '-pix_fmt', 'yuv420p',
      pairPath,
    ])

    if (pairsNeeded === 1 && Math.abs(target - pairDur) < 1e-3) {
      fs.copyFileSync(pairPath, outPath)
    } else {
      const listPath = path.join(tmpDir, 'list.txt')
      const listContent = Array(pairsNeeded)
        .fill(`file '${pairPath.replace(/\\/g, '/')}'`)
        .join('\n') + '\n'
      fs.writeFileSync(listPath, listContent, 'utf8')

      const exactCycles = Math.abs(target - pairsNeeded * pairDur) < 1e-3
      const args = ['-y', '-f', 'concat', '-safe', '0', '-i', listPath]
      if (exactCycles) {
        args.push('-c', 'copy')
      } else {
        args.push(
          '-t', target.toFixed(3),
          ...encoderArgs(nvenc),
          '-pix_fmt', 'yuv420p',
          '-an',
        )
      }
      args.push(outPath)
      await runFfmpeg(args)
    }

    return {
      filename: outName,
      duration: target,
      pairDuration: pairDur,
      pairsConcat: pairsNeeded,
    }
  } finally {
    try { fs.rmSync(tmpDir, { recursive: true, force: true }) } catch {}
  }
}
