// Build the bundled CC0 SFX library from extracted Kenney packs.
//
// Input : .tmp-kenney/kenney_*/Audio/*.ogg   (Kenney CC0 packs, already unzipped)
// Output: assets/sfx-library/files/<id>.ogg  (flat, globally-unique filenames)
//         assets/sfx-library/manifest.json   ({ version, license, source, categories, items })
//
// All Kenney audio is CC0 1.0 (public domain) — freely redistributable, so it
// ships inside the installer (extraResources). Run once when refreshing the lib:
//   node scripts/build-sfx-library.mjs
import { execFileSync } from 'node:child_process'
import * as fs from 'node:fs'
import * as path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const srcRoot = path.join(root, '.tmp-kenney')
const outDir = path.join(root, 'assets', 'sfx-library')
const filesDir = path.join(outDir, 'files')

const ffprobe = path.join(root, 'node_modules', 'ffprobe-static', 'bin', 'win32', 'x64', 'ffprobe.exe')

// pack folder → short prefix (keeps filenames unique across packs)
const PACK_SHORT = {
  'kenney_impact-sounds': 'impact',
  'kenney_interface-sounds': 'ui',
  'kenney_digital-audio': 'digital',
  'kenney_rpg-audio': 'rpg',
  'kenney_sci-fi-sounds': 'scifi',
}

// human-readable category metadata (id → { zh, en, order })
const CATEGORIES = [
  { id: 'impact', zh: '撞擊／爆破', en: 'Impact' },
  { id: 'footstep', zh: '腳步', en: 'Footsteps' },
  { id: 'ui', zh: '介面提示', en: 'Interface' },
  { id: 'digital', zh: '電子音', en: 'Digital' },
  { id: 'scifi', zh: '科技／雷射', en: 'Sci-Fi' },
  { id: 'foley', zh: '物件 Foley', en: 'Foley' },
]

function categoryOf(packShort, base) {
  if (packShort === 'impact') return base.startsWith('footstep') ? 'footstep' : 'impact'
  if (packShort === 'ui') return 'ui'
  if (packShort === 'digital') return 'digital'
  if (packShort === 'rpg') return base.startsWith('footstep') ? 'footstep' : 'foley'
  if (packShort === 'scifi') {
    if (/explosion|impactMetal/i.test(base)) return 'impact'
    if (/^door/i.test(base)) return 'foley'
    return 'scifi'
  }
  return 'foley'
}

// "impactGlass_heavy_000" → { label: "Impact Glass Heavy", tokens: [...] }
function humanize(base) {
  const noNum = base.replace(/[_]?\d+$/, '')
  const spaced = noNum
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/[_]+/g, ' ')
    .trim()
  const label = spaced.replace(/\b\w/g, c => c.toUpperCase())
  const tokens = Array.from(
    new Set(
      `${base} ${spaced}`
        .toLowerCase()
        .split(/[^a-z0-9]+/)
        .filter(t => t && !/^\d+$/.test(t))
    )
  )
  return { label, tokens }
}

function durationOf(file) {
  try {
    const out = execFileSync(
      ffprobe,
      ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=nw=1:nk=1', file],
      { encoding: 'utf-8' }
    ).trim()
    const d = parseFloat(out)
    return Number.isFinite(d) ? Math.round(d * 1000) / 1000 : undefined
  } catch {
    return undefined
  }
}

// ── collect ────────────────────────────────────────────────────────────────
if (!fs.existsSync(srcRoot)) {
  console.error(`missing source: ${srcRoot} (unzip Kenney packs there first)`)
  process.exit(1)
}
fs.rmSync(outDir, { recursive: true, force: true })
fs.mkdirSync(filesDir, { recursive: true })

const raw = []
for (const pack of Object.keys(PACK_SHORT)) {
  const audioDir = path.join(srcRoot, pack, 'Audio')
  if (!fs.existsSync(audioDir)) continue
  const short = PACK_SHORT[pack]
  for (const f of fs.readdirSync(audioDir).sort()) {
    if (!f.toLowerCase().endsWith('.ogg')) continue
    if (/^preview\.ogg$/i.test(f)) continue   // pack-level preview, not a real sound
    const base = f.replace(/\.ogg$/i, '')
    const id = `${short}__${base}`             // globally-unique, no slash
    const { label, tokens } = humanize(base)
    raw.push({ id, packShort: short, base, label, tokens, src: path.join(audioDir, f) })
  }
}

// 1-based variant index within each (category,label) group → "Glass Heavy 1..5"
const groups = {}
for (const r of raw) {
  r.category = categoryOf(r.packShort, r.base)
  const key = `${r.category}|${r.label}`
  ;(groups[key] ||= []).push(r)
}
for (const key of Object.keys(groups)) {
  const g = groups[key]
  g.forEach((r, i) => { r.name = g.length > 1 ? `${r.label} ${i + 1}` : r.label })
}

// ── copy + probe ─────────────────────────────────────────────────────────────
const items = []
let n = 0
for (const r of raw) {
  fs.copyFileSync(r.src, path.join(filesDir, `${r.id}.ogg`))
  const durationSec = durationOf(r.src)
  items.push({
    id: r.id,
    name: r.name,
    category: r.category,
    tags: r.tokens,
    file: `${r.id}.ogg`,
    durationSec,
  })
  if (++n % 50 === 0) console.log(`  probed ${n}/${raw.length}`)
}
items.sort((a, b) => a.category.localeCompare(b.category) || a.name.localeCompare(b.name))

const manifest = {
  version: 1,
  license: 'CC0-1.0',
  source: 'Kenney.nl',
  url: 'https://kenney.nl',
  categories: CATEGORIES,
  items,
}
fs.writeFileSync(path.join(outDir, 'manifest.json'), JSON.stringify(manifest, null, 2))

const byCat = {}
for (const it of items) byCat[it.category] = (byCat[it.category] || 0) + 1
console.log(`\n✓ ${items.length} sounds → assets/sfx-library/`)
for (const c of CATEGORIES) console.log(`   ${c.id.padEnd(10)} ${byCat[c.id] || 0}`)
