import { bump, clamp, easeInOut, invLerp, lerp, monotoneCubic, smoothstep } from "./math"

// The whole page as pure functions of the scroll progress p (0..1) and the viewport aspect.
// WebGL and the HTML overlay both read from the same TimelineState, so they never drift apart.
//
// World layout: the hero sphere sits at the origin (radius 1), the camera starts on +z looking
// down -z. After the dive the camera follows a path parameterised by the card coordinate s:
// card i is in focus when s = i. The path drifts right and up so the next card always waits
// to the right and higher, and the focused card passes out to the left as the camera moves on.

export const PHASES = {
  hero: [0.0, 0.12],
  dive: [0.12, 0.24],
  statement: [0.24, 0.34],
  cards: [0.34, 0.82],
  outro: [0.82, 0.9],
  finale: [0.9, 1.0],
} as const

export const FOV = 35 // vertical, degrees
export const TAN_HALF_FOV = Math.tan((FOV * Math.PI) / 360)

export const CARD_W = 1.6
export const CARD_H = 1.0
const SPACING = 3.2 // z distance between cards
const FOCUS_DISTANCE = 4.8 // camera -> focused card on a 16:9 screen
// Linear s at the start of the statement. An integer is where the dwell curve is slowest, so the
// path starts gently, like the dive ends.
const S_START = -3
const S_SLOPE = (6.35 - S_START) / (PHASES.cards[1] - PHASES.statement[0]) // last card + 0.35 at the end of the cards
const DWELL = 0.5 // 0 = constant speed, <1 = slows down around each card (speed 0.5x..1.5x)
const CAMERA_START = 7.2
const CAMERA_HERO_END = 5.6
const CAMERA_FILL = 2.05 // the sphere covers a 16:9 screen from here (silhouette ~1.1 heights)
const CAMERA_DIVE_END = 1.6
const FINALE_DISTANCE = 6

export interface Vec3 {
  x: number
  y: number
  z: number
}

const vec = (): Vec3 => ({ x: 0, y: 0, z: 0 })

export class TimelineState {
  p = 0
  aspect = 16 / 9
  // Local progress per phase, 0..1.
  hero = 0
  dive = 0
  statement = 0
  cards = 0
  outro = 0
  finale = 0

  s = 0 // card coordinate
  cardCount = 7
  focusIndex = 0 // nearest card
  focusWeight = 0 // 1 while the focused card's title should show
  focusDistance = FOCUS_DISTANCE
  cardsAlpha = 0

  camera = vec()

  heroSphereVisible = true
  heroHole = 0 // hole radius as a fraction of the sphere's projected radius
  heroAlpha = 1
  heroDarken = 0

  finaleSphereVisible = false
  finaleOffset = vec() // relative to the camera
  finaleRadius = 1
  finaleHole = 0
  finaleAlpha = 0
  finaleFollow = 0 // how much the sphere follows the pointer

  vortex = 0 // screen twist in the composite, 0..1
  nebula = 1 // backdrop brightness

  // Overlay
  heroText = 1
  heroTextY = 0 // px
  statementText = 0
  statementBlur = 0 // px
  statementDim = 0 // 0..1 darkening while it fades in
  statementY = 0 // px
  cardsUi = 0
  contact = 0
  scrollHint = 1
}

const local = (p: number, range: readonly [number, number]) => invLerp(range[0], range[1], p)

// Slows down around integer s so each card dwells in focus. Monotonic for DWELL < 1.
const dwell = (x: number) => x - (DWELL * Math.sin(2 * Math.PI * x)) / (2 * Math.PI)

const S_PATH_START = dwell(S_START) // where the path leaves the dive position
// dz/dp of the path where it starts (dwell slope at an integer is 1 - DWELL).
const PATH_START_SPEED = SPACING * S_SLOPE * (1 - DWELL)

// Camera keyframes (p, z) for the hero and the dive; the first two depend on the aspect.
const CAM_P = [0, PHASES.hero[1], PHASES.dive[0] + 0.7 * (PHASES.dive[1] - PHASES.dive[0]), PHASES.dive[1]]
const CAM_Z = [CAMERA_START, CAMERA_HERO_END, CAMERA_FILL, CAMERA_DIVE_END]
const camSlopes = [0, 0, 0, 0]

// C1 ramp: 0 below 0, quadratic in [0, 1], then linear with slope 1.
const ramp = (x: number) => (x <= 0 ? 0 : x < 1 ? 0.5 * x * x : x - 0.5)

// Layout that depends on the viewport shape: cards must fit the width, sideways drift scales
// with the visible width.
function lateralScale(aspect: number) {
  return clamp(aspect / (16 / 9), 0.45, 1)
}

