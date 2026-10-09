import * as THREE from "three"
import { FullscreenPass, PingPong, createTarget, passMaterial } from "../gl/targets"

// Screen-space stable fluids (after Pavel Dobryakov's WebGL Fluid Simulation), working in screen uv.
//
// Units: the velocity texture stores uv units per second, one component per axis (x in uv of the
// width, y in uv of the height). That makes advection trivial (`vUv - dt * vel`) and lets other
// shaders sample velocity at a screen position without knowing the aspect ratio.
// The pressure projection needs isotropic units, so the solver passes convert to "physical" velocity
// (screen heights per second: x scaled by aspect) and back. Grids have square cells, so the
// projection is dt-independent and the texel size cancels out of every finite difference.

const MAX_SPLATS = 32 // queue length per frame; extras are dropped
const MAX_DT = 1 / 30 // semi-Lagrangian is stable anyway, but vorticity force is not
const MAX_VELOCITY = 8 // screen heights per second; keeps vorticity from running away
const MIN_ASPECT = 0.25 // keeps grid sizes sane on absurd window shapes
const MAX_ASPECT = 4

const KIND_SPLAT = 0
const KIND_PUSH = 1
const FIELDS = 8 // per queue entry: x, y, dx, dy, r, g, b, radius

export interface FluidOptions {
  simResolution?: number // short side of the velocity grid
  dyeResolution?: number // short side of the dye grid
  curl?: number // vorticity confinement strength
  curlThreshold?: number // curl (grid units) below which eddies are left to decay
  pressureIterations?: number
  pressureDecay?: number // pressure carried between frames
  velocityDissipation?: number // per-second decay rate
  dyeDissipation?: number // per-second decay rate
}

// ---------------------------------------------------------------------------------------------
// Shaders. vUv comes from the shared vertex stage; every pass writes the whole target.
// ---------------------------------------------------------------------------------------------

const header = /* glsl */ `
  in vec2 vUv;
  out vec4 fragColor;
`

const copyShader = header + /* glsl */ `
  uniform sampler2D uSource;
  void main() { fragColor = texture(uSource, vUv); }
`

// Gaussian blob, aspect-corrected so it is round on screen. Used for velocity and dye alike.
const splatShader = header + /* glsl */ `
  uniform sampler2D uTarget;
  uniform vec2 uPoint;
  uniform vec3 uValue;
  uniform float uRadius;
  uniform float uAspect;
  void main() {
    vec2 p = vUv - uPoint;
    p.x *= uAspect;
    float g = exp(-dot(p, p) / (uRadius * uRadius));
    vec4 base = texture(uTarget, vUv);
    fragColor = vec4(base.xyz + uValue * g, 1.0);
  }
`

// Outward push: zero at the centre, peaks at uRadius with value uStrength, gaussian tail.
// Direction is isotropic on screen, so x is divided by aspect to get uv/s.
const pushShader = header + /* glsl */ `
  uniform sampler2D uTarget;
  uniform vec2 uPoint;
  uniform float uStrength;
  uniform float uRadius;
  uniform float uAspect;
  void main() {
    vec2 p = vUv - uPoint;
    p.x *= uAspect;
    float r = length(p);
    float t = r / uRadius;
    float f = t * exp(0.5 * (1.0 - t * t));
    vec2 dir = p / max(r, 1e-5);
    vec4 base = texture(uTarget, vUv);
    fragColor = vec4(base.xy + dir * f * uStrength / vec2(uAspect, 1.0), base.zw);
  }
`

// Scalar curl of the velocity field, in grid units (texel size cancels).
const curlShader = header + /* glsl */ `
  uniform sampler2D uVelocity;
  uniform vec2 uTexel;
  uniform float uAspect;
  void main() {
    vec2 s = vec2(uAspect, 1.0);
    float L = texture(uVelocity, vUv - vec2(uTexel.x, 0.0)).y * s.y;
    float R = texture(uVelocity, vUv + vec2(uTexel.x, 0.0)).y * s.y;
    float B = texture(uVelocity, vUv - vec2(0.0, uTexel.y)).x * s.x;
    float T = texture(uVelocity, vUv + vec2(0.0, uTexel.y)).x * s.x;
    fragColor = vec4(0.5 * ((R - L) - (T - B)), 0.0, 0.0, 1.0);
  }
`

