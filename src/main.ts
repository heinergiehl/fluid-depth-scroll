import * as THREE from "three"
import "@fontsource/inter-tight/400.css"
import "@fontsource/inter-tight/500.css"
import "@fontsource/inter-tight/600.css"
import "@fontsource/instrument-serif/400-italic.css"
import "./style.css"
import { projects } from "./content"
import { Input } from "./core/input"
import { clamp, damp } from "./core/math"
import { Router } from "./core/router"
import { FOV, TimelineState, evaluate, progressForCard, selfTest } from "./core/timeline"
import { FluidSim } from "./fluid/FluidSim"
import { linear } from "./gl/glsl"
import type { Route } from "./markup"
import { Overlay } from "./overlay/Overlay"
import { Bubbles } from "./scene/Bubbles"
import { Cards, type Pose } from "./scene/Cards"
import { Composite } from "./scene/Composite"
import { Nebula } from "./scene/Nebula"
import { Particles } from "./scene/Particles"
import { Sphere } from "./scene/Sphere"
import { DURATION, PANEL_SWAP, TransitionState, evaluateTransition } from "./scene/Transition"
import { Hud } from "./text/Hud"
import { TextScene } from "./text/TextScene"

// Entry point: renderer, resize, frame loop. One frame:
// input -> timeline (+ project transition) -> fluid -> particles -> scene into an HDR target
// -> composite to the canvas. Routes: "/" is the scroll flight, "/projects/<slug>" a project's
// cosmos; clicking a card plays the transition between them.
// `?debug=dye` / `?debug=velocity` shows the fluid alone; `?p=0.5` starts at a scroll position.

const MAX_DPR = 1.75
const MIN_DPR = 1
const SLOW_FRAME = 1 / 45 // average frame time that triggers a lower resolution
const SPLAT_MAX = 2.5 // uv/s per axis
const SPLAT_GAIN = 0.7 // fraction of the pointer speed handed to the liquid
const SPLAT_RADIUS = 0.055
const PANEL_DISTANCE = 4 // the project panel floats this far in front of the camera
const params = new URLSearchParams(location.search)
const debug = params.get("debug")
const mobile = window.matchMedia("(pointer: coarse)").matches || Math.min(window.innerWidth, window.innerHeight) < 600

const canvas = document.getElementById("gl") as HTMLCanvasElement
const overlayRoot = document.getElementById("overlay") as HTMLElement
const input = new Input(document.documentElement)
const state = new TimelineState()
const router = new Router()
let scrollTarget: (target: "cards" | "contact") => void = target => input.scrollTo(target === "contact" ? 1 : progressForCard(0) - 0.012)
const overlay = new Overlay(overlayRoot, { scrollTo: target => scrollTarget(target) }, router.route)

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
  // No WebGL: the HTML text stays visible and follows the virtual scroll; routes are plain pages.
  router.onChange(() => location.reload())
  overlay.homeAlpha = router.route.name === "home" ? 1 : 0
  overlay.projectAlpha = router.route.name === "home" ? 0 : 1
  let last = performance.now()
  const loop = (now: number) => {
    input.update(Math.min((now - last) / 1000, 0.1))
    last = now
    overlay.update(evaluate(input.progress, window.innerWidth / window.innerHeight, projects.length, state))
    requestAnimationFrame(loop)
  }
  requestAnimationFrame(loop)
}