// On narrow screens the hero starts further back so the sphere stays under ~70% of the width.
function heroDistance(aspect: number) {
  return Math.max(CAMERA_START, 2 / (0.7 * 2 * TAN_HALF_FOV * aspect))
}

function focusDistanceFor(aspect: number) {
  // Card at most ~55% of the screen width.
  return Math.max(FOCUS_DISTANCE, CARD_W / (0.55 * 2 * TAN_HALF_FOV * aspect))
}

// Camera position on the post-dive path at card coordinate s.
export function pathAt(s: number, aspect: number, out: Vec3) {
  const k = lateralScale(aspect)
  const r = ramp(s - S_PATH_START)
  out.x = 3.0 * k * r
  out.y = 0.6 * r
  out.z = CAMERA_DIVE_END - SPACING * (s - S_PATH_START)
  return out
}

// World position of card i: where the camera stands when s = i, plus the focus offset
// (slightly left of centre and up, in front at the focus distance).
export function cardPosition(i: number, aspect: number, out: Vec3) {
  pathAt(i, aspect, out)
  const d = focusDistanceFor(aspect)
  const k = lateralScale(aspect)
  out.x += -0.45 * k * (d / FOCUS_DISTANCE)
  out.y += 0.18 * (d / FOCUS_DISTANCE)
  out.z -= d
  return out
}

// Card opacity by its distance in front of the camera: fades in from the depth, out when passing.
export function cardFade(distance: number) {
  return smoothstep(15, 9, distance) * smoothstep(1.2, 3.0, distance)
}

export function evaluate(p: number, aspect: number, cardCount: number, st: TimelineState) {
  p = clamp(p)
  st.p = p
  st.aspect = aspect
  st.cardCount = cardCount
  st.hero = local(p, PHASES.hero)
  st.dive = local(p, PHASES.dive)
  st.statement = local(p, PHASES.statement)
  st.cards = local(p, PHASES.cards)
  st.outro = local(p, PHASES.outro)
  st.finale = local(p, PHASES.finale)
  st.focusDistance = focusDistanceFor(aspect)

  // --- Camera ---------------------------------------------------------------------------------
  // Linear in p through the cards, then a C1 ease-out to rest at the start of the finale.
  const [o0, o1] = PHASES.outro
  const q = Math.min(p, o0) + (p > o0 ? Math.min(p - o0, o1 - o0) - Math.min(p - o0, o1 - o0) ** 2 / (2 * (o1 - o0)) : 0)
  const sLinear = S_START + S_SLOPE * (q - PHASES.statement[0])
  st.s = dwell(sLinear)
  if (p < PHASES.dive[1]) {
    st.camera.x = 0
    st.camera.y = 0
    // One smooth, monotone curve from the hero to the end of the dive: drift towards the sphere,
    // rush in until it fills the screen, slow while the hole opens, and leave at the speed the
    // card path starts with. (Stitched easings stopped the camera at every seam.)
    const start = heroDistance(aspect)
    CAM_Z[0] = start
    CAM_Z[1] = start - (CAMERA_START - CAMERA_HERO_END)
    st.camera.z = monotoneCubic(CAM_P, CAM_Z, camSlopes, p, -PATH_START_SPEED)
  } else {
    pathAt(st.s, aspect, st.camera)
  }

  // --- Hero sphere and the dive ---------------------------------------------------------------
  st.heroSphereVisible = p < PHASES.dive[1] + 0.005
  st.heroHole = 1.3 * Math.pow(smoothstep(0.4, 0.95, st.dive), 2)
  st.heroAlpha = 1 - smoothstep(0.75, 1.0, st.dive)
  st.heroDarken = smoothstep(0.55, 1.0, st.dive)

  // --- Cards ----------------------------------------------------------------------------------
  st.cardsAlpha = smoothstep(0.27, 0.31, p) * (1 - smoothstep(0.86, 0.9, p))
  const nearest = Math.round(st.s)
  st.focusIndex = clamp(nearest, 0, cardCount - 1)
  st.focusWeight =
    (1 - smoothstep(0.2, 0.42, Math.abs(st.s - st.focusIndex))) * smoothstep(0.33, 0.35, p) * (1 - smoothstep(0.81, 0.83, p))

  // --- Second vortex and the finale sphere ----------------------------------------------------
  // The finale sphere is the dive in reverse: its hole closes around the view, then it pulls
  // back to the lower left where it follows the pointer.
  st.finaleSphereVisible = p > PHASES.outro[0] - 0.005
  st.finaleHole = 1.3 * Math.pow(1 - smoothstep(0.05, 0.85, st.outro), 2)
  st.finaleAlpha = smoothstep(0.0, 0.35, st.outro)
  const settle = easeInOut(smoothstep(0.0, 0.75, st.finale))
  const halfH = FINALE_DISTANCE * TAN_HALF_FOV
  const landscape = aspect >= 1
  const ndcX = landscape ? -0.62 : -0.5
  const ndcY = landscape ? -0.45 : 0.55
  const radius = (landscape ? 1.1 : 0.6) * halfH
  st.finaleOffset.x = lerp(0, ndcX * halfH * aspect, settle)
  st.finaleOffset.y = lerp(0, ndcY * halfH, settle)
  st.finaleOffset.z = lerp(-CAMERA_DIVE_END, -FINALE_DISTANCE, settle)
  st.finaleRadius = lerp(1, radius, settle)
  st.finaleFollow = settle

  // --- Screen effects ---------------------------------------------------------------------------
  st.vortex = bump(0.15, 0.255, p) + bump(0.81, 0.885, p)
  st.nebula = 1 - 0.25 * smoothstep(0.3, 0.36, p) + 0.15 * smoothstep(0.9, 1.0, p)

  // --- Overlay ----------------------------------------------------------------------------------
  st.scrollHint = 1 - smoothstep(0.0, 0.025, p)
  st.heroText = 1 - smoothstep(0.0, 0.4, st.dive)
  st.heroTextY = -80 * smoothstep(0.0, 0.5, st.dive)
  const statementIn = smoothstep(0.195, 0.235, p)
  const sharpen = smoothstep(0.205, 0.275, p)
  const statementOut = smoothstep(0.31, 0.355, p)
  st.statementText = statementIn * (1 - statementOut)
  st.statementBlur = 14 * (1 - sharpen) + 10 * statementOut
  st.statementDim = 1 - sharpen
  st.statementY = -90 * statementOut
  st.cardsUi = smoothstep(0.33, 0.35, p) * (1 - smoothstep(0.82, 0.85, p))
  st.contact = smoothstep(0.93, 0.98, p)
  return st
}

