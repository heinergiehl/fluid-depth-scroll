import { bump, easeInOut, smoothstep } from "../core/math"

// The dive into a project, as pure functions of its progress t (0 = home, 1 = inside the
// project's cosmos). Played backwards it is the way out. Beats:
//   0.00-0.42  the card leaves its slot and flies at the camera until it fills the screen
//   0.30-0.60  it burns away along glowing edges; the liquid and the particles spiral into a vortex
//   0.45-0.80  the backdrop shifts into the project's accent colour
//   0.58-0.92  the card re-forms as the project's panel
//   0.66-1.00  the project's text sharpens in

export const DURATION = 2.4 // seconds for a full open or close
export const PANEL_SWAP = 0.58 // the card is fully dissolved here: safe to move it to the panel

export class TransitionState {
  t = 0
  fly = 0 // 0 = in the slot, 1 = filling the screen
  dissolve = 0 // card dissolve, 0 = whole
  atPanel = false // after the swap the card sits at the panel pose
  vortex = 0 // screen twist, 0..1
  pull = 0 // particle vortex
  zoom = 0 // radial zoom blur (the rush through the card)
  accent = 0 // backdrop / particle tint
  homeAlpha = 1 // home text and cards
  projectAlpha = 0 // project text and links
  reveal = 0 // panel shows more of the real image
}

export function evaluateTransition(t: number, out: TransitionState) {
  out.t = t
  out.fly = easeInOut(smoothstep(0.0, 0.42, t))
  out.atPanel = t >= PANEL_SWAP
  out.dissolve = out.atPanel ? 1 - smoothstep(PANEL_SWAP, 0.92, t) : smoothstep(0.3, PANEL_SWAP, t)
  out.vortex = bump(0.26, 0.78, t)
  out.pull = bump(0.28, 0.85, t)
  out.zoom = bump(0.32, 0.72, t)
  out.accent = smoothstep(0.45, 0.8, t)
  out.homeAlpha = 1 - smoothstep(0.0, 0.25, t)
  out.projectAlpha = smoothstep(0.66, 1.0, t)
  out.reveal = smoothstep(0.7, 1.0, t)
  return out
}