// Pushes the flow along the gradient of |curl| so small eddies are not smoothed away.
// With velocity in screen heights per second this has the same numbers as the reference demo.
// Only curl above uThreshold is confined: unthresholded confinement feeds grid-scale noise faster
// than dissipation removes it, and the field never comes to rest (measured: ~0.1 uv/s forever).
// Velocity is clamped in physical units (heights/s), so the limit is isotropic.
const vorticityShader = header + /* glsl */ `
  uniform sampler2D uVelocity;
  uniform sampler2D uCurl;
  uniform vec2 uTexel;
  uniform float uAspect;
  uniform float uStrength;
  uniform float uThreshold;
  uniform float uDt;
  uniform float uMax;
  void main() {
    float L = texture(uCurl, vUv - vec2(uTexel.x, 0.0)).x;
    float R = texture(uCurl, vUv + vec2(uTexel.x, 0.0)).x;
    float B = texture(uCurl, vUv - vec2(0.0, uTexel.y)).x;
    float T = texture(uCurl, vUv + vec2(0.0, uTexel.y)).x;
    float C = texture(uCurl, vUv).x;
    vec2 force = 0.5 * vec2(abs(T) - abs(B), abs(R) - abs(L));
    force /= length(force) + 1e-4;
    force *= uStrength * sign(C) * max(abs(C) - uThreshold, 0.0);
    force.y *= -1.0;
    vec2 s = vec2(uAspect, 1.0);
    vec2 vel = texture(uVelocity, vUv).xy * s + force * uDt;
    fragColor = vec4(clamp(vel, -uMax, uMax) / s, 0.0, 1.0);
  }
`

// Divergence of the physical velocity. At the screen edge the outside neighbour mirrors the
// centre value with flipped sign, so the normal velocity is driven to zero there (walls).
const divergenceShader = header + /* glsl */ `
  uniform sampler2D uVelocity;
  uniform vec2 uTexel;
  uniform float uAspect;
  void main() {
    vec2 s = vec2(uAspect, 1.0);
    vec2 C = texture(uVelocity, vUv).xy * s;
    float L = texture(uVelocity, vUv - vec2(uTexel.x, 0.0)).x * s.x;
    float R = texture(uVelocity, vUv + vec2(uTexel.x, 0.0)).x * s.x;
    float B = texture(uVelocity, vUv - vec2(0.0, uTexel.y)).y;
    float T = texture(uVelocity, vUv + vec2(0.0, uTexel.y)).y;
    if (vUv.x - uTexel.x < 0.0) L = -C.x;
    if (vUv.x + uTexel.x > 1.0) R = -C.x;
    if (vUv.y - uTexel.y < 0.0) B = -C.y;
    if (vUv.y + uTexel.y > 1.0) T = -C.y;
    fragColor = vec4(0.5 * (R - L + T - B), 0.0, 0.0, 1.0);
  }
`

// Carry pressure over from the previous frame (a warm start for Jacobi), damped.
const clearShader = header + /* glsl */ `
  uniform sampler2D uPressure;
  uniform float uValue;
  void main() { fragColor = vec4(uValue * texture(uPressure, vUv).x, 0.0, 0.0, 1.0); }
`

// One Jacobi relaxation of laplacian(p) = divergence. Clamped sampling gives dp/dn = 0 at edges.
const jacobiShader = header + /* glsl */ `
  uniform sampler2D uPressure;
  uniform sampler2D uDivergence;
  uniform vec2 uTexel;
  void main() {
    float L = texture(uPressure, vUv - vec2(uTexel.x, 0.0)).x;
    float R = texture(uPressure, vUv + vec2(uTexel.x, 0.0)).x;
    float B = texture(uPressure, vUv - vec2(0.0, uTexel.y)).x;
    float T = texture(uPressure, vUv + vec2(0.0, uTexel.y)).x;
    float d = texture(uDivergence, vUv).x;
    fragColor = vec4((L + R + B + T - d) * 0.25, 0.0, 0.0, 1.0);
  }
`

