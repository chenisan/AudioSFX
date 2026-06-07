// sprite-to-webm.mjs — convert a horizontal sprite sheet into an animated
// sticker. Output format inferred from extension (.apng or .webm).
//
// Uses flood-fill from frame corners so a near-white background becomes
// transparent while interior whites (cloud fill, paper background, etc.)
// stay intact.
//
// IMPORTANT: VP9 + alpha is broken on the gyan.dev Windows ffmpeg build —
// the encoder loses the alpha channel during muxing. Use .apng output for
// reliable transparency until we fix the WebM pipeline. APNG is browser-
// native (plays via <img>), preserves alpha perfectly, and decodes through
// ffmpeg's overlay filter the same way WebM would have.
//
// Usage:
//   node tools/sprite-to-webm.mjs <input.png> <frames> <output> [fps]
//
// Example:
//   node tools/sprite-to-webm.mjs cloud-sprite.png 5 cloud-puff.apng 10

import { createCanvas, loadImage, ImageData as NapiImageData } from '@napi-rs/canvas'
import fs from 'fs'
import path from 'path'
import os from 'os'
import { spawn } from 'child_process'

const [, , inputPath, framesArg, outputPath, fpsArg] = process.argv
if (!inputPath || !framesArg || !outputPath) {
  console.error('Usage: node tools/sprite-to-webm.mjs <input.png> <frames> <output.webm> [fps]')
  process.exit(1)
}
const FRAME_COUNT = parseInt(framesArg, 10)
const FPS = parseInt(fpsArg ?? '10', 10)
// Anything with all RGB channels ≥ this value is treated as background and
// flood-filled to transparent. Source PNGs often have very pale gray
// (~RGB 235–240) backgrounds rather than pure white, so a fairly aggressive
// threshold catches the entire background panel without eating cartoon
// cloud / paper-doodle interior shading (which lands < 200 near outlines).
// Override via env: SPRITE_WHITE_THRESHOLD=200
const WHITE_THRESHOLD = Number(process.env.SPRITE_WHITE_THRESHOLD) || 220

async function main() {
  if (!fs.existsSync(inputPath)) throw new Error(`Input not found: ${inputPath}`)
  const img = await loadImage(inputPath)
  const W = img.width, H = img.height
  const frameW = Math.floor(W / FRAME_COUNT)
  console.log(`Input ${W}×${H}, ${FRAME_COUNT} frames of ${frameW}×${H}`)

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sprite-'))
  console.log(`Tmp: ${tmpDir}`)

  // Auto-crop frame: trim transparent rows/cols around the doodle so the final
  // sticker isn't padded with empty space. Computed per-frame from the
  // alpha-keyed image data.
  const cropBoxes = []
  for (let i = 0; i < FRAME_COUNT; i++) {
    const canvas = createCanvas(frameW, H)
    const ctx = canvas.getContext('2d')
    ctx.drawImage(img, -i * frameW, 0)
    const imgData = ctx.getImageData(0, 0, frameW, H)
    floodFillTransparent(imgData, frameW, H)
    ctx.putImageData(imgData, 0, 0)

    const bbox = computeBBox(imgData, frameW, H)
    cropBoxes.push(bbox)
    fs.writeFileSync(path.join(tmpDir, `f_${String(i).padStart(2, '0')}.png`), canvas.toBuffer('image/png'))
  }

  // Use the union bounding box across all frames so each frame stays in the
  // same coordinate space. Otherwise the cloud "moves" between frames.
  const ub = unionBBox(cropBoxes, frameW, H)
  const padding = 20
  const cropX = Math.max(0, ub.x - padding)
  const cropY = Math.max(0, ub.y - padding)
  const cropW = Math.min(frameW, ub.w + padding * 2)
  const cropH = Math.min(H, ub.h + padding * 2)
  console.log(`Crop box: ${cropW}×${cropH} at (${cropX},${cropY})`)

  // Re-render each frame with crop applied
  for (let i = 0; i < FRAME_COUNT; i++) {
    const src = createCanvas(frameW, H)
    const sctx = src.getContext('2d')
    sctx.drawImage(img, -i * frameW, 0)
    const imgData = sctx.getImageData(0, 0, frameW, H)
    floodFillTransparent(imgData, frameW, H)

    const out = createCanvas(cropW, cropH)
    const octx = out.getContext('2d')
    octx.putImageData(imgData, -cropX, -cropY)
    fs.writeFileSync(path.join(tmpDir, `c_${String(i).padStart(2, '0')}.png`), out.toBuffer('image/png'))
  }

  // ffmpeg: combine frames → APNG (preferred) or WebM
  const ext = path.extname(outputPath).toLowerCase()
  const args = ext === '.apng'
    ? [
        '-y',
        '-framerate', String(FPS),
        '-i', path.join(tmpDir, 'c_%02d.png'),
        '-plays', '0',                          // 0 = loop forever
        '-vf', 'format=rgba',
        outputPath,
      ]
    : [
        '-y',
        '-framerate', String(FPS),
        '-i', path.join(tmpDir, 'c_%02d.png'),
        '-c:v', 'libvpx-vp9',
        '-pix_fmt', 'yuva420p',
        '-b:v', '0', '-crf', '30',
        '-auto-alt-ref', '0',
        '-lag-in-frames', '0',
        '-metadata:s:v:0', 'alpha_mode=1',
        outputPath,
      ]
  await runFfmpeg(args)

  fs.rmSync(tmpDir, { recursive: true, force: true })
  const stat = fs.statSync(outputPath)
  console.log(`\n✓ Output: ${outputPath} (${(stat.size / 1024).toFixed(1)} KB, ${FRAME_COUNT} frames @ ${FPS}fps)`)
}

