// Download original WAV/AIF files of Sonniss GDC bundles from archive.org into a
// folder you then point AudioSFX at (the「本機」tab / server/core/localLibrary).
// The bundles are royalty-free but NOT redistributable as files, so they are NOT
// bundled with AudioSFX — each user fetches their own. Skips archive.org's
// derivative flac/mp3/png. Idempotent + resumable (curl -C -): re-run safely.
//
// Usage:
//   node scripts/download-sonniss.mjs --dest <folder> [--ids id1,id2] [--concurrency N]
//
// Examples:
//   node scripts/download-sonniss.mjs --dest D:\sfx_sample
//   node scripts/download-sonniss.mjs --dest /mnt/sfx --ids game-audio-gdcpart-2
//   SONNISS_DEST=D:\sfx node scripts/download-sonniss.mjs
//
// archive.org identifiers by year (more at archive.org, search "Sonniss GDC"):
//   2015  game-audio-gdc            2016  game-audio-gdcpart-2
//   2017  game-audio-gdcpart-3      2018  game-audio-gdcpart-4
//   2019  game-audio-gdcpart-5      2020  sonniss-gdc-2020-game-audio-bundle
//   2023  gdc-2023-game-audio-bundle
// Default (no --ids) = 2015 + 2016 (smaller, more discrete usable SFX, ~26GB WAV).
import { spawn } from 'node:child_process'
import * as fs from 'node:fs'
import * as fsp from 'node:fs/promises'
import * as path from 'node:path'

const argv = process.argv.slice(2)
const flag = (name) => { const i = argv.indexOf(name); return i >= 0 ? argv[i + 1] : null }

if (argv.includes('--help') || argv.includes('-h')) {
  console.log('Usage: node scripts/download-sonniss.mjs --dest <folder> [--ids id1,id2] [--concurrency N]')
  console.log('See the header of this file for archive.org identifiers per year.')
  process.exit(0)
}

const DEST = flag('--dest') || process.env.SONNISS_DEST
if (!DEST) {
  console.error('error: no destination. Pass --dest <folder> or set SONNISS_DEST.')
  console.error('       node scripts/download-sonniss.mjs --help')
  process.exit(1)
}
const idsArg = flag('--ids')
const IDS = idsArg ? idsArg.split(',').map(s => s.trim()).filter(Boolean)
  : ['game-audio-gdc', 'game-audio-gdcpart-2']   // 2015 + 2016
const AUDIO_EXT = new Set(['.wav', '.aif', '.aiff'])
const CONCURRENCY = Number(flag('--concurrency')) || 3

const enc = (name) => name.split('/').map(encodeURIComponent).join('/')

// Windows can't have : * ? " < > | in path segments (Sonniss has folders like
// "Tools:Construction"). Sanitize each segment for the local dest; the download
// URL still uses the original name. scanLocal reads whatever lands on disk, so
// import/preview stay consistent with these sanitized names.
const ILLEGAL = /[:*?"<>|]/g
const destPath = (name) =>
  path.join(DEST, ...name.split('/').map(seg => seg.replace(ILLEGAL, '-').replace(/[ .]+$/, '').trim()))

async function fileList(id) {
  const res = await fetch(`https://archive.org/metadata/${id}`)
  const m = await res.json()
  return (m.files || [])
    .filter(f => f.source === 'original' && AUDIO_EXT.has(path.extname(f.name).toLowerCase()))
    .map(f => ({
      id,
      name: f.name,
      size: Number(f.size || 0),
      url: `https://archive.org/download/${id}/${enc(f.name)}`,
      dest: destPath(f.name),
    }))
}

function curl(item) {
  return new Promise((resolve) => {
    try {
      fs.mkdirSync(path.dirname(item.dest), { recursive: true })
    } catch (e) {
      return resolve({ ok: false, err: `mkdir: ${e.message}` })
    }
    const args = ['-sSL', '-C', '-', '--retry', '5', '--retry-delay', '3',
      '--retry-all-errors', '-o', item.dest, item.url]
    const p = spawn('curl', args)
    let err = ''
    p.stderr.on('data', d => { err += d })
    p.on('close', code => resolve({ ok: code === 0, err }))
    p.on('error', e => resolve({ ok: false, err: e.message }))
  })
}

async function run() {
  console.log(`dest: ${DEST}`)
  let items = []
  for (const id of IDS) {
    const list = await fileList(id)
    const gb = list.reduce((a, b) => a + b.size, 0) / 1e9
    console.log(`  ${id}: ${list.length} audio files, ${gb.toFixed(1)} GB`)
    items = items.concat(list)
  }
  const totalGB = items.reduce((a, b) => a + b.size, 0) / 1e9
  console.log(`TOTAL: ${items.length} files, ${totalGB.toFixed(1)} GB\n`)

  let done = 0, skipped = 0, failed = 0, gotBytes = 0
  let idx = 0
  async function worker() {
    while (idx < items.length) {
      const item = items[idx++]
      let r
      try {
        const st = await fsp.stat(item.dest).catch(() => null)
        if (st && item.size && st.size === item.size) { skipped++; done++; continue }
        r = await curl(item)
      } catch (e) {
        r = { ok: false, err: e.message }
      }
      done++
      if (r.ok) { gotBytes += item.size }
      else { failed++; console.log(`  ✗ ${item.name}\n    ${(r.err || '').slice(0, 200)}`) }
      if (done % 25 === 0 || done === items.length) {
        console.log(`  ${done}/${items.length}  (skip ${skipped}, fail ${failed}, ~${(gotBytes / 1e9).toFixed(1)} GB new)`)
      }
    }
  }
  await Promise.all(Array.from({ length: CONCURRENCY }, worker))
  console.log(`\n✓ finished: ${done} processed, ${skipped} already present, ${failed} failed`)
  if (failed) console.log('  re-run to retry failed/partial files (resumable).')
}

run().catch(e => { console.error(e); process.exit(1) })