// Subtract the pressure gradient (in physical axes), then convert back to uv/s.
const gradientShader = header + /* glsl */ `
  uniform sampler2D uPressure;
  uniform sampler2D uVelocity;
  uniform vec2 uTexel;
  uniform float uAspect;
  void main() {
    float L = texture(uPressure, vUv - vec2(uTexel.x, 0.0)).x;
    float R = texture(uPressure, vUv + vec2(uTexel.x, 0.0)).x;
    float B = texture(uPressure, vUv - vec2(0.0, uTexel.y)).x;
    float T = texture(uPressure, vUv + vec2(0.0, uTexel.y)).x;
    vec2 vel = texture(uVelocity, vUv).xy - 0.5 * vec2(R - L, T - B) / vec2(uAspect, 1.0);
    fragColor = vec4(vel, 0.0, 1.0);
  }
`

// Semi-Lagrangian advection. Velocity is in uv/s per axis, so the backtrace is plain uv math and
// the same pass serves velocity and dye (grids of different resolution share the same uv).
const advectionShader = header + /* glsl */ `
  uniform sampler2D uVelocity;
  uniform sampler2D uSource;
  uniform float uDt;
  uniform float uDecay;
  void main() {
    vec2 coord = vUv - uDt * texture(uVelocity, vUv).xy;
    fragColor = vec4(texture(uSource, coord).xyz * uDecay, 1.0);
  }
`

// ---------------------------------------------------------------------------------------------

let warnedNoFloat = false

export class FluidSim {
  private readonly renderer: THREE.WebGLRenderer
  private readonly pass: FullscreenPass

  private readonly velocityPP: PingPong
  private readonly dyePP: PingPong
  private readonly pressurePP: PingPong
  private readonly divergenceRT: THREE.WebGLRenderTarget
  private readonly curlRT: THREE.WebGLRenderTarget

  // The ping-pong "read" side that update() leaves the result in, so the getters always return
  // the same texture objects and the integrator can bind them once.
  private readonly velocityHome: THREE.WebGLRenderTarget
  private readonly dyeHome: THREE.WebGLRenderTarget

  private readonly simResolution: number
  private readonly dyeResolution: number
  private readonly curl: number
  private readonly curlThreshold: number
  private readonly pressureIterations: number
  private readonly pressureDecay: number
  private readonly velocityDissipation: number
  private readonly dyeDissipation: number

  private simW = 0
  private simH = 0
  private dyeW = 0
  private dyeH = 0

  // Uniform objects shared between materials so a resize only touches one place.
  private readonly uAspect = { value: 1 }
  private readonly uTexel = { value: new THREE.Vector2(1, 1) }

  // Materials and the uniforms that change per pass.
  private readonly copyMat: THREE.RawShaderMaterial
  private readonly copyU = { uSource: { value: null as THREE.Texture | null } }
  private readonly splatMat: THREE.RawShaderMaterial
  private readonly splatU = {
    uTarget: { value: null as THREE.Texture | null },
    uPoint: { value: new THREE.Vector2() },
    uValue: { value: new THREE.Vector3() },
    uRadius: { value: 0.035 },
    uAspect: this.uAspect,
  }
  private readonly pushMat: THREE.RawShaderMaterial
  private readonly pushU = {
    uTarget: { value: null as THREE.Texture | null },
    uPoint: { value: new THREE.Vector2() },
    uStrength: { value: 0 },
    uRadius: { value: 0.1 },
    uAspect: this.uAspect,
  }
  private readonly curlMat: THREE.RawShaderMaterial
  private readonly curlU = {
    uVelocity: { value: null as THREE.Texture | null },
    uTexel: this.uTexel,
    uAspect: this.uAspect,
  }
  private readonly vorticityMat: THREE.RawShaderMaterial
  private readonly vorticityU = {
    uVelocity: { value: null as THREE.Texture | null },
    uCurl: { value: null as THREE.Texture | null },
    uTexel: this.uTexel,
    uAspect: this.uAspect,
    uStrength: { value: 0 },
    uThreshold: { value: 0 },
    uDt: { value: 0 },
    uMax: { value: MAX_VELOCITY },
  }
  private readonly divergenceMat: THREE.RawShaderMaterial
  private readonly divergenceU = {
    uVelocity: { value: null as THREE.Texture | null },
    uTexel: this.uTexel,
    uAspect: this.uAspect,
  }
  private readonly clearMat: THREE.RawShaderMaterial
  private readonly clearU = {
    uPressure: { value: null as THREE.Texture | null },
    uValue: { value: 0.8 },
  }
  private readonly jacobiMat: THREE.RawShaderMaterial
  private readonly jacobiU = {
    uPressure: { value: null as THREE.Texture | null },
    uDivergence: { value: null as THREE.Texture | null },
    uTexel: this.uTexel,
  }
  private readonly gradientMat: THREE.RawShaderMaterial
  private readonly gradientU = {
    uPressure: { value: null as THREE.Texture | null },
    uVelocity: { value: null as THREE.Texture | null },
    uTexel: this.uTexel,
    uAspect: this.uAspect,
  }
  private readonly advectionMat: THREE.RawShaderMaterial
  private readonly advectionU = {
    uVelocity: { value: null as THREE.Texture | null },
    uSource: { value: null as THREE.Texture | null },
    uDt: { value: 0 },
    uDecay: { value: 1 },
  }

