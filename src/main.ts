import * as THREE from "three"
import "./style.css"
import { cards as cardContent } from "./content"
import { Input } from "./core/input"
import { clamp } from "./core/math"
import { FOV, TimelineState, evaluate, progressForCard, selfTest } from "./core/timeline"
import { FluidSim } from "./fluid/FluidSim"
import { Overlay } from "./overlay/Overlay"
import { Bubbles } from "./scene/Bubbles"
import { Cards } from "./scene/Cards"
import { Composite } from "./scene/Composite"
import { Nebula } from "./scene/Nebula"
import { Particles } from "./scene/Particles"
import { Sphere } from "./scene/Sphere"

// Entry point: renderer, resize, frame loop. One frame:
// input -> timeline -> fluid -> particles -> scene into an HDR target -> composite to the canvas.
// `?debug=dye` / `?debug=velocity` shows the fluid alone; `?p=0.5` starts at a scroll position.

const MAX_DPR = 1.75
const MIN_DPR = 1
const SLOW_FRAME = 1 / 45 // average frame time that triggers a lower resolution
const SPLAT_MAX = 4 // uv/s per axis
const params = new URLSearchParams(location.search)
const debug = params.get("debug")
const mobile = window.matchMedia("(pointer: coarse)").matches || Math.min(window.innerWidth, window.innerHeight) < 600

const canvas = document.getElementById("gl") as HTMLCanvasElement
const overlayRoot = document.getElementById("overlay") as HTMLElement
const input = new Input(document.documentElement)
const state = new TimelineState()
const overlay = new Overlay(overlayRoot, { scrollTo: p => input.scrollTo(p) }, progressForCard(0) - 0.012)

let renderer: THREE.WebGLRenderer | null = null
try {
  renderer = new THREE.WebGLRenderer({ canvas, antialias: false, alpha: false, powerPreference: "high-performance" })
} catch (err) {
  console.warn("WebGL2 unavailable, showing the text only", err)
  document.body.classList.add("nogl")
}

let paused = false // dev hook: headless checks step the simulation themselves

if (renderer) start(renderer)
else {
  // No WebGL: the overlay still follows the virtual scroll.
  let last = performance.now()
  const loop = (now: number) => {
    input.update(Math.min((now - last) / 1000, 0.1))
    last = now
    overlay.update(evaluate(input.progress, window.innerWidth / window.innerHeight, cardContent.length, state))
    requestAnimationFrame(loop)
  }
  requestAnimationFrame(loop)
}

