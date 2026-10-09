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