  // Fixed splat queue, no allocation after construction.
  private readonly queueKind = new Uint8Array(MAX_SPLATS)
  private readonly queueData = new Float32Array(MAX_SPLATS * FIELDS)
  private queueLength = 0
  private readonly scratchColor = new THREE.Color()

  constructor(renderer: THREE.WebGLRenderer, options: FluidOptions = {}) {
    this.renderer = renderer
    this.pass = new FullscreenPass(renderer)

    this.simResolution = options.simResolution ?? 128
    this.dyeResolution = options.dyeResolution ?? 512
    this.curl = options.curl ?? 22
    this.curlThreshold = options.curlThreshold ?? 0.03
    this.pressureIterations = options.pressureIterations ?? 20
    this.pressureDecay = options.pressureDecay ?? 0.8
    this.velocityDissipation = options.velocityDissipation ?? 0.9
    this.dyeDissipation = options.dyeDissipation ?? 1.4

    if (!warnedNoFloat && !renderer.extensions.has("EXT_color_buffer_float") && !renderer.extensions.has("EXT_color_buffer_half_float")) {
      warnedNoFloat = true
      console.warn("FluidSim: float colour buffers are not supported, the simulation may not render")
    }

    // Targets start 1x1; resize() gives them their real, aspect-correct size.
    // Velocity and dye are sampled between texels, the rest is read at exact texel centres.
    this.velocityPP = new PingPong(1, 1, { filter: THREE.LinearFilter })
    this.dyePP = new PingPong(1, 1, { filter: THREE.LinearFilter })
    this.pressurePP = new PingPong(1, 1, { filter: THREE.NearestFilter })
    this.divergenceRT = createTarget(1, 1, { filter: THREE.NearestFilter })
    this.curlRT = createTarget(1, 1, { filter: THREE.NearestFilter })
    this.velocityHome = this.velocityPP.read
    this.dyeHome = this.dyePP.read

    this.copyMat = passMaterial(copyShader, this.copyU)
    this.splatMat = passMaterial(splatShader, this.splatU)
    this.pushMat = passMaterial(pushShader, this.pushU)
    this.curlMat = passMaterial(curlShader, this.curlU)
    this.vorticityMat = passMaterial(vorticityShader, this.vorticityU)
    this.divergenceMat = passMaterial(divergenceShader, this.divergenceU)
    this.clearMat = passMaterial(clearShader, this.clearU)
    this.jacobiMat = passMaterial(jacobiShader, this.jacobiU)
    this.gradientMat = passMaterial(gradientShader, this.gradientU)
    this.advectionMat = passMaterial(advectionShader, this.advectionU)

    this.clearU.uValue.value = this.pressureDecay
    this.vorticityU.uStrength.value = this.curl
    this.vorticityU.uThreshold.value = this.curlThreshold

    this.resize(1, 1)
  }

