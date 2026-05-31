#!/usr/bin/env node
// motion-ingest — prep a reference video for the motion library.
//
// Does the deterministic, mechanical half of ingestion: download (YouTube) or
// take a local file, scene-detect frames, build contact sheets, then DELETE
// the source video so nothing large lingers (governance: 外部生成/下載不囤檔).
// The vision half — looking at the sheets and writing the motif JSON — is done
// by a human / Claude, then POSTed to /api/motion-library/sources.
//
// Usage:
//   node scripts/motion-ingest.mjs <youtube-url|local-file> [options]
//
// Options:
//   --range 0:30-1:05   only download/analyze this time window (YouTube only)
//   --threshold 0.35    ffmpeg scene-change sensitivity (lower = more frames)
//   --every 8           keep every Nth detected scene frame
//   --cols 4 --rows 3   contact sheet grid
//   --keep-video        do NOT delete the downloaded/source video afterwards
//   --no-overlay        skip burning timestamp text into each scene frame
//   --no-preview        skip saving a representative sheet under data/motion-library/previews/
//   --out <dir>         working dir (default: scratch/motion-trial/<sourceId>)
//
// After it prints the sheet paths: open them, write the source JSON (see
// data/motion-library/sources/*.json for the shape). Each cell in the sheet
// shows its original-video timestamp (HH:MM:SS) so motifs can record
// `sourceTimestamp: <seconds>` for YouTube deep-linking. The middle sheet is
// saved to data/motion-library/previews/<sourceId>.jpg as the source's
// thumbnail — drop its basename into `source.previewSheet`. Delete the
// working dir when done — only the JSON should survive.

import { execFileSync } from 'node:child_process'
import * as fs from 'node:fs'
import * as path from 'node:path'

const argv = process.argv.slice(2)
if (argv.length === 0 || argv[0].startsWith('--')) {
  console.error('usage: node scripts/motion-ingest.mjs <youtube-url|local-file> [--range a-b] [--threshold 0.35] [--every 8] [--cols 4] [--rows 3] [--keep-video] [--out dir]')
  process.exit(1)
}

const input = argv[0]
const opt = (name, def) => {
  const i = argv.indexOf(`--${name}`)
  return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : def
}
const flag = name => argv.includes(`--${name}`)

const range = opt('range', null)
const threshold = parseFloat(opt('threshold', '0.35'))
const every = parseInt(opt('every', '8'), 10)
const cols = parseInt(opt('cols', '4'), 10)
const rows = parseInt(opt('rows', '3'), 10)
const keepVideo = flag('keep-video')
const noOverlay = flag('no-overlay')
const noPreview = flag('no-preview')

const isUrl = /^https?:\/\//i.test(input)

// Resolve a font for the timestamp overlay. Walk known Windows fonts first
// (the host platform per the project); fall back to arial which is always
// present. Path is escaped for the drawtext filter ('C:/x' → 'C\:/x').
function detectFont() {
  const cands = [
    'C:/Windows/Fonts/arial.ttf',
    'C:/Windows/Fonts/consola.ttf',
    'C:/Windows/Fonts/msyh.ttc',
    '/System/Library/Fonts/Helvetica.ttc',
    '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf',
  ]
  for (const p of cands) { if (fs.existsSync(p)) return p }
  return 'C:/Windows/Fonts/arial.ttf'
}
function escapeFontPath(p) {
  return p.replace(/\\/g, '/').replace(/^([A-Za-z]):/, '$1\\:')
}

function youtubeId(url) {
  const m = url.match(/(?:v=|youtu\.be\/|\/shorts\/|\/embed\/)([A-Za-z0-9_-]{11})/)
  return m ? m[1] : null
}

function sanitize(s) {
  return String(s).replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 60) || 'source'
}

const ytId = isUrl ? youtubeId(input) : null
const sourceId = isUrl
  ? (ytId ? `yt_${ytId}` : `url_${sanitize(input)}`)
  : `local_${sanitize(path.basename(input, path.extname(input)))}`

const outDir = path.resolve(opt('out', path.join('scratch', 'motion-trial', sourceId)))
const framesDir = path.join(outDir, 'frames')
const subsetDir = path.join(outDir, 'subset')
const sheetsDir = path.join(outDir, 'sheets')
for (const d of [outDir, framesDir, subsetDir, sheetsDir]) fs.mkdirSync(d, { recursive: true })

