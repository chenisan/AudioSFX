import { spawn } from 'child_process'

/**
 * Render a solid color clip to a temp .mov file. Used by ffmpegBuilder for
 * `colorFill` clips so they slot into the existing input/overlay pipeline
 * without needing a separate code path.
 *
 * Uses ffmpeg's lavfi `color=` source — no canvas / external libs needed.
 */
export async function renderColorFillClip(
  color: string,
  duration: number,
  fps: number,
  width: number,
  height: number,
  outputPath: string,
  ffmpegBin = 'ffmpeg'
): Promise<void> {
  // Convert #RRGGBB → 0xRRGGBB which ffmpeg's color= source accepts directly.
  const ffColor = color.startsWith('#') ? '0x' + color.slice(1) : color

  return new Promise((resolve, reject) => {
    const args = [
      '-y',
      '-f', 'lavfi',
      '-i', `color=c=${ffColor}:s=${width}x${height}:d=${duration}:r=${fps}`,
      '-c:v', 'libx264',
      '-pix_fmt', 'yuv420p',
      '-preset', 'ultrafast',
      outputPath,
    ]
    const proc = spawn(ffmpegBin, args)
    let stderr = ''
    proc.stderr.on('data', d => { stderr += d.toString() })
    proc.on('close', code => {
      if (code === 0) resolve()
      else reject(new Error(`color-fill ffmpeg exit ${code}: ${stderr.slice(-500)}`))
    })
    proc.on('error', reject)
  })
}
