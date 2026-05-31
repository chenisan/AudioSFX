import * as fs from 'fs'
import * as path from 'path'
import { TextSegment } from './types'

/**
 * Resolve the first existing `assets/fonts` directory so libass can find
 * bundled fonts (e.g. NotoSansTC-Bold.ttf) without relying on the host
 * system's fontconfig. Returns null if nothing exists — caller should
 * omit the `fontsdir` option in that case.
 *
 * Search order matches `utils/fontDetect.bundledFontDirs` so dev runs,
 * bundled-node builds, and packaged Electron all resolve consistently.
 */
export function resolveFontsDir(): string | null {
  const resourcesPath = (process as { resourcesPath?: string }).resourcesPath
  const candidates: string[] = []
  if (resourcesPath) candidates.push(path.join(resourcesPath, 'assets', 'fonts'))
  candidates.push(path.join(process.cwd(), 'assets', 'fonts'))
  candidates.push(path.resolve(__dirname, '..', '..', 'assets', 'fonts'))
  for (const c of candidates) {
    if (fs.existsSync(c)) return c
  }
  return null
}

// ── Format helpers ────────────────────────────────────────────────────────────

/** ASS time format: H:MM:SS.CC (centiseconds, 2 digits) */
function assTime(seconds: number): string {
  const total = Math.max(0, seconds)
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = Math.floor(total % 60)
  const cs = Math.floor((total - Math.floor(total)) * 100)
  return `${h}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}.${cs.toString().padStart(2, '0')}`
}

// CSS font-family aliases → font names available in assets/fonts (Noto bundle).
// Source Han Sans and Noto CJK are the same typeface; different distribution names.
const FONT_ALIAS: Record<string, string> = {
  'source han sans tc': 'Noto Sans TC',
  'source han sans': 'Noto Sans TC',
  'source han sans cn': 'Noto Sans SC',
  'noto sans traditional chinese': 'Noto Sans TC',
  'pingfang tc': 'Noto Sans TC',
  'microsoft jhenghei': 'Noto Sans TC',
  'microsoft jheng hei': 'Noto Sans TC',
}

