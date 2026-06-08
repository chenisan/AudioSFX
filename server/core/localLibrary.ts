// User's local SFX folder (e.g. D:\sfx_sample with Sonniss/99sounds packs).
//
// NOT bundled with AudioSFX and NOT in git — the user points the app at a folder
// of their own sounds. Same model as the bundled CC0 library: a read-only SOURCE
// of assets. Importing copies a file into the project's assets/ dir, where it
// becomes an ordinary audio asset (生成單位 vs 剪輯單位 separation preserved).
import * as path from 'path'
import * as fs from 'fs'
import * as fsp from 'fs/promises'
import { getAssetDir } from './projectManager'
import { getMediaInfo } from '../utils/ffprobe'

const AUDIO = new Set(['.wav', '.aif', '.aiff', '.mp3', '.ogg', '.flac', '.m4a', '.aac'])
const MAX_ITEMS = 8000   // cap JSON size for huge libraries (e.g. full Sonniss archive)

// Content-based Chinese category from English keywords in the filename/folder.
// Local packs (Sonniss etc.) group by CONTRIBUTOR name ("Coll Anderson - Battle
// Crowd"), which says nothing about the sound type — so we re-tag by keywords.
// Order = priority: more specific first (爆炸/槍械/車輛 before generic 撞擊/環境).
const CATEGORY_RULES: [string, RegExp][] = [
  ['爆炸', /\b(explosion|explos|blast|detonat|bomb|kaboom)/],
  ['槍械', /\b(gun|gunshot|rifle|pistol|shotgun|firearm|bullet|reload|ammo|machinegun|revolver|sniper)/],
  ['刀劍近戰', /\b(sword|blade|knife|slash|stab|machete|katana|melee)/],
  ['車輛引擎', /\b(car|cars|vehicle|engine|motor|driveby|drive-by|drive|traffic|truck|motorcycle|race|racing|tyre|tire|brake|automobile|cadillac|fiat|porsche|ferrari|bus|train|tram|chassis)/],
  ['撞擊破壞', /\b(impact|crash|destruction|destroy|smash|break|broke|shatter|collision|debris|demolition|bash|thud|wreck|crush|hit)/],
  ['血腥 Gore', /\b(gore|flesh|skin|skinning|meat|bone|gristle|guts?|blood|splat|squelch|squish|cavity|\brip\b|sawing)/],
  ['警報警笛', /\b(siren|alarm|klaxon|whistle|honk|buzzer)/],
  ['腳步', /\b(footstep|footsteps|foot|walk|walking|running|jog|steps?)\b/],
  ['群眾人聲', /\b(crowd|voice|vocal|scream|shout|cheer|chatter|talk|speak|laugh|breath|grunt|whisper|applause|murmur|clap)/],
  ['動物', /\b(animal|dog|cat|bird|horse|insect|lion|tiger|monster|creature|growl|roar|bark|meow|chirp|pig|snort|squeal|oink|deer|cow|sheep|goat|hen|chicken|rooster|hoof)/],
  ['水與液體', /\b(water|splash|liquid|drip|pour|river|ocean|sea|wave|bubble|underwater|stream|rain)/],
  ['火', /\b(fire|flame|burn|burning|ignite|combust|torch|campfire)/],
  ['風與天氣', /\b(wind|storm|thunder|weather|breeze|snow|gale|blizzard)/],
  ['科技電子', /\b(ui|interface|menu|button|beep|computer|digital|glitch|electronic|robot|sci-?fi|cyber|hud|notification|tech|terminal|scanner|hologram)/],
  ['魔法科幻', /\b(magic|spell|energy|force ?field|forcefield|laser|plasma|power-?up|powerup|teleport|portal|aura|fantasy)/],
  ['轉場 whoosh', /\b(whoosh|woosh|swoosh|swish|transition|riser|sweep|pass-?by|passby|flyby|fly-?by|tension|osc)/],
  ['機械工業', /\b(machine|mechanic|mechanical|gear|hydraulic|servo|industrial|factory|conveyor|crane)/],
  ['物件 Foley', /\b(cloth|fabric|paper|wood|wooden|metal|metallic|glass|plastic|door|drawer|keys?|coin|book|switch|handle|foley|rope|chain|lock|zipper|sink|cupboard|cabinet|faucet|tap|kitchen|bathroom|spring|bounce|squeak)/],
  ['音樂節奏', /\b(music|musical|drum|melody|loop|beat|rhythm|jingle|stinger|chord|piano|guitar|synth|orchestra)/],
  ['環境氛圍', /\b(ambien|ambient|atmos|atmosphere|roomtone|room ?tone|background|city|street|forest|nature|park|office|restaurant|drone)/],
]