  // Grids follow the canvas aspect so cells stay square (otherwise swirls would look stretched).
  // Resizing to a new grid size clears the fluid; calling it with an unchanged size is free.
  resize(width: number, height: number) {
    const aspect = THREE.MathUtils.clamp(width / Math.max(height, 1), MIN_ASPECT, MAX_ASPECT)
    this.uAspect.value = aspect

    const simW = this.gridWidth(this.simResolution, aspect)
    const simH = this.gridHeight(this.simResolution, aspect)
    const dyeW = this.gridWidth(this.dyeResolution, aspect)
    const dyeH = this.gridHeight(this.dyeResolution, aspect)

    if (simW !== this.simW || simH !== this.simH) {
      this.simW = simW
      this.simH = simH
      this.velocityPP.setSize(simW, simH)
      this.pressurePP.setSize(simW, simH)
      this.divergenceRT.setSize(simW, simH)
      this.curlRT.setSize(simW, simH)
      this.uTexel.value.set(1 / simW, 1 / simH)
    }
    if (dyeW !== this.dyeW || dyeH !== this.dyeH) {
      this.dyeW = dyeW
      this.dyeH = dyeH
      this.dyePP.setSize(dyeW, dyeH)
    }
  }

  // Queue a splat, applied at the start of the next update(). x,y in uv with y up.
  // dx,dy in uv/s per axis. radius in uv of the height (gaussian, falls to 1/e at the radius).
  // Colour: hex/strings go through three's colour management (sRGB in, linear out);
  // a [r, g, b] array is taken as linear as is.
  splat(
    x: number,
    y: number,
    dx: number,
    dy: number,
    color: THREE.ColorRepresentation | [number, number, number],
    radius = 0.035,
  ) {
    if (this.queueLength >= MAX_SPLATS) return
    let r: number
    let g: number
    let b: number
    if (Array.isArray(color)) {
      r = color[0]
      g = color[1]
      b = color[2]
    } else {
      this.scratchColor.set(color)
      r = this.scratchColor.r
      g = this.scratchColor.g
      b = this.scratchColor.b
    }
    this.enqueue(KIND_SPLAT, x, y, dx, dy, r, g, b, radius)
  }

  // Radial outward push, as if flying into the liquid. `strength` is the speed in screen heights
  // per second at `radius` (uv of the height); it is zero at the centre and fades out beyond.
  push(x: number, y: number, strength: number, radius: number) {
    if (this.queueLength >= MAX_SPLATS) return
    this.enqueue(KIND_PUSH, x, y, strength, 0, 0, 0, 0, radius)
  }

  private enqueue(kind: number, x: number, y: number, a: number, b: number, r: number, g: number, bl: number, radius: number) {
    const i = this.queueLength++
    const o = i * FIELDS
    const d = this.queueData
    this.queueKind[i] = kind
    d[o] = x
    d[o + 1] = y
    d[o + 2] = a
    d[o + 3] = b
    d[o + 4] = r
    d[o + 5] = g
    d[o + 6] = bl
    d[o + 7] = radius
  }

  update(dt: number) {
    dt = Math.min(Math.max(dt, 0), MAX_DT)

    const renderer = this.renderer
    const prevTarget = renderer.getRenderTarget()
    const prevFace = renderer.getActiveCubeFace()
    const prevLevel = renderer.getActiveMipmapLevel()
    const prevAutoClear = renderer.autoClear
    renderer.autoClear = false // every pass overwrites its whole target

    this.applyQueue()

    const vel = this.velocityPP
    const pressure = this.pressurePP

    // Curl and vorticity confinement.
    this.curlU.uVelocity.value = vel.read.texture
    this.run(this.curlMat, this.curlRT)

    this.vorticityU.uVelocity.value = vel.read.texture
    this.vorticityU.uCurl.value = this.curlRT.texture
    this.vorticityU.uDt.value = dt
    this.run(this.vorticityMat, vel.write)
    vel.swap()

    // Projection: make the flow divergence free.
    this.divergenceU.uVelocity.value = vel.read.texture
    this.run(this.divergenceMat, this.divergenceRT)

    this.clearU.uPressure.value = pressure.read.texture
    this.run(this.clearMat, pressure.write)
    pressure.swap()

    this.jacobiU.uDivergence.value = this.divergenceRT.texture
    for (let i = 0; i < this.pressureIterations; i++) {
      this.jacobiU.uPressure.value = pressure.read.texture
      this.run(this.jacobiMat, pressure.write)
      pressure.swap()
    }

    this.gradientU.uPressure.value = pressure.read.texture
    this.gradientU.uVelocity.value = vel.read.texture
    this.run(this.gradientMat, vel.write)
    vel.swap()

    // Advect velocity through itself, then dye through the new velocity.
    this.advectionU.uDt.value = dt
    this.advectionU.uVelocity.value = vel.read.texture
    this.advectionU.uSource.value = vel.read.texture
    this.advectionU.uDecay.value = 1 / (1 + this.velocityDissipation * dt)
    this.run(this.advectionMat, vel.write)
    vel.swap()

    this.advectionU.uVelocity.value = vel.read.texture
    this.advectionU.uSource.value = this.dyePP.read.texture
    this.advectionU.uDecay.value = 1 / (1 + this.dyeDissipation * dt)
    this.run(this.advectionMat, this.dyePP.write)
    this.dyePP.swap()

    this.settle(this.velocityPP, this.velocityHome)
    this.settle(this.dyePP, this.dyeHome)

    renderer.autoClear = prevAutoClear
    renderer.setRenderTarget(prevTarget, prevFace, prevLevel)
  }