/** Extract the first font family from a CSS font-family string and normalize to a libass-resolvable name. */
function normalizeFontName(cssFamily: string | undefined): string {
  if (!cssFamily) return 'Noto Sans TC'
  const first = cssFamily.replace(/['"]/g, '').split(',')[0].trim()
  return FONT_ALIAS[first.toLowerCase()] ?? first
}

/**
 * Convert color string to ASS BGR hex.
 * Accepts `#RRGGBB`, `#RGB`, and `rgba(r,g,b,a)` / `rgb(r,g,b)`.
 */
function hexToBGR(hex: string | undefined): string {
  if (!hex) return '000000'
  if (hex.startsWith('#')) {
    const h = hex.replace('#', '').padEnd(6, '0')
    const r = h.slice(0, 2), g = h.slice(2, 4), b = h.slice(4, 6)
    return `${b}${g}${r}`.toUpperCase()
  }
  const m = hex.match(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/)
  if (m) {
    const r = parseInt(m[1]).toString(16).padStart(2, '0')
    const g = parseInt(m[2]).toString(16).padStart(2, '0')
    const b = parseInt(m[3]).toString(16).padStart(2, '0')
    return `${b}${g}${r}`.toUpperCase()
  }
  return '000000'
}

/** Extract alpha from `rgba(r,g,b,a)` string; returns undefined for non-rgba inputs. */
function extractRgbaOpacity(color: string | undefined): number | undefined {
  if (!color) return undefined
  const m = color.match(/rgba\(\s*\d+\s*,\s*\d+\s*,\s*\d+\s*,\s*([\d.]+)\s*\)/)
  return m ? parseFloat(m[1]) : undefined
}

/** Opacity 0..1 → ASS alpha hex (inverse: 1.0 = 00 opaque, 0.0 = FF transparent). */
function opacityToAssAlpha(opacity: number): string {
  const a = Math.max(0, Math.min(255, Math.round((1 - opacity) * 255)))
  return a.toString(16).toUpperCase().padStart(2, '0')
}

/** Escape text for an ASS Dialogue line. Curly braces are override markers. */
function escapeAssText(text: string): string {
  return (text ?? '')
    .replace(/\\/g, '\\\\')
    .replace(/\{/g, '\\{')
    .replace(/\}/g, '\\}')
    .replace(/\r?\n/g, '\\N')
}

/** Resolve an x/y position value (CSS-style) to absolute pixel on PlayResX/Y. */
function resolvePos(value: string | number | undefined, dim: number, defaultFrac: number): number {
  if (value === undefined) return Math.round(dim * defaultFrac)
  if (typeof value === 'string') {
    if (value === 'center') return Math.round(dim / 2)
    if (value === 'left') return 10
    if (value === 'right') return dim - 10
    if (value.endsWith('%')) return Math.round(dim * parseFloat(value) / 100)
  }
  return Math.round(Number(value))
}

// ── Dialogue override builder ────────────────────────────────────────────────

function buildDialogueOverrides(seg: TextSegment, width: number, height: number): string {
  const style = seg.style ?? {}
  const overrides: string[] = []

  // All positions use center anchor (\an5) to match preview's
  // `translate(-50%, -50%)` semantics. User x/y addresses the text center.
  overrides.push('\\an5')

  const x = resolvePos(style.position?.x, width, 0.5)
  const y = resolvePos(style.position?.y, height, 0.8)

  const anim = style.animation
  const inDurMs = Math.round((anim?.inDuration ?? 0.3) * 1000)
  const outDurMs = Math.round((anim?.outDuration ?? 0.3) * 1000)

  // slide-up: animate position from y+30 to y over inDurMs (movement only, fade
  // handled separately via \fad if also fade-in)
  if (anim?.in === 'slide-up') {
    overrides.push(`\\move(${x},${y + 30},${x},${y},0,${inDurMs})`)
  } else if (anim?.in === 'slide-down') {
    overrides.push(`\\move(${x},${y - 30},${x},${y},0,${inDurMs})`)
  } else {
    overrides.push(`\\pos(${x},${y})`)
  }

  // Font family — normalize aliases (e.g. Source Han Sans TC → Noto Sans TC).
  overrides.push(`\\fn${normalizeFontName(style.fontFamily)}`)
  if (style.fontSize) overrides.push(`\\fs${style.fontSize}`)

  // Weight — preview defaults to bold when unspecified; mirror that.
  const w = style.fontWeight
  const isBold = w === undefined || w === 'bold' || w === '700' || w === '800' || w === '900' || Number(w) >= 600
  overrides.push(isBold ? '\\b1' : '\\b0')

  // Primary color
  if (style.color) overrides.push(`\\c&H${hexToBGR(style.color)}&`)

  // Stroke → outline. Takes precedence over shadow's halo approximation
  // (user-set stroke is intentional). Skipped when a background box is
  // enabled — under BorderStyle:3 \bord becomes box padding, so stroke
  // can't coexist with a box anyway.
  const hasBgBox = !!style.background?.enabled
  const hasStroke = !!(style.strokeWidth && style.strokeColor) && !hasBgBox
  if (hasStroke) {
    overrides.push(`\\bord${style.strokeWidth}`)
    overrides.push(`\\3c&H${hexToBGR(style.strokeColor!)}&`)
  }

  // Shadow. Non-hex colors fall back to black; opacity defaults to 0.8 to
  // match preview. Skipped under BorderStyle:3 (background box) because
  // libass shares \4c between the box fill and shadow color — they can't
  // hold different values, so we suppress shadow entirely instead of
  // silently coloring it like the box.
  const sh = style.shadow
  if (sh && (sh as any).enabled !== false && !hasBgBox) {
    const shx = sh.offsetX ?? 2
    const shy = sh.offsetY ?? 2
    const blur = sh.blur ?? 0
    // Support both explicit `opacity` field and opacity embedded in `rgba()` color string.
    const shOpacity = (sh as { opacity?: number }).opacity ?? extractRgbaOpacity(sh.color) ?? 0.8
    const shColor = hexToBGR(sh.color)
    overrides.push(`\\xshad${shx}`)
    overrides.push(`\\yshad${shy}`)
    overrides.push(`\\4c&H${shColor}&`)
    overrides.push(`\\4a&H${opacityToAssAlpha(shOpacity)}&`)
    // CSS text-shadow blur ≠ libass \be (\be blurs the entire glyph). Approximate
    // with a soft outline in the shadow color. Skip when stroke or bg-box are
    // already using \bord — would clobber them.
    if (blur > 0 && !hasStroke && !hasBgBox) {
      const bordPx = Math.max(1, Math.round(blur * 0.4))
      overrides.push(`\\bord${bordPx}`)
      overrides.push(`\\3c&H${shColor}&`)
      overrides.push(`\\3a&H${opacityToAssAlpha(shOpacity * 0.6)}&`)
    }
  }

  // Fade in/out
  const fadeIn = anim?.in === 'fade-in' ? inDurMs : 0
  const fadeOut = anim?.out === 'fade-out' ? outDurMs : 0
  if (fadeIn > 0 || fadeOut > 0) {
    overrides.push(`\\fad(${fadeIn},${fadeOut})`)
  }

  return `{${overrides.join('')}}`
}

// ── Public entry ─────────────────────────────────────────────────────────────

/**
 * Write an ASS file covering every text segment, return its path.
 * Uses center-anchored alignment (5) as the default so the per-dialogue
 * \pos / \move offsets address the text's center, matching the CSS preview.
 */
export function buildAssFile(
  segments: TextSegment[],
  width: number,
  height: number,
  tmpDir: string
): string {
  const styleFormat = 'Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding'
  // Default: outline style (BorderStyle 1), no shadow box.
  // BG: opaque box style (BorderStyle 3) — BackColour fills the box, Outline = padding.
  const header = [
    '[Script Info]',
    'ScriptType: v4.00+',
    'WrapStyle: 2',
    'ScaledBorderAndShadow: yes',
    `PlayResX: ${width}`,
    `PlayResY: ${height}`,
    '',
    '[V4+ Styles]',
    styleFormat,
    'Style: Default,Noto Sans TC,48,&H00FFFFFF,&H000000FF,&H00000000,&H00000000,-1,0,0,0,100,100,0,0,1,0,0,5,0,0,0,1',
    'Style: BG,Noto Sans TC,48,&H00FFFFFF,&H000000FF,&H00000000,&H80000000,-1,0,0,0,100,100,0,0,3,8,0,5,0,0,10,1',
    '',
    '[Events]',
    'Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text',
  ].join('\n')

  const lines = segments
    .filter(s => (s.text ?? '').length > 0 && s.end > s.start)
    .map(seg => {
      const start = assTime(seg.start)
      const end = assTime(seg.end)
      const overrides = buildDialogueOverrides(seg, width, height)
      const text = escapeAssText(seg.text)
      const bg = (seg.style as any)?.background
      const styleName = bg?.enabled ? 'BG' : 'Default'
      // Override BG box color/opacity/padding per-segment. The BG style sets
      // BorderStyle:3 (opaque box) — under that mode \bord controls box
      // padding (in script units, scaled by ScaledBorderAndShadow:yes).
      const bgOverride = (() => {
        if (!bg?.enabled) return ''
        const bgColor = hexToBGR(bg.color ?? '#000000')
        const bgAlpha = opacityToAssAlpha(bg.opacity ?? 0.5)
        const padding = bg.padding ?? 12
        return `{\\bord${padding}\\4c&H${bgColor}&\\4a&H${bgAlpha}&}`
      })()
      return `Dialogue: 0,${start},${end},${styleName},,0,0,0,,${bgOverride}${overrides}${text}`
    })

  const content = `${header}\n${lines.join('\n')}\n`
  const assPath = path.join(tmpDir, 'subtitles.ass')
  fs.writeFileSync(assPath, content, 'utf8')
  return assPath
}
