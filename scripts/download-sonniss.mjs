// Download original WAV/AIF files of selected Sonniss GDC bundles from archive.org
// into D:\sfx_sample. NOT bundled with AudioSFX — this is a personal local library
// the user points the app at (server/core/localLibrary). Skips archive.org's
// derivative flac/mp3/png. Idempotent + resumable: skips files already complete,
// resumes partial ones (curl -C -). Re-run safely if it dies.
//
//   node scripts/download-sonniss.mjs
import { spawn } from 'node:child_process'
import * as fs from 'node:fs'
import * as fsp from 'node:fs/promises'
import * as path from 'node:path'

const DEST = process.env.SONNISS_DEST || 'D:\\sfx_sample'
const IDS = ['game-audio-gdc', 'game-audio-gdcpart-2']   // 2015 + 2016
const AUDIO_EXT = new Set(['.wav', '.aif', '.aiff'])
const CONCURRENCY = 3

const enc = (name) => name.split('/').map(encodeURIComponent).join('/')

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
      dest: path.join(DEST, f.name),
    }))
}

function curl(item) {
  return new Promise((resolve) => {
    fs.mkdirSync(path.dirname(item.dest), { recursive: true })
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
      try {
        const st = await fsp.stat(item.dest).catch(() => null)
        if (st && item.size && st.size === item.size) { skipped++; done++; continue }
      } catch {}
      const r = await curl(item)
      done++
      if (r.ok) { gotBytes += item.size }
      else { failed++; console.log(`  ✗ ${item.name}\n    ${r.err.slice(0, 200)}`) }
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