const run = (cmd, args) => {
  console.log(`$ ${cmd} ${args.join(' ')}`)
  return execFileSync(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'] }).toString()
}

// 1) Obtain the video (download low-res, or use local file in place).
let videoPath = path.join(outDir, 'src.mp4')
let downloaded = false
if (isUrl) {
  console.log(`\n[1/4] downloading ${input} (360p)...`)
  const ytArgs = [
    '--no-update', '--no-playlist',
    '-f', 'bv*[height<=360]+ba/b[height<=360]/wv*+ba/b',
    '--merge-output-format', 'mp4',
    '-o', videoPath,
  ]
  if (range) {
    const [a, b] = range.split('-')
    ytArgs.push('--download-sections', `*${a}-${b}`)
  }
  ytArgs.push(input)
  run('yt-dlp', ytArgs)
  downloaded = true
} else {
  if (!fs.existsSync(input)) { console.error(`file not found: ${input}`); process.exit(1) }
  videoPath = path.resolve(input)
  console.log(`\n[1/4] using local file ${videoPath}`)
}

// 2) Scene-detect frames (one per cut), scaled down. Bake the original-video
//    timestamp into each frame (HH:MM:SS pill, lower-left) so the contact
//    sheet doubles as a frame→time index — the human writing the source JSON
//    can copy each motif's `sourceTimestamp` straight from the cell.
console.log(`\n[2/4] scene-detect (threshold ${threshold})...`)
const fontPath = escapeFontPath(detectFont())
const overlay = noOverlay
  ? ''
  : `,drawtext=fontfile='${fontPath}':text='%{pts\\:hms}':x=4:y=h-th-4:fontsize=14:fontcolor=yellow:box=1:boxcolor=black@0.6:boxborderw=3`
run('ffmpeg', [
  '-v', 'error', '-i', videoPath,
  '-vf', `select='gt(scene,${threshold})',scale=320:-1${overlay}`,
  '-fps_mode', 'vfr',
  path.join(framesDir, 'sc_%04d.jpg'),
])
const allFrames = fs.readdirSync(framesDir).filter(f => f.endsWith('.jpg')).sort()
console.log(`   ${allFrames.length} scene frames`)

// 3) Subset every Nth frame, then tile into contact sheets.
console.log(`\n[3/4] subset every ${every} -> contact sheets (${cols}x${rows})...`)
let n = 0
allFrames.forEach((f, i) => {
  if (i % every === 0) {
    n += 1
    fs.copyFileSync(path.join(framesDir, f), path.join(subsetDir, `s_${String(n).padStart(3, '0')}.jpg`))
  }
})
run('ffmpeg', [
  '-v', 'error', '-i', path.join(subsetDir, 's_%03d.jpg'),
  '-vf', `scale=300:-1,tile=${cols}x${rows}:margin=6:padding=4:color=black`,
  '-fps_mode', 'vfr',
  path.join(sheetsDir, 'sheet_%02d.jpg'),
])
const sheets = fs.readdirSync(sheetsDir).filter(f => f.endsWith('.jpg')).sort()

// 4) Save a representative sheet as the source's preview thumbnail, then
//    clean up the heavy source video (default). The preview survives outside
//    the scratch dir so step 5's cleanup doesn't take it with it.
console.log(`\n[4/4] preview + cleanup`)
let previewBasename = null
if (!noPreview && sheets.length > 0) {
  const previewsDir = path.resolve('data', 'motion-library', 'previews')
  fs.mkdirSync(previewsDir, { recursive: true })
  const picked = sheets[Math.floor(sheets.length / 2)]
  previewBasename = `${sourceId}.jpg`
  fs.copyFileSync(path.join(sheetsDir, picked), path.join(previewsDir, previewBasename))
  console.log(`   preview  → data/motion-library/previews/${previewBasename}  (picked ${picked})`)
}
if (downloaded && !keepVideo) {
  fs.rmSync(videoPath, { force: true })
  console.log(`   deleted downloaded video`)
} else if (keepVideo) {
  console.log(`   kept video (--keep-video): ${videoPath}`)
}
// Frames are intermediate; keep them only if no sheets were produced.
if (sheets.length > 0) fs.rmSync(framesDir, { recursive: true, force: true })

console.log(`\n────────────────────────────────────────`)
console.log(`sourceId : ${sourceId}`)
console.log(`subset   : ${n} representative frames`)
console.log(`sheets   : ${sheets.length}`)
for (const s of sheets) console.log(`           ${path.join(sheetsDir, s)}`)
if (previewBasename) console.log(`preview  : data/motion-library/previews/${previewBasename}`)
console.log(`\nNext:`)
console.log(`  1. Open the sheets above and write the source JSON`)
console.log(`     (shape: data/motion-library/sources/*.json)`)
console.log(`     Each cell has its original-video timestamp baked in lower-left.`)
console.log(`     - Set source.previewSheet: "${previewBasename ?? '<sourceId>.jpg'}"`)
console.log(`     - For each motif, copy the cell's timestamp into sourceTimestamp: <seconds>`)
console.log(`  2. POST it to /api/motion-library/sources  (or drop the file in that folder)`)
console.log(`  3. Delete ${outDir} — only the JSON should survive`)
