/**
 * Parse SRT subtitle content into an array of cues.
 * Returns: [{ index, start, end, text }]
 *   - start/end are in seconds (float)
 *   - text is the subtitle content (may contain newlines)
 */
export function parseSRT(content) {
  const normalized = content.replace(/\r\n/g, '\n').replace(/\r/g, '\n').trim()
  const blocks = normalized.split(/\n\n+/)
  const cues = []

  for (const block of blocks) {
    const lines = block.trim().split('\n')
    if (lines.length < 2) continue

    // Find the timestamp line (contains " --> ")
    let tsLineIdx = -1
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].includes('-->')) { tsLineIdx = i; break }
    }
    if (tsLineIdx < 0) continue

    const tsParts = lines[tsLineIdx].split('-->')
    if (tsParts.length < 2) continue

    const start = parseTimestamp(tsParts[0].trim())
    const end = parseTimestamp(tsParts[1].trim())
    if (start === null || end === null) continue

    const index = tsLineIdx > 0 ? parseInt(lines[0], 10) || cues.length + 1 : cues.length + 1
    const text = lines.slice(tsLineIdx + 1).join('\n').trim()
    if (!text) continue

    cues.push({ index, start, end, text })
  }

  return cues
}

/**
 * Parse SRT timestamp "HH:MM:SS,mmm" or "HH:MM:SS.mmm" to seconds.
 */
function parseTimestamp(ts) {
  // Support both comma and dot as ms separator
  const cleaned = ts.replace(',', '.')
  const match = cleaned.match(/(\d{1,2}):(\d{2}):(\d{2})(?:\.(\d{1,3}))?/)
  if (!match) return null
  const h = parseInt(match[1], 10)
  const m = parseInt(match[2], 10)
  const s = parseInt(match[3], 10)
  const ms = match[4] ? parseInt(match[4].padEnd(3, '0'), 10) : 0
  return h * 3600 + m * 60 + s + ms / 1000
}