// Dev-only sanity checks: continuity, monotonic travel, ranges.
export function selfTest() {
  const a = new TimelineState()
  const b = new TimelineState()
  const N = 2000
  let ok = true
  const fail = (msg: string) => {
    ok = false
    console.error("timeline:", msg)
  }
  for (const aspect of [16 / 9, 1, 9 / 19.5]) {
    let lastSpeed = 0
    for (let i = 0; i < N; i++) {
      const p0 = i / N
      const p1 = (i + 1) / N
      evaluate(p0, aspect, 7, a)
      evaluate(p1, aspect, 7, b)
      const jump = Math.hypot(b.camera.x - a.camera.x, b.camera.y - a.camera.y, b.camera.z - a.camera.z)
      if (jump > 0.15) fail(`camera jumps by ${jump.toFixed(3)} at p=${p0.toFixed(4)} (aspect ${aspect.toFixed(2)})`)
      if (b.camera.z > a.camera.z + 1e-9) fail(`camera moves backwards at p=${p0.toFixed(4)}`)
      // Smoothness: no stalls while travelling, no jumps in speed (dz/dp).
      const speed = (a.camera.z - b.camera.z) * N
      if (i > 0 && Math.abs(speed - lastSpeed) > 3) fail(`camera speed jumps ${lastSpeed.toFixed(1)} -> ${speed.toFixed(1)} at p=${p0.toFixed(4)}`)
      if (p0 > 0.002 && p0 < PHASES.outro[1] - 0.01 && speed < 2) fail(`camera stalls (dz/dp=${speed.toFixed(2)}) at p=${p0.toFixed(4)}`)
      lastSpeed = speed
      if (b.s < a.s - 1e-9) fail(`s decreases at p=${p0.toFixed(4)}`)
      for (const k of ["heroText", "statementText", "cardsUi", "contact", "focusWeight", "heroAlpha", "finaleAlpha", "vortex"] as const) {
        const v = a[k]
        if (!(v >= 0 && v <= 1.0001)) fail(`${k}=${v} out of range at p=${p0.toFixed(4)}`)
      }
    }
  }
  // Each card gets its moment in focus.
  for (let i = 0; i < 7; i++) {
    let seen = false
    for (let j = 0; j <= N; j++) {
      evaluate(j / N, 16 / 9, 7, a)
      if (a.focusIndex === i && a.focusWeight > 0.99) seen = true
    }
    if (!seen) fail(`card ${i} never in full focus`)
  }
  evaluate(0, 16 / 9, 7, a)
  if (a.heroText !== 1 || a.statementText !== 0) fail("start state")
  evaluate(1, 16 / 9, 7, a)
  if (a.contact < 0.99 || a.cardsAlpha > 0 || a.heroSphereVisible) fail("end state")
  if (ok) console.info("timeline: self test passed")
  return ok
}

// Scroll progress at which card i is in focus (dwell keeps integers fixed).
export function progressForCard(i: number) {
  return PHASES.statement[0] + (i - S_START) / S_SLOPE
}