function start(renderer: THREE.WebGLRenderer) {
  renderer.setClearColor(0x0b0a2a, 1)
  renderer.autoClear = false

  const fluid = new FluidSim(renderer, mobile ? { simResolution: 96, dyeResolution: 384 } : {})
  const camera = new THREE.PerspectiveCamera(FOV, 1, 0.1, 120)
  const scene = new THREE.Scene()

  const heroSphere = new Sphere(fluid.dye)
  const finaleSphere = new Sphere(fluid.dye)
  const bubbles = new Bubbles(mobile ? 10 : 18)
  const particles = new Particles(renderer, fluid.velocity, { size: mobile ? 64 : 128 })
  const cards = new Cards(
    renderer,
    cardContent.map(c => `${import.meta.env.BASE_URL}cards/${c.image}`),
    fluid.velocity,
    fluid.dye,
  )
  scene.add(heroSphere.mesh, finaleSphere.mesh, bubbles.mesh, particles.points, cards.group)

  const nebula = new Nebula(renderer)
  const composite = new Composite(renderer, fluid.velocity, fluid.dye)
  const fluidView = debug === "dye" || debug === "velocity" ? import("./dev/fluidView").then(m => new m.FluidView(renderer, fluid, debug)) : null
  let fluidViewReady: { render(): void } | null = null
  fluidView?.then(v => (fluidViewReady = v))

  const hdr = new THREE.WebGLRenderTarget(1, 1, {
    type: THREE.HalfFloatType,
    samples: mobile ? 0 : 4,
    depthBuffer: true,
  })
  hdr.texture.colorSpace = THREE.NoColorSpace

  // ---------------------------------------------------------------------------------------------

  const size = new THREE.Vector2()
  let width = 0
  let height = 0
  let dprCap = MAX_DPR // lowered by the adaptive resolution below

  function resize() {
    width = window.innerWidth
    height = window.innerHeight
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, dprCap))
    renderer.setSize(width, height, false)
    renderer.getDrawingBufferSize(size)
    hdr.setSize(size.x, size.y)
    camera.aspect = width / height
    camera.updateProjectionMatrix()
    fluid.resize(width, height)
    input.resize()
    for (const s of [heroSphere, finaleSphere]) {
      s.uniforms.uResolution.value.copy(size)
      s.uniforms.uAspect.value = camera.aspect
    }
    composite.uniforms.uResolution.value.copy(size)
    composite.uniforms.uAspect.value = camera.aspect
    nebula.uniforms.uAspect.value = camera.aspect
  }
  window.addEventListener("resize", resize)
  resize()

  // Adaptive resolution: if frames stay slow for two seconds, render fewer pixels. Only ever
  // steps down, so it cannot oscillate.
  let slowTime = 0
  let frameAvg = 1 / 60
  function adapt(dt: number) {
    frameAvg += (dt - frameAvg) * 0.05
    slowTime = frameAvg > SLOW_FRAME ? slowTime + dt : 0
    const current = Math.min(window.devicePixelRatio, dprCap)
    if (slowTime > 2 && current > MIN_DPR) {
      dprCap = Math.max(MIN_DPR, current - 0.25)
      slowTime = 0
      frameAvg = 1 / 60
      resize()
    }
  }

  canvas.addEventListener("webglcontextlost", e => {
    e.preventDefault()
    document.body.classList.add("nogl")
  })
  canvas.addEventListener("webglcontextrestored", () => location.reload())

  const startP = Number(params.get("p"))
  if (startP > 0) input.seek(startP)

  // --- Fluid input ------------------------------------------------------------------------------

  const palette: [number, number, number][] = [
    [0.55, 0.4, 1.0], // violet
    [0.2, 0.85, 1.0], // cyan
    [0.85, 0.8, 1.0], // pale lavender
  ]
  let hue = 0
  const move = { x: 0, y: 0 }

  function stirFluid(dt: number) {
    if (dt <= 0) return
    if (input.consumeMovement(move)) {
      const vx = clamp((1.25 * move.x) / width / dt, -SPLAT_MAX, SPLAT_MAX)
      const vy = clamp((-1.25 * move.y) / height / dt, -SPLAT_MAX, SPLAT_MAX)
      hue = (hue + dt * 0.25) % palette.length
      const c = palette[Math.floor(hue)]
      const k = (debug ? 0.2 : 0.035) * dt * 60
      fluid.splat(input.uv.x, input.uv.y, vx, vy, [c[0] * k, c[1] * k, c[2] * k], 0.04)
    }
    // Flying forward pushes the liquid outwards from the centre (inwards when scrolling back).
    const push = input.reducedMotion ? 0 : clamp(input.velocity * 9, -1.4, 1.4) * 0.5
    if (Math.abs(push) > 0.01) fluid.push(0.5, 0.5, push, 0.25)
  }

  // --- Frame ----------------------------------------------------------------------------------

  const camBase = new THREE.Vector3()
  const camPrev = new THREE.Vector3()
  const camDelta = new THREE.Vector3()
  let camInit = false
  let travel = 0
  let time = 0
  let last = performance.now()

  function frame(now: number) {
    const dt = Math.min((now - last) / 1000, 0.1)
    last = now
    if (!paused) {
      time += dt
      step(dt)
      if (dt > 0 && !document.hidden) adapt(dt)
    }
    render()
    requestAnimationFrame(frame)
  }

  function step(dt: number) {
    input.update(dt)
    const st = evaluate(input.progress, camera.aspect, cards.count, state)

    // Camera: timeline position plus a pointer lean (translation gives parallax: near layers
    // move more) and a touch of rotation.
    camBase.set(st.camera.x, st.camera.y, st.camera.z)
    camDelta.subVectors(camBase, camInit ? camPrev : camBase)
    if (camDelta.length() > 3) camDelta.setLength(3) // seeks and resizes jump; do not fling particles
    camPrev.copy(camBase)
    camInit = true
    camera.position.set(camBase.x + input.lean.x * 0.22, camBase.y + input.lean.y * 0.14, camBase.z)
    camera.rotation.set(input.lean.y * 0.018, -input.lean.x * 0.028, 0)
    camera.updateMatrixWorld()

    // Hero sphere: the dive opens its hole.
    heroSphere.mesh.visible = st.heroSphereVisible
    if (heroSphere.mesh.visible) {
      const u = heroSphere.uniforms
      u.uTime.value = time
      u.uHole.value = st.heroHole
      u.uAlpha.value = st.heroAlpha
      u.uDarken.value = st.heroDarken
      heroSphere.mesh.position.set(0, 0, 0)
      heroSphere.mesh.updateMatrixWorld()
      heroSphere.updateHoleCenter(camera)
    }

    // Finale sphere: closes in around the view, then settles lower left and follows the pointer.
    finaleSphere.mesh.visible = st.finaleSphereVisible
    if (finaleSphere.mesh.visible) {
      const u = finaleSphere.uniforms
      u.uTime.value = time + 40
      u.uHole.value = st.finaleHole
      u.uAlpha.value = st.finaleAlpha
      u.uDarken.value = 0
      const f = st.finaleFollow
      finaleSphere.mesh.position.set(
        camBase.x + st.finaleOffset.x + input.follow.x * 0.45 * f,
        camBase.y + st.finaleOffset.y + input.follow.y * 0.3 * f,
        camBase.z + st.finaleOffset.z,
      )
      finaleSphere.mesh.scale.setScalar(st.finaleRadius)
      finaleSphere.mesh.updateMatrixWorld()
      finaleSphere.updateHoleCenter(camera)
    }

    // Bubbles stream towards the camera with the forward motion plus a slow drift.
    travel += Math.max(-camDelta.z, 0) + dt * 0.35
    bubbles.uniforms.uCamPos.value.copy(camBase)
    bubbles.uniforms.uTravel.value = travel
    bubbles.uniforms.uTime.value = time

    cards.update(time, camera, camera.aspect, st.cardsAlpha, st.s, size)

    stirFluid(dt)
    fluid.update(dt)
    particles.update(dt, time, camera, camDelta, size.y)

    nebula.uniforms.uTime.value = time
    nebula.uniforms.uBrightness.value = st.nebula
    nebula.uniforms.uOffset.value.set(input.lean.x * 0.04 + camBase.x * 0.01, input.lean.y * 0.03 + camBase.y * 0.01)
    composite.uniforms.uTime.value = time
    composite.uniforms.uVortex.value = st.vortex * (input.reducedMotion ? 0.3 : 1)

    overlay.update(st)
  }

  function render() {
    if (fluidViewReady) {
      fluidViewReady.render()
      return
    }
    renderer.setRenderTarget(hdr)
    renderer.clear()
    nebula.render(hdr)
    renderer.render(scene, camera)
    composite.render(hdr.texture)
  }

  requestAnimationFrame(frame)

  // Dev hooks for headless verification.
  if (import.meta.env.DEV) {
    selfTest()
    import("./dev/probe").then(({ TextureProbe }) => {
      window.__demo = {
        fluid,
        renderer,
        particles,
        state,
        input,
        probe: new TextureProbe(renderer),
        seek: (p: number) => input.seek(p),
        pause: (value = true) => {
          paused = value
        },
        // Advance the simulation by n fixed steps (works while paused), then render once.
        step: (n = 1, dt = 1 / 60) => {
          for (let i = 0; i < n; i++) {
            time += dt
            step(dt)
          }
          render()
        },
      }
    })
  }
}

declare global {
  interface Window {
    __demo?: Record<string, unknown>
  }
}
