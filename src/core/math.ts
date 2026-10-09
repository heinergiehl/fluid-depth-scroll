// Small scalar helpers shared by the timeline, input and scene code.

export const clamp = (x: number, a = 0, b = 1) => (x < a ? a : x > b ? b : x)
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t
export const invLerp = (a: number, b: number, x: number) => clamp((x - a) / (b - a))

export function smoothstep(a: number, b: number, x: number) {
  const t = invLerp(a, b, x)
  return t * t * (3 - 2 * t)
}

export const easeInOut = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2)
export const easeOut = (t: number) => 1 - Math.pow(1 - t, 3)
export const easeIn = (t: number) => t * t * t

// Frame-rate independent exponential approach: `rate` is 1/s (higher = snappier).
export const damp = (current: number, target: number, rate: number, dt: number) => lerp(current, target, 1 - Math.exp(-rate * dt))

// 0 -> 1 -> 0 over [a, b], smooth at both ends.
export function bump(a: number, b: number, x: number) {
  const t = invLerp(a, b, x)
  return Math.sin(Math.PI * t) ** 2
}

// Monotone cubic interpolation (Fritsch-Carlson) through (xs[i], ys[i]): C1, never overshoots.
// `slopes` is caller-owned scratch (length >= xs.length), so this does not allocate.
// endSlope, if given, fixes the slope at the last point (clamped to keep the curve monotone).
export function monotoneCubic(xs: readonly number[], ys: readonly number[], slopes: number[], x: number, endSlope?: number) {
  const n = xs.length
  if (x <= xs[0]) return ys[0]
  if (x >= xs[n - 1]) return ys[n - 1]
  for (let i = 0; i < n; i++) {
    const dPrev = i > 0 ? (ys[i] - ys[i - 1]) / (xs[i] - xs[i - 1]) : NaN
    const dNext = i < n - 1 ? (ys[i + 1] - ys[i]) / (xs[i + 1] - xs[i]) : NaN
    if (i === 0) slopes[i] = dNext
    else if (i === n - 1) slopes[i] = endSlope !== undefined ? endSlope : dPrev
    else slopes[i] = dPrev * dNext <= 0 ? 0 : (2 * dPrev * dNext) / (dPrev + dNext) // harmonic mean
    // Monotonicity: slope at most 3x the adjacent secants.
    const lim = 3 * Math.min(Math.abs(Number.isNaN(dPrev) ? Infinity : dPrev), Math.abs(Number.isNaN(dNext) ? Infinity : dNext))
    if (Math.abs(slopes[i]) > lim) slopes[i] = Math.sign(slopes[i]) * lim
  }
  let i = 0
  while (x > xs[i + 1]) i++
  const h = xs[i + 1] - xs[i]
  const t = (x - xs[i]) / h
  const t2 = t * t
  const t3 = t2 * t
  return (
    (2 * t3 - 3 * t2 + 1) * ys[i] + (t3 - 2 * t2 + t) * h * slopes[i] + (-2 * t3 + 3 * t2) * ys[i + 1] + (t3 - t2) * h * slopes[i + 1]
  )
}
