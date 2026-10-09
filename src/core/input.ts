import { clamp, damp } from "./math"

// Virtual scroll + pointer. The page itself never scrolls: wheel, touch and keys move a target
// position along a virtual track of TRACK_SCREENS viewport heights; the visible position follows
// it with damping. Progress p = position / track length.

const TRACK_SCREENS = 9
const SCROLL_DAMPING = 5.5 // 1/s
const TOUCH_GAIN = 1.6
const TOUCH_FRICTION = 3.5 // 1/s, inertia decay after the finger lifts
const LEAN_DAMPING = 2.5
const MAX_WHEEL_STEP = 220 // px per event; tames huge trackpad / mouse deltas

export class Input {
  readonly reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches

  // Scroll, in px of the virtual track.
  private target = 0
  private current = 0
  private track = 1
  private touchY: number | null = null
  private touchVelocity = 0 // px/s, while flinging
  private lastTouchTime = 0

  progress = 0
  velocity = 0 // progress per second, signed

  // Pointer. ndc: -1..1 with y up; uv: 0..1 with y up.
  readonly ndc = { x: 0, y: 0 }
  readonly uv = { x: 0.5, y: 0.5 }
  readonly lean = { x: 0, y: 0 } // damped ndc, for parallax
  readonly follow = { x: 0, y: 0 } // slower, for the finale sphere
  // Movement since the last consumeMovement(), in px.
  private moveX = 0
  private moveY = 0
  private moved = false
  private lastX: number | null = null
  private lastY = 0
  pointerInside = false

  constructor(private readonly element: HTMLElement) {
    this.resize()
    window.addEventListener("wheel", this.onWheel, { passive: false })
    window.addEventListener("keydown", this.onKey)
    element.addEventListener("touchstart", this.onTouchStart, { passive: true })
    element.addEventListener("touchmove", this.onTouchMove, { passive: false })
    element.addEventListener("touchend", this.onTouchEnd)
    element.addEventListener("touchcancel", this.onTouchEnd)
    window.addEventListener("pointermove", this.onPointerMove)
    window.addEventListener("pointerdown", e => {
      this.lastX = e.clientX // a touch starts a new stroke instead of jumping from the last one
      this.lastY = e.clientY
    })
    document.documentElement.addEventListener("pointerleave", () => {
      this.pointerInside = false
      this.lastX = null
    })
  }

  resize() {
    const p = this.progress
    this.track = Math.max(1, (TRACK_SCREENS - 1) * window.innerHeight)
    // Keep the same progress across resizes.
    this.target = this.current = p * this.track
  }

  // Jump to a position immediately (dev hook, deep links).
  seek(p: number) {
    this.target = this.current = clamp(p) * this.track
    this.touchVelocity = 0
    this.progress = clamp(p)
    this.velocity = 0
  }

  // Scroll by a fraction of the track (buttons such as "Explore projects").
  scrollTo(p: number) {
    this.target = clamp(p) * this.track
  }

  update(dt: number) {
    if (this.touchY === null && this.touchVelocity !== 0) {
      this.addScroll(this.touchVelocity * dt)
      this.touchVelocity *= Math.exp(-TOUCH_FRICTION * dt)
      if (Math.abs(this.touchVelocity) < 5) this.touchVelocity = 0
    }

    const before = this.current
    const rate = this.reducedMotion ? SCROLL_DAMPING * 2.5 : SCROLL_DAMPING
    this.current = damp(this.current, this.target, rate, dt)
    if (Math.abs(this.current - this.target) < 0.05) this.current = this.target
    this.progress = this.current / this.track
    this.velocity = dt > 0 ? (this.current - before) / this.track / dt : 0

    const leanRate = this.reducedMotion ? 0 : LEAN_DAMPING
    const tx = this.pointerInside ? this.ndc.x : 0
    const ty = this.pointerInside ? this.ndc.y : 0
    this.lean.x = damp(this.lean.x, tx, leanRate, dt)
    this.lean.y = damp(this.lean.y, ty, leanRate, dt)
    this.follow.x = damp(this.follow.x, this.ndc.x, leanRate * 0.6, dt)
    this.follow.y = damp(this.follow.y, this.ndc.y, leanRate * 0.6, dt)
  }

  // Pointer movement since the last call (px, y down) or null when it did not move.
  consumeMovement(out: { x: number; y: number }) {
    if (!this.moved) return null
    out.x = this.moveX
    out.y = this.moveY
    this.moveX = 0
    this.moveY = 0
    this.moved = false
    return out
  }

  private addScroll(px: number) {
    this.target = clamp(this.target + px, 0, this.track)
  }

  private onWheel = (e: WheelEvent) => {
    if (e.ctrlKey) return // pinch zoom
    e.preventDefault()
    const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? window.innerHeight : 1
    const delta = clamp(e.deltaY * unit, -MAX_WHEEL_STEP, MAX_WHEEL_STEP)
    this.addScroll(delta)
  }

  private onKey = (e: KeyboardEvent) => {
    const t = e.target as HTMLElement | null
    if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return
    const page = window.innerHeight * 0.85
    switch (e.key) {
      case "ArrowDown":
        this.addScroll(120)
        break
      case "ArrowUp":
        this.addScroll(-120)
        break
      case "PageDown":
        this.addScroll(page)
        break
      case "PageUp":
        this.addScroll(-page)
        break
      case " ":
        if (t && /^(BUTTON|A)$/.test(t.tagName)) return // space activates the control
        this.addScroll(e.shiftKey ? -page : page)
        break
      case "Home":
        this.target = 0
        break
      case "End":
        this.target = this.track
        break
      default:
        return
    }
    e.preventDefault()
  }

  private onTouchStart = (e: TouchEvent) => {
    this.touchY = e.touches[0].clientY
    this.touchVelocity = 0
    this.lastTouchTime = performance.now()
  }

  private onTouchMove = (e: TouchEvent) => {
    if (this.touchY === null) return
    e.preventDefault()
    const y = e.touches[0].clientY
    const now = performance.now()
    const delta = (this.touchY - y) * TOUCH_GAIN
    const dt = Math.max((now - this.lastTouchTime) / 1000, 1 / 240)
    this.addScroll(delta)
    // Smoothed fling velocity.
    this.touchVelocity = 0.8 * (delta / dt) + 0.2 * this.touchVelocity
    this.touchY = y
    this.lastTouchTime = now
  }

  private onTouchEnd = () => {
    if (performance.now() - this.lastTouchTime > 80) this.touchVelocity = 0 // finger rested before lifting
    this.touchY = null
  }

  private onPointerMove = (e: PointerEvent) => {
    const w = this.element.clientWidth || window.innerWidth
    const h = this.element.clientHeight || window.innerHeight
    this.uv.x = e.clientX / w
    this.uv.y = 1 - e.clientY / h
    this.ndc.x = this.uv.x * 2 - 1
    this.ndc.y = this.uv.y * 2 - 1
    this.pointerInside = true
    // Deltas from client coordinates: movementX is 0 for touch in some browsers.
    if (this.lastX !== null) {
      this.moveX += e.clientX - this.lastX
      this.moveY += e.clientY - this.lastY
      this.moved = true
    }
    this.lastX = e.clientX
    this.lastY = e.clientY
  }
}