/** filename keywords win; fall back to folder path; else 其他. */
function categorize(relpath: string): string {
  const base = (relpath.split('/').pop() || '').toLowerCase()
  for (const [label, re] of CATEGORY_RULES) if (re.test(base)) return label
  const full = relpath.toLowerCase()
  for (const [label, re] of CATEGORY_RULES) if (re.test(full)) return label
  return '其他'
}

export interface LocalItem { id: string; name: string; category: string; folder: string }
export interface LocalScan {
  dir: string
  available: boolean
  count: number
  truncated: boolean
  categories: { id: string; count: number }[]
  items: LocalItem[]
}

function walk(root: string, dir: string, out: { items: LocalItem[]; truncated: boolean }) {
  let entries: fs.Dirent[]
  try { entries = fs.readdirSync(dir, { withFileTypes: true }) } catch { return }
  for (const e of entries) {
    if (out.items.length >= MAX_ITEMS) { out.truncated = true; return }
    if (e.name.startsWith('.')) continue
    const full = path.join(dir, e.name)
    if (e.isDirectory()) {
      walk(root, full, out)
      if (out.truncated) return
    } else if (AUDIO.has(path.extname(e.name).toLowerCase())) {
      const rel = path.relative(root, full)
      const id = rel.split(path.sep).join('/')               // forward-slash relpath
      const parent = path.basename(path.dirname(full))
      out.items.push({
        id,
        name: e.name.replace(/\.[^.]+$/, ''),
        category: categorize(id),                            // 中文 type from keywords
        folder: parent && parent !== '.' ? parent : '',      // contributor/pack, for reference
      })
    }
  }
}

let _cache: { dir: string; at: number; scan: LocalScan } | null = null

export function scanLocal(root: string, opts: { refresh?: boolean } = {}): LocalScan {
  const empty = (dir: string, available: boolean): LocalScan =>
    ({ dir, available, count: 0, truncated: false, categories: [], items: [] })
  if (!root) return empty('', false)
  const abs = path.resolve(root)
  if (!fs.existsSync(abs)) return empty(abs, false)
  if (!opts.refresh && _cache && _cache.dir === abs && Date.now() - _cache.at < 60_000) {
    return _cache.scan
  }
  const out = { items: [] as LocalItem[], truncated: false }
  walk(abs, abs, out)
  const catMap: Record<string, number> = {}
  for (const it of out.items) catMap[it.category] = (catMap[it.category] || 0) + 1
  const categories = Object.entries(catMap)
    .map(([id, count]) => ({ id, count }))
    // by count desc (most useful types first); 其他 always last
    .sort((a, b) => (a.id === '其他' ? 1 : b.id === '其他' ? -1 : b.count - a.count))
  const scan: LocalScan = {
    dir: abs, available: true, count: out.items.length,
    truncated: out.truncated, categories, items: out.items,
  }
  _cache = { dir: abs, at: Date.now(), scan }
  return scan
}

/** Resolve a relpath id within root, guarding against traversal. */
export function resolveLocal(root: string, id: string): string | null {
  if (!root || typeof id !== 'string' || !id) return null
  const abs = path.resolve(root)
  const target = path.resolve(abs, id)
  if (target !== abs && !target.startsWith(abs + path.sep)) return null
  if (!fs.existsSync(target) || !fs.statSync(target).isFile()) return null
  return target
}

export async function importLocal(
  root: string, projectId: string, id: string
): Promise<{ filename: string; durationSec?: number }> {
  const src = resolveLocal(root, id)
  if (!src) throw new Error('file not found in local library')
  const dir = getAssetDir(projectId)
  await fsp.mkdir(dir, { recursive: true })
  let filename = path.basename(src)
  let dest = path.join(dir, filename)
  if (fs.existsSync(dest)) {
    const ext = path.extname(filename)
    const base = filename.slice(0, filename.length - ext.length)
    let i = 1
    while (fs.existsSync(path.join(dir, `${base}_${i}${ext}`))) i++
    filename = `${base}_${i}${ext}`
    dest = path.join(dir, filename)
  }
  await fsp.copyFile(src, dest)
  let durationSec: number | undefined
  try { durationSec = (await getMediaInfo(dest)).duration } catch {}
  return { filename, durationSec }
}
