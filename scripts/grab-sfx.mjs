// grab-sfx.mjs — 抓 YouTube 音效 → 轉 48k/16bit 立體聲 → 歸檔進本機庫 → 重掃分類。
//
// 一支腳本取代「查長度 / yt-dlp / ffmpeg 轉檔 / 命名 / 重掃 API」整串手動指令，省 token。
//
// 用法：
//   node scripts/grab-sfx.mjs --cat "風與天氣" --name wind <url1> <url2> ...
//   node scripts/grab-sfx.mjs --cat "打鬥音效77" --name punch-hit --split <url>
//
// 參數：
//   --cat   <中文資料夾>  必填，落地到 <base>/<cat>/
//   --name  <前綴>        必填，輸出 <name>-01.wav、<name>-02.wav…（接續既有編號）
//   --split               對每個 URL 做靜音偵測切分（打鬥/連續撞擊類音效用）
//   --base  <資料夾>      本機庫根，預設 D:\sfx_sample
//   --no-refresh          跳過抓完後打 /api/local-library?refresh=1
//   <url...>              一個或多個 YouTube 連結
//
// 前置：yt-dlp、ffmpeg 在 PATH。後端 :6301 有跑才會重掃（沒跑只是略過，不報錯）。

import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'

// ---- 參數解析 ----
const argv = process.argv.slice(2)
const opt = { cat: '', name: '', split: false, base: 'D:\\sfx_sample', refresh: true, urls: [] }
for (let i = 0; i < argv.length; i++) {
  const a = argv[i]
  if (a === '--cat') opt.cat = argv[++i]
  else if (a === '--name') opt.name = argv[++i]
  else if (a === '--split') opt.split = true
  else if (a === '--base') opt.base = argv[++i]
  else if (a === '--no-refresh') opt.refresh = false
  else if (a === '--help' || a === '-h') { printHelp(); process.exit(0) }
  else if (a.startsWith('http')) opt.urls.push(a)
  else { console.error('未知參數：', a); process.exit(1) }
}
function printHelp() {
  console.log(`用法: node scripts/grab-sfx.mjs --cat <中文資料夾> --name <前綴> [--split] [--base <dir>] [--no-refresh] <url...>
例: node scripts/grab-sfx.mjs --cat "風與天氣" --name wind https://youtu.be/xxx
例: node scripts/grab-sfx.mjs --cat "打鬥音效77" --name punch-hit --split https://youtu.be/yyy`)
}
if (!opt.cat || !opt.name || !opt.urls.length) { printHelp(); process.exit(1) }

const outDir = path.join(opt.base, opt.cat)
fs.mkdirSync(outDir, { recursive: true })
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'grab-sfx-'))

// ---- 命名：接續資料夾內既有的 <name>-NN.wav 編號 ----
function nextIndex() {
  const re = new RegExp(`^${opt.name}-(\\d+)\\.wav$`, 'i')
  let max = 0
  for (const f of fs.readdirSync(outDir)) {
    const m = f.match(re)
    if (m) max = Math.max(max, +m[1])
  }
  return max + 1
}
let idx = nextIndex()
const nameFor = () => `${opt.name}-${String(idx++).padStart(2, '0')}.wav`

// ---- ffmpeg helpers ----
const CONV = ['-ar', '48000', '-ac', '2', '-c:a', 'pcm_s16le']  // 統一 48k/16bit 立體聲

function convertWhole(src, dest) {
  spawnSync('ffmpeg', ['-y', '-v', 'error', '-i', src, ...CONV, dest], { stdio: 'inherit' })
}

// 靜音偵測切分（沿用 split-fight.mjs 參數）
function splitBySilence(src) {
  const NOISE = '-30dB', MIN_SIL = 0.12, PAD_HEAD = 0.04, PAD_TAIL = 0.18, MIN_LEN = 0.12
  const r = spawnSync('ffmpeg', ['-i', src, '-af', `silencedetect=noise=${NOISE}:d=${MIN_SIL}`, '-f', 'null', '-'],
    { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
  const err = r.stderr || ''
  const durM = err.match(/Duration: (\d+):(\d+):([\d.]+)/)
  const total = durM ? (+durM[1]) * 3600 + (+durM[2]) * 60 + (+durM[3]) : 0
  const silences = []
  const re = /silence_start: ([\d.]+)[\s\S]*?silence_end: ([\d.]+)/g
  let m
  while ((m = re.exec(err))) silences.push([+m[1], +m[2]])
  const segs = []
  let cursor = 0
  for (const [s, e] of silences) { if (s - cursor >= MIN_LEN) segs.push([cursor, s]); cursor = e }
  if (total - cursor >= MIN_LEN) segs.push([cursor, total])
  const made = []
  for (const [s, e] of segs) {
    const start = Math.max(0, s - PAD_HEAD), end = Math.min(total, e + PAD_TAIL)
    const dest = path.join(outDir, nameFor())
    spawnSync('ffmpeg', ['-y', '-v', 'error', '-i', src, '-ss', start.toFixed(3), '-to', end.toFixed(3),
      ...CONV, dest], { stdio: 'ignore' })
    made.push(`${path.basename(dest)}  (${(end - start).toFixed(2)}s)`)
  }
  return made
}

// ---- 主流程 ----
const results = []
for (const url of opt.urls) {
  const raw = path.join(tmpDir, `dl-${opt.urls.indexOf(url)}.wav`)
  console.log(`↓ 下載 ${url}`)
  const dl = spawnSync('yt-dlp', ['-x', '--audio-format', 'wav', '-o', raw.replace('.wav', '.%(ext)s'), url],
    { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
  if (!fs.existsSync(raw)) {
    console.error(`✗ 下載失敗：${url}\n${(dl.stderr || '').split('\n').slice(-3).join('\n')}`)
    continue
  }
  if (opt.split) {
    const made = splitBySilence(raw)
    results.push(...made)
    console.log(`  切出 ${made.length} 段`)
  } else {
    const dest = path.join(outDir, nameFor())
    convertWhole(raw, dest)
    results.push(path.basename(dest))
    console.log(`  → ${path.basename(dest)}`)
  }
}

fs.rmSync(tmpDir, { recursive: true, force: true })

console.log(`\n✓ ${results.length} 檔歸檔到 ${outDir}`)
results.forEach(r => console.log('  ' + r))

// ---- 重掃本機庫（後端沒跑就略過）----
if (opt.refresh && results.length) {
  try {
    const res = await fetch('http://localhost:6301/api/local-library?refresh=1')
    const j = await res.json()
    const c = j.categories?.find(x => x.id === opt.cat)
    console.log(`\n本機庫已重掃：總數 ${j.count}｜「${opt.cat}」${c ? c.count : 0} 檔`)
  } catch {
    console.log('\n（後端 :6301 未啟動，略過重掃；UI 開著時按 ⟳ 即可）')
  }
}
