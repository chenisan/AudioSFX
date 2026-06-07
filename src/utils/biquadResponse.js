// Combined EQ magnitude response (dB) for the fixed 5-band parametric chain,
// using RBJ biquad coefficients. Mirrors the Web Audio BiquadFilter types used
// in the preview (lowshelf / peaking / highshelf) so the drawn curve matches
// what you hear and what the export bakes in.

function clamp(v, lo, hi) {
  v = Number(v)
  return Number.isFinite(v) ? Math.max(lo, Math.min(hi, v)) : lo
}

// RBJ cookbook coefficients, normalised so a0 = 1 → [b0, b1, b2, 1, a1, a2].
function coeffs(type, f0, gainDb, Q, fs) {
  const A = Math.pow(10, gainDb / 40)
  const w0 = (2 * Math.PI * f0) / fs
  const cw = Math.cos(w0), sw = Math.sin(w0)
  const alpha = sw / (2 * Math.max(0.0001, Q))
  let b0, b1, b2, a0, a1, a2
  if (type === 'lowshelf') {
    const s = 2 * Math.sqrt(A) * alpha
    b0 = A * ((A + 1) - (A - 1) * cw + s)
    b1 = 2 * A * ((A - 1) - (A + 1) * cw)
    b2 = A * ((A + 1) - (A - 1) * cw - s)
    a0 = (A + 1) + (A - 1) * cw + s
    a1 = -2 * ((A - 1) + (A + 1) * cw)
    a2 = (A + 1) + (A - 1) * cw - s
  } else if (type === 'highshelf') {
    const s = 2 * Math.sqrt(A) * alpha
    b0 = A * ((A + 1) + (A - 1) * cw + s)
    b1 = -2 * A * ((A - 1) + (A + 1) * cw)
    b2 = A * ((A + 1) + (A - 1) * cw - s)
    a0 = (A + 1) - (A - 1) * cw + s
    a1 = 2 * ((A - 1) - (A + 1) * cw)
    a2 = (A + 1) - (A - 1) * cw - s
  } else {
    // peaking
    b0 = 1 + alpha * A; b1 = -2 * cw; b2 = 1 - alpha * A
    a0 = 1 + alpha / A; a1 = -2 * cw; a2 = 1 - alpha / A
  }
  return [b0 / a0, b1 / a0, b2 / a0, 1, a1 / a0, a2 / a0]
}

function magDb(c, f, fs) {
  const w = (2 * Math.PI * f) / fs
  const cw = Math.cos(w), c2w = Math.cos(2 * w)
  const [b0, b1, b2, , a1, a2] = c
  const num = b0 * b0 + b1 * b1 + b2 * b2 + 2 * (b0 * b1 + b1 * b2) * cw + 2 * b0 * b2 * c2w
  const den = 1 + a1 * a1 + a2 * a2 + 2 * (a1 + a1 * a2) * cw + 2 * a2 * c2w
  return 10 * Math.log10(Math.max(1e-9, num / den))
}

export function bandCoeffs(band, fs = 48000) {
  const type = (band?.type === 'lowshelf' || band?.type === 'highshelf') ? band.type : 'peaking'
  return coeffs(type, clamp(band?.freq, 20, 20000), Number(band?.gain) || 0, clamp(band?.q, 0.1, 20) || 1, fs)
}

/** Combined response (summed dB) of all bands at each frequency in `freqs`. */
export function eqCurveDb(bands, freqs, fs = 48000) {
  const cs = (bands || []).map(b => bandCoeffs(b, fs))
  return freqs.map(f => cs.reduce((sum, c) => sum + magDb(c, f, fs), 0))
}
