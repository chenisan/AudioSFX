// install-sample-project.mjs — bootstrap a 13SoulMU project from the demo
// sample-project folder. Reads lyrics.srt + character-bible.json, generates
// a fresh UUID, writes a valid project.yaml + the required subdirectories.
//
// Usage:
//   node tools/install-sample-project.mjs
//
// Output:
//   data/projects/<uuid>/
//     ├── project.yaml
//     ├── assets/
//     ├── outputs/
//     └── ai/scripts/

import fs from 'fs'
import path from 'path'
import yaml from 'js-yaml'
import { fileURLToPath } from 'url'
import { randomUUID } from 'crypto'

const __filename = fileURLToPath(import.meta.url)
const ROOT = path.resolve(path.dirname(__filename), '..')
const SAMPLE_DIR = path.join(ROOT, 'docs', 'demo-scripts', 'sample-project')
const DATA_DIR = path.resolve(process.env.VIDEO_ENGINE_DATA_DIR ?? path.join(ROOT, 'data'))

// ── Parse SRT ──────────────────────────────────────────────────────────────
//
// Mirrors src/utils/srtParser.js (which is a browser ES module — re-implemented
// here so the installer doesn't need a build step).
function parseSRT(content) {
  const normalized = content.replace(/\r\n/g, '\n').replace(/\r/g, '\n').trim()
  const blocks = normalized.split(/\n\n+/)
  const cues = []
  for (const block of blocks) {
    const lines = block.trim().split('\n')
    if (lines.length < 2) continue
    const tsLineIdx = lines.findIndex(l => l.includes('-->'))
    if (tsLineIdx < 0) continue
    const [a, b] = lines[tsLineIdx].split('-->').map(s => s.trim())
    const start = parseTs(a), end = parseTs(b)
    if (start === null || end === null) continue
    const text = lines.slice(tsLineIdx + 1).join('\n').trim()
    if (!text) continue
    cues.push({ start, end, text })
  }
  return cues
}

function parseTs(ts) {
  const m = ts.replace(',', '.').match(/(\d{1,2}):(\d{2}):(\d{2})(?:\.(\d{1,3}))?/)
  if (!m) return null
  return +m[1] * 3600 + +m[2] * 60 + +m[3] + (m[4] ? +m[4].padEnd(3, '0') / 1000 : 0)
}

// ── Build project.yaml ──────────────────────────────────────────────────────
function buildProject(uuid, cues, characters) {
  const now = new Date().toISOString()

  const textTrack = {
    id: 'track_text_lyrics',
    type: 'text',
    name: '中文字幕',
    order: 3,
    clips: cues.map(c => ({
      kind: 'text',
      text: c.text,
      start: c.start,
      end: c.end,
      style: {
        fontSize: 56,
        color: '#ffffff',
        fontWeight: 'bold',
        position: { x: '50%', y: '82%' },
        strokeColor: '#000000',
        strokeWidth: 3,
        background: { enabled: false, color: '#000000', opacity: 0.4, padding: 12 },
      },
    })),
    locked: false,
    hidden: false,
  }

  // Empty placeholder tracks for the user to fill: an audio track for the
  // background song, and one video track for additional B-roll if they want.
  const audioTrack = {
    id: 'track_audio_bgm',
    type: 'audio',
    name: '音樂',
    order: -1,
    clips: [],
    locked: false,
    hidden: false,
  }
  const videoTrack = {
    id: 'track_video_main',
    type: 'video',
    name: '影片 1',
    order: 0,
    clips: [],
    locked: false,
    hidden: false,
    gapMode: 'black',
  }

  const lastEnd = cues.reduce((m, c) => Math.max(m, c.end), 0)
  const duration = Math.ceil(lastEnd + 5) // small tail buffer

  return {
    id: uuid,
    name: '夜燈一盞 — 樣本專案',
    duration,
    resolution: [1080, 1920],
    aspectRatio: '9:16',
    timeline: {
      tracks: [audioTrack, videoTrack, textTrack],
    },
    createdAt: now,
    updatedAt: now,
    characterBible: characters.map(c => ({
      id: c.id,
      name: c.name,
      appearance: c.appearance,
      ...(c.promptToken ? { promptToken: c.promptToken } : {}),
      ...(c.styleHints  ? { styleHints:  c.styleHints  } : {}),
    })),
    storyboardConfig: {
      lyricsTrackId: textTrack.id,
      musicStyle: '華語抒情',
      bpm: 72,
    },
  }
}

// ── Main ────────────────────────────────────────────────────────────────────
async function main() {
  const srtPath = path.join(SAMPLE_DIR, 'lyrics.srt')
  const charPath = path.join(SAMPLE_DIR, 'character-bible.json')

  if (!fs.existsSync(srtPath))  throw new Error(`Missing ${srtPath}`)
  if (!fs.existsSync(charPath)) throw new Error(`Missing ${charPath}`)

  const cues = parseSRT(fs.readFileSync(srtPath, 'utf8'))
  if (cues.length === 0) throw new Error('SRT parsing produced 0 cues')

  const charDoc = JSON.parse(fs.readFileSync(charPath, 'utf8'))
  const characters = charDoc.characters ?? []

  const uuid = randomUUID()
  const project = buildProject(uuid, cues, characters)

  const projDir = path.join(DATA_DIR, 'projects', uuid)
  fs.mkdirSync(path.join(projDir, 'assets'),     { recursive: true })
  fs.mkdirSync(path.join(projDir, 'outputs'),    { recursive: true })
  fs.mkdirSync(path.join(projDir, 'ai', 'scripts'), { recursive: true })

  const yamlText = yaml.dump(project, { lineWidth: -1 })
  fs.writeFileSync(path.join(projDir, 'project.yaml'), yamlText, 'utf8')

  console.log(`\n✓ Sample project installed`)
  console.log(`  Project ID:  ${uuid}`)
  console.log(`  Path:        ${projDir}`)
  console.log(`  SRT cues:    ${cues.length}`)
  console.log(`  Characters:  ${characters.length}`)
  console.log(`\nNext steps:`)
  console.log(`  1. Open 13SoulMU and the project should appear in the project list`)
  console.log(`  2. Drop a 90s mp3 into the audio track to play with`)
  console.log(`  3. Header → AI MV → Sonnet → 開始（auto-storyboards 12 scenes）`)
}

main().catch(e => { console.error(`\n✗ Install failed: ${e.message}`); process.exit(1) })
