/**
 * Render a TextSegment as a CSS overlay matching the libass output.
 *
 * Font scale uses canonical 1080-base height (videoHeight prop). This MUST
 * agree with assRenderer's PlayResY so a fontSize=N value renders at the
 * same proportion in preview and in the final MP4.
 *
 * No font-size minimum clamp — preview is pixel-accurate vs render. If text
 * looks tiny in a small preview, the rendered output will look the same;
 * fix by raising fontSize, not by faking it bigger in preview.
 *
 * Shadow offset/blur ARE scaled by fontScale (matches \xshad/\yshad behavior
 * with ScaledBorderAndShadow: yes in the ASS header).
 *
 * Note: shadow blur in CSS only blurs the shadow; libass \be blurs the entire
 * glyph. The render pipeline uses \bord+\3c outline approximation instead of
 * \be — see assRenderer.ts.
 */
// CSS `left` / `top` only accept <length> | <percentage> | auto — keywords like
// `center` / `left` / `right` are not valid and browsers silently fall back to
// 0. The render pipeline (assRenderer.ts:104-106) maps those keywords to
// pixel positions, so without the same mapping here the preview drifts away
// from the rendered output: a clip with X='center' would render centered but
// preview-anchor at the canvas left edge → text gets clipped on the left.
// Percentages approximate assRenderer's 10px / dim-10px (≈ 1% / 99% on a
// 1080-wide stage) so render and preview stay perceptually identical.
function resolveCssPos(value, fallback) {
  if (value == null) return fallback
  if (typeof value === 'number') return `${value}px`
  if (typeof value !== 'string') return fallback
  if (value === 'center') return '50%'
  if (value === 'left'   || value === 'top')    return '1%'
  if (value === 'right'  || value === 'bottom') return '99%'
  return value
}

export default function TextOverlay({ segment, containerH, videoHeight }) {
  const style = segment.style ?? {}
  const pos = style.position ?? {}
  const cssLeft = resolveCssPos(pos.x, '50%')
  const cssTop  = resolveCssPos(pos.y, '80%')
  const baseFontPx = style.fontSize ?? 48
  const fontScale  = (containerH && videoHeight) ? containerH / videoHeight : 1
  const fontPx     = baseFontPx * fontScale

  let bgStyle = {}
  if (style.background?.enabled) {
    const hex = style.background.color ?? '#000000'
    const r = parseInt(hex.slice(1, 3), 16)
    const g = parseInt(hex.slice(3, 5), 16)
    const b = parseInt(hex.slice(5, 7), 16)
    const a = style.background.opacity ?? 0.5
    // Padding is uniform on all sides to match libass BorderStyle:3 + Outline
    // (libass has no asymmetric x/y padding nor border-radius). Scaled by
    // fontScale so a fixed `bg.padding=12` looks proportional in any preview.
    const padPx = (style.background.padding ?? 12) * fontScale
    bgStyle = {
      backgroundColor: `rgba(${r},${g},${b},${a})`,
      padding: `${padPx}px`,
    }
  }

  return (
    <div
      className="absolute pointer-events-none whitespace-pre text-center"
      style={{
        left: cssLeft, top: cssTop, transform: 'translate(-50%, -50%)',
        fontSize: fontPx, color: style.color ?? '#ffffff',
        fontFamily: style.fontFamily ?? '"Noto Sans TC", Inter, sans-serif',
        fontWeight: style.fontWeight ?? 'bold',
        WebkitTextStroke: style.strokeWidth
          ? `${style.strokeWidth * fontScale}px ${style.strokeColor ?? '#000000'}` : undefined,
        textShadow: (() => {
          const sh = style.shadow
          if (!sh || sh.enabled === false) return undefined
          // Suppress shadow under a background box: libass can't paint shadow
          // independently of the BorderStyle:3 box fill, so we drop it on the
          // preview side too for parity. Box already provides contrast.
          if (style.background?.enabled) return undefined
          const hex = (sh.color ?? '#000000').startsWith('#') ? sh.color : '#000000'
          const r = parseInt(hex.slice(1,3)||'00',16), g = parseInt(hex.slice(3,5)||'00',16), b = parseInt(hex.slice(5,7)||'00',16)
          const a = sh.opacity ?? 0.8
          const ox = (sh.offsetX ?? 2) * fontScale
          const oy = (sh.offsetY ?? 2) * fontScale
          const bl = (sh.blur ?? 6) * fontScale
          return `${ox}px ${oy}px ${bl}px rgba(${r},${g},${b},${a})`
        })(),
        ...bgStyle,
      }}
    >
      {segment.text}
    </div>
  )
}