  // Velocity in uv/s per axis (RG), linear filtered. The texture object never changes.
  get velocity(): THREE.Texture {
    return this.velocityHome.texture
  }

  // Dye (RGB), linear filtered. The texture object never changes.
  get dye(): THREE.Texture {
    return this.dyeHome.texture
  }

  dispose() {
    this.velocityPP.dispose()
    this.dyePP.dispose()
    this.pressurePP.dispose()
    this.divergenceRT.dispose()
    this.curlRT.dispose()
    this.copyMat.dispose()
    this.splatMat.dispose()
    this.pushMat.dispose()
    this.curlMat.dispose()
    this.vorticityMat.dispose()
    this.divergenceMat.dispose()
    this.clearMat.dispose()
    this.jacobiMat.dispose()
    this.gradientMat.dispose()
    this.advectionMat.dispose()
  }

  private applyQueue() {
    const d = this.queueData
    const vel = this.velocityPP
    const dye = this.dyePP
    const splatU = this.splatU
    const pushU = this.pushU

    for (let i = 0; i < this.queueLength; i++) {
      const o = i * FIELDS
      if (this.queueKind[i] === KIND_PUSH) {
        pushU.uTarget.value = vel.read.texture
        pushU.uPoint.value.set(d[o], d[o + 1])
        pushU.uStrength.value = d[o + 2]
        pushU.uRadius.value = Math.max(d[o + 7], 1e-4)
        this.run(this.pushMat, vel.write)
        vel.swap()
        continue
      }

      const radius = Math.max(d[o + 7], 1e-4)
      splatU.uPoint.value.set(d[o], d[o + 1])
      splatU.uRadius.value = radius

      // Skip the pass entirely when a splat carries no velocity or no dye.
      if (d[o + 2] !== 0 || d[o + 3] !== 0) {
        splatU.uTarget.value = vel.read.texture
        splatU.uValue.value.set(d[o + 2], d[o + 3], 0)
        this.run(this.splatMat, vel.write)
        vel.swap()
      }
      if (d[o + 4] !== 0 || d[o + 5] !== 0 || d[o + 6] !== 0) {
        splatU.uTarget.value = dye.read.texture
        splatU.uValue.value.set(d[o + 4], d[o + 5], d[o + 6])
        this.run(this.splatMat, dye.write)
        dye.swap()
      }
    }
    this.queueLength = 0
  }

  // After the passes the result may sit in either half of the pair; copy it back to the home
  // target if needed so the public textures stay the same objects frame to frame.
  private settle(pair: PingPong, home: THREE.WebGLRenderTarget) {
    if (pair.read === home) return
    this.copyU.uSource.value = pair.read.texture
    this.run(this.copyMat, pair.write)
    pair.swap()
  }

  private run(material: THREE.RawShaderMaterial, target: THREE.WebGLRenderTarget) {
    material.uniformsNeedUpdate = true // same material is reused back to back with new values
    this.pass.render(material, target)
  }

  // Short side of the grid is `short`; the long side follows the aspect so cells are square.
  private gridWidth(short: number, aspect: number) {
    return aspect >= 1 ? Math.round(short * aspect) : short
  }

  private gridHeight(short: number, aspect: number) {
    return aspect >= 1 ? short : Math.round(short / aspect)
  }
}