function start(renderer: THREE.WebGLRenderer) {
  renderer.setClearColor(0x0b0a2a, 1)
  renderer.autoClear = false

  // Gentler swirls than the simulation's defaults: the liquid should feel calm, not stormy.
  const fluid = new FluidSim(renderer, { curl: 16, ...(mobile ? { simResolution: 96, dyeResolution: 384 } : {}) })
  const camera = new THREE.PerspectiveCamera(FOV, 1, 0.1, 120)
  const scene = new THREE.Scene()

  const heroSphere = new Sphere(fluid.dye)
  const finaleSphere = new Sphere(fluid.dye)
  const bubbles = new Bubbles(mobile ? 10 : 18)
  const particles = new Particles(renderer, fluid.velocity, { size: mobile ? 64 : 128 })
  const cards = new Cards(
    renderer,
    projects.map(p => `${import.meta.env.BASE_URL}cards/${p.image}`),
    projects.map(p => p.accent),
    fluid.velocity,
    fluid.dye,
  )
  scene.add(heroSphere.mesh, finaleSphere.mesh, bubbles.mesh, particles.points, cards.group, camera)

  const hud = new Hud(camera)
  const texts = new TextScene(hud, overlay)
  texts.init().catch(err => console.warn("WebGL text unavailable, keeping the HTML text", err))

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
    hud.resize(width, height)
    fluid.resize(width, height)
    input.resize()
    for (const s of [heroSphere, finaleSphere]) {
      s.uniforms.uResolution.value.copy(size)
      s.uniforms.uAspect.value = camera.aspect
    }
    composite.uniforms.uResolution.value.copy(size)
    composite.uniforms.uAspect.value = camera.aspect
    nebula.uniforms.uAspect.value = camera.aspect
    texts.queueLayout()
    measurePanel()
  }
  window.addEventListener("resize", resize)

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

  // --- Fluid input ------------------------------------------------------------------------------

  const palette: [number, number, number][] = [
    [0.55, 0.4, 1.0], // violet
    [0.2, 0.85, 1.0], // cyan
    [0.85, 0.8, 1.0], // pale lavender
  ]
  let hue = 0
  const move = { x: 0, y: 0 }
  // Pointer as the liquid sees it: velocity and position low-passed, so irregular pointer events
  // (some frames none, some two) do not turn into spiky splats.
  const stir = { x: 0.5, y: 0.5, vx: 0, vy: 0, init: false }

  function stirFluid(dt: number) {
    if (dt <= 0) return
    let mx = 0
    let my = 0
    if (input.consumeMovement(move)) {
      mx = move.x / width / dt
      my = -move.y / height / dt
    }
    if (!stir.init && input.pointerInside) {
      stir.x = input.uv.x
      stir.y = input.uv.y
      stir.init = true
    }
    stir.vx = damp(stir.vx, mx, 14, dt)
    stir.vy = damp(stir.vy, my, 14, dt)
    stir.x = damp(stir.x, input.uv.x, 30, dt)
    stir.y = damp(stir.y, input.uv.y, 30, dt)
    const speed = Math.hypot(stir.vx, stir.vy)
    if (stir.init && speed > 0.02) {
      const vx = clamp(stir.vx * SPLAT_GAIN, -SPLAT_MAX, SPLAT_MAX)
      const vy = clamp(stir.vy * SPLAT_GAIN, -SPLAT_MAX, SPLAT_MAX)
      hue = (hue + dt * 0.25) % palette.length
      const c = palette[Math.floor(hue)]
      // A faint tint that only shows on brisk strokes.
      const k = (debug ? 0.2 : 0.012 * Math.min(speed / 1.5, 1)) * dt * 60
      fluid.splat(stir.x, stir.y, vx, vy, [c[0] * k, c[1] * k, c[2] * k], SPLAT_RADIUS)
    }
    // Flying forward pushes the liquid outwards from the centre (inwards when scrolling back).
    const push = input.reducedMotion ? 0 : clamp(input.velocity * 9, -1.4, 1.4) * 0.35
    if (Math.abs(push) > 0.01) fluid.push(0.5, 0.5, push, 0.25)
  }

  // A whirlpool in the liquid: tangential splats on a ring around the centre.
  function swirl(strength: number, color: THREE.Vector3) {
    const n = 8
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2
      const r = 0.2
      const x = 0.5 + (Math.cos(a) * r) / camera.aspect
      const y = 0.5 + Math.sin(a) * r
      const k = 0.02
      fluid.splat(x, y, (-Math.sin(a) * strength) / camera.aspect, Math.cos(a) * strength, [color.x * k, color.y * k, color.z * k], 0.08)
    }
  }

  // --- Projects: picking, transition, routing ---------------------------------------------------

  const trans = new TransitionState()
  const routeIndex = (route: Route) => (route.name === "project" ? projects.indexOf(route.project) : -1)
  let active = routeIndex(router.route) // card carried by the transition
  let tValue = active >= 0 ? PANEL_SWAP : 0 // a direct visit starts with the panel forming
  let tTarget = active >= 0 ? 1 : 0
  let pendingSwap = -1 // project to switch to once the current panel has dissolved
  let pendingScroll: "cards" | "contact" | null = null
  const slot: Pose = { position: new THREE.Vector3(), quaternion: new THREE.Quaternion(), scale: 1 }
  const pose = { position: new THREE.Vector3(), quaternion: new THREE.Quaternion(), scale: 1, opacity: 1 }
  const full = new THREE.Vector3()
  const panelPx = { x: 0, y: 0, w: 1 } // panel rect centre and width in CSS px (from the HTML)
  const panelTilt = new THREE.Quaternion()
  const tmpQ = new THREE.Quaternion()
  const tmpE = new THREE.Euler()
  const accentColor = new THREE.Vector3()
  const accentTarget = new THREE.Vector3()
  const pointerNdc = { x: 0, y: 0 }
  let hovered = -1
  let lastHovered = -1

  if (active >= 0) {
    input.seek(progressForCard(active))
    input.scrollLocked = true
    accentColor.copy(linear(projects[active].accent))
  }

  scrollTarget = target => {
    if (router.route.name === "project") {
      pendingScroll = target
      router.go({ name: "home" })
    } else input.scrollTo(target === "contact" ? 1 : progressForCard(0) - 0.012)
  }

  function measurePanel() {
    const media = overlay.projectElement?.querySelector<HTMLElement>(".project-media")
    if (!media) return
    const r = media.getBoundingClientRect()
    panelPx.x = r.left + r.width / 2
    panelPx.y = r.top + r.height / 2
    panelPx.w = r.width
  }

  router.onChange((route, from) => {
    const next = routeIndex(route)
    if (route.name === "project") {
      input.scrollLocked = true
      if (from.name === "project" && active >= 0) {
        // Project to project: dissolve the current panel, then form the next one.
        pendingSwap = next
        tTarget = PANEL_SWAP
      } else {
        active = next
        overlay.showProject(route)
        texts.rebuild()
        measurePanel()
        tTarget = 1
      }
    } else {
      overlay.updateHead(route)
      tTarget = 0
    }
  })

  canvas.addEventListener("click", () => {
    if (hovered >= 0 && router.route.name === "home") router.go({ name: "project", project: projects[hovered] })
  })
  window.addEventListener("keydown", e => {
    if (e.key === "Escape" && router.route.name === "project") router.go({ name: "home" })
  })

  // Moves the transition along and places the travelling card.
  function stepTransition(dt: number) {
    const before = tValue
    const speed = 1 / DURATION
    tValue = tValue < tTarget ? Math.min(tTarget, tValue + speed * dt) : Math.max(tTarget, tValue - speed * dt)

    // Project switch: the old panel is gone, bring in the next project.
    if (pendingSwap >= 0 && tValue <= PANEL_SWAP) {
      cards.setOverride(active, null)
      cards.uniforms(active).uDissolve.value = 0
      cards.uniforms(active).uReveal.value = 0
      active = pendingSwap
      pendingSwap = -1
      const route = router.route
      if (route.name === "project") overlay.showProject(route)
      texts.rebuild()
      measurePanel()
      input.seek(progressForCard(active))
      tTarget = 1
    }

    // While home is hidden, move the flight to this project's card: closing returns there.
    if (active >= 0 && before < PANEL_SWAP && tValue >= PANEL_SWAP) input.seek(progressForCard(active))

    // Swirl the liquid as the card bursts (both directions).
    if (active >= 0 && ((before < 0.32 && tValue >= 0.32) || (before > 0.62 && tValue <= 0.62))) {
      swirl(before < tValue ? 1.6 : -1.6, linear(projects[active].accent))
    }

    evaluateTransition(tValue, trans)

    if (active < 0) return
    if (tValue <= 0 && tTarget === 0) {
      // Back home: hand the card back to its slot.
      cards.setOverride(active, null)
      cards.uniforms(active).uDissolve.value = 0
      cards.uniforms(active).uReveal.value = 0
      active = -1
      input.scrollLocked = false
      if (pendingScroll) {
        const target = pendingScroll
        pendingScroll = null
        scrollTarget(target)
      }
      return
    }

    if (!trans.atPanel) {
      // From the slot towards the camera until the card covers the screen.
      cards.restPose(active, time, pointerNdc, slot)
      const tan = Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2)
      const d = Math.min(1 / (2 * tan), 1.6 / (2 * tan * camera.aspect)) * 0.95
      full.set(0, 0, -d).applyQuaternion(camera.quaternion).add(camera.position)
      pose.position.lerpVectors(slot.position, full, trans.fly)
      pose.quaternion.slerpQuaternions(slot.quaternion, camera.quaternion, trans.fly)
      pose.scale = THREE.MathUtils.lerp(slot.scale, 1, trans.fly)
    } else {
      // The panel: where the HTML layout reserves the media box, tilted a little, floating.
      const k = (2 * PANEL_DISTANCE * Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2)) / height
      pose.position.set((panelPx.x - width / 2) * k, (height / 2 - panelPx.y) * k + Math.sin(time * 0.6) * 0.03, -PANEL_DISTANCE)
      pose.position.applyQuaternion(camera.quaternion).add(camera.position)
      tmpE.set(-0.05 + Math.sin(time * 0.4) * 0.02 - pointerNdc.y * 0.06, 0.16 + Math.sin(time * 0.33) * 0.03 + pointerNdc.x * 0.08, 0)
      panelTilt.setFromEuler(tmpE)
      pose.quaternion.copy(tmpQ.copy(camera.quaternion).multiply(panelTilt))
      pose.scale = (panelPx.w * k) / 1.6
    }
    pose.opacity = 1
    cards.setOverride(active, pose)
    cards.uniforms(active).uDissolve.value = trans.dissolve
    cards.uniforms(active).uReveal.value = trans.atPanel ? trans.reveal : 0
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
    pointerNdc.x = input.lean.x
    pointerNdc.y = input.lean.y

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

    stepTransition(dt)
    const home = trans.homeAlpha

    // Hero sphere: the dive opens its hole.
    heroSphere.mesh.visible = st.heroSphereVisible && home > 0.01
    if (heroSphere.mesh.visible) {
      const u = heroSphere.uniforms
      u.uTime.value = time
      u.uHole.value = st.heroHole
      u.uAlpha.value = st.heroAlpha * home
      u.uDarken.value = st.heroDarken
      heroSphere.mesh.position.set(0, 0, 0)
      heroSphere.mesh.updateMatrixWorld()
      heroSphere.updateHoleCenter(camera)
    }

    // Finale sphere: closes in around the view, then settles lower left and follows the pointer.
    finaleSphere.mesh.visible = st.finaleSphereVisible && home > 0.01
    if (finaleSphere.mesh.visible) {
      const u = finaleSphere.uniforms
      u.uTime.value = time + 40
      u.uHole.value = st.finaleHole
      u.uAlpha.value = st.finaleAlpha * home
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
    travel += Math.max(-camDelta.z, 0) + dt * (0.35 + trans.pull * 3)
    bubbles.uniforms.uCamPos.value.copy(camBase)
    bubbles.uniforms.uTravel.value = travel
    bubbles.uniforms.uTime.value = time
    bubbles.uniforms.uOpacity.value = 1 - 0.6 * trans.accent

    // Hover: only at home, with the cards on screen and no transition running.
    const canPick = router.route.name === "home" && tValue === 0 && st.cardsAlpha > 0.5 && input.pointerInside
    hovered = canPick ? cards.pick(camera, input.ndc.x, input.ndc.y) : -1
    cards.hovered = hovered
    canvas.style.cursor = hovered >= 0 ? "pointer" : ""
    if (hovered >= 0 && hovered !== lastHovered) {
      // A soft ripple in the liquid where the card lights up.
      const p = cards.mesh(hovered).position.clone().project(camera)
      fluid.push(p.x * 0.5 + 0.5, p.y * 0.5 + 0.5, 0.35, 0.12)
    }
    lastHovered = hovered

    cards.update(time, dt, camera, camera.aspect, st.cardsAlpha * home, st.s, size, pointerNdc)

    stirFluid(dt)
    fluid.update(dt)
    particles.pull = trans.pull * (input.reducedMotion ? 0.3 : 1)
    particles.update(dt, time, camera, camDelta, size.y)

    // The project's accent colour floods the backdrop and the particles.
    if (active >= 0) accentTarget.copy(linear(projects[active].accent))
    accentColor.x = damp(accentColor.x, accentTarget.x, 3, dt)
    accentColor.y = damp(accentColor.y, accentTarget.y, 3, dt)
    accentColor.z = damp(accentColor.z, accentTarget.z, 3, dt)
    nebula.uniforms.uAccent.value.copy(accentColor)
    nebula.uniforms.uAccentMix.value = trans.accent * 0.9
    particles.renderU.uTint.value.copy(accentColor)
    particles.renderU.uTintMix.value = trans.accent * 0.7

    nebula.uniforms.uTime.value = time
    nebula.uniforms.uBrightness.value = THREE.MathUtils.lerp(st.nebula, 1, trans.accent)
    nebula.uniforms.uOffset.value.set(input.lean.x * 0.04 + camBase.x * 0.01, input.lean.y * 0.03 + camBase.y * 0.01)
    composite.uniforms.uTime.value = time
    composite.uniforms.uVortex.value = (st.vortex + trans.vortex) * (input.reducedMotion ? 0.3 : 1)
    composite.uniforms.uZoom.value = input.reducedMotion ? 0 : trans.zoom
    particles.renderU.uOpacity.value = 1 + 2.5 * trans.pull

    overlay.homeAlpha = home
    overlay.projectAlpha = trans.projectAlpha
    overlay.update(st)
    texts.update()
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

  resize()
  const startP = Number(params.get("p"))
  if (startP > 0 && active < 0) input.seek(startP)
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
        router,
        camera,
        cards,
        // Screen position (CSS px) of card i's centre, for pointer tests.
        cardScreen: (i: number) => {
          const v = cards.mesh(i).position.clone().project(camera)
          return { x: (v.x * 0.5 + 0.5) * width, y: (0.5 - v.y * 0.5) * height }
        },
        probe: new TextureProbe(renderer),
        seek: (p: number) => input.seek(p),
        pause: (value = true) => {
          paused = value
        },
        // Jump the project transition to t (0..1) without animating.
        transition: (t: number) => {
          tValue = tTarget = t
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