// ── Flood-fill from corners — marks all near-white pixels reachable from
// the edges as transparent. Interior whites (inside black outlines) survive.
function floodFillTransparent(imgData, w, h) {
  const data = imgData.data
  const visited = new Uint8Array(w * h)
  const stack = []

  const isNearWhite = (idx) =>
    data[idx] >= WHITE_THRESHOLD && data[idx + 1] >= WHITE_THRESHOLD && data[idx + 2] >= WHITE_THRESHOLD

  // Seed from all 4 edges
  for (let x = 0; x < w; x++) { stack.push([x, 0]); stack.push([x, h - 1]) }
  for (let y = 0; y < h; y++) { stack.push([0, y]); stack.push([w - 1, y]) }

  while (stack.length) {
    const [x, y] = stack.pop()
    if (x < 0 || x >= w || y < 0 || y >= h) continue
    const p = y * w + x
    if (visited[p]) continue
    const idx = p * 4
    if (!isNearWhite(idx)) continue
    visited[p] = 1
    data[idx + 3] = 0  // alpha → transparent
    stack.push([x + 1, y]); stack.push([x - 1, y])
    stack.push([x, y + 1]); stack.push([x, y - 1])
  }
}

// Bounding box of non-transparent pixels
function computeBBox(imgData, w, h) {
  const data = imgData.data
  let minX = w, minY = h, maxX = 0, maxY = 0
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (data[(y * w + x) * 4 + 3] > 0) {
        if (x < minX) minX = x; if (x > maxX) maxX = x
        if (y < minY) minY = y; if (y > maxY) maxY = y
      }
    }
  }
  if (minX > maxX) return { x: 0, y: 0, w: 1, h: 1 }
  return { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 }
}

function unionBBox(boxes, fallbackW, fallbackH) {
  let minX = fallbackW, minY = fallbackH, maxX = 0, maxY = 0
  for (const b of boxes) {
    if (b.x < minX) minX = b.x
    if (b.y < minY) minY = b.y
    if (b.x + b.w > maxX) maxX = b.x + b.w
    if (b.y + b.h > maxY) maxY = b.y + b.h
  }
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY }
}

function runFfmpeg(args) {
  return new Promise((resolve, reject) => {
    const proc = spawn('ffmpeg', args, { stdio: ['ignore', 'pipe', 'pipe'] })
    let err = ''
    proc.stderr.on('data', d => { err += d.toString() })
    proc.on('close', code => {
      if (code === 0) resolve()
      else reject(new Error(`ffmpeg exit ${code}\n${err.slice(-800)}`))
    })
    proc.on('error', reject)
  })
}

main().catch(e => { console.error('✗', e.message); process.exit(1) })
