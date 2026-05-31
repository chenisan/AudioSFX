import { spawn } from 'child_process'

/**
 * Build ffmpeg args for transcoding any container → MP4 (h264 + aac).
 * Used by the realtime recording auto-import flow: browser .webm → timeline .mp4.
 *
 * Why libx264 (not NVENC): this runs once per recording, ~10-30s clips. The
 * NVENC pipeline cost isn't worth it and libx264 keeps Mac/Windows parity.
 * The main render path keeps using NVENC unaffected.
 */
export function buildMp4Args(input: string, output: string): string[] {
  return [
    '-y',
    '-i', input,
    '-c:v', 'libx264',
    '-preset', 'veryfast',
    '-pix_fmt', 'yuv420p',
    '-c:a', 'aac',
    '-b:a', '160k',
    '-movflags', '+faststart',
    output,
  ]
}

/**
 * Build ffmpeg args for stripping video and re-muxing audio to M4A (aac).
 * Used when the source recording is mic-only (no video stream to keep).
 */
export function buildM4aArgs(input: string, output: string): string[] {
  return [
    '-y',
    '-i', input,
    '-vn',
    '-c:a', 'aac',
    '-b:a', '160k',
    '-movflags', '+faststart',
    output,
  ]
}

async function runFfmpeg(args: string[], ffmpegBin: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const proc = spawn(ffmpegBin, args)
    let stderr = ''
    proc.stderr.on('data', (d: Buffer) => { stderr += d.toString() })
    proc.on('close', code => {
      if (code === 0) resolve()
      else reject(new Error(`ffmpeg exit ${code}: ${stderr.slice(-500)}`))
    })
    proc.on('error', reject)
  })
}

export async function transcodeToMp4(
  input: string,
  output: string,
  ffmpegBin = 'ffmpeg'
): Promise<{ outputPath: string }> {
  await runFfmpeg(buildMp4Args(input, output), ffmpegBin)
  return { outputPath: output }
}

export async function transcodeToM4a(
  input: string,
  output: string,
  ffmpegBin = 'ffmpeg'
): Promise<{ outputPath: string }> {
  await runFfmpeg(buildM4aArgs(input, output), ffmpegBin)
  return { outputPath: output }
}
