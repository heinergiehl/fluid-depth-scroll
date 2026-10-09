import * as THREE from "three"
import { FullscreenPass, passMaterial } from "../gl/targets"
import { PALETTE, linear, noiseGLSL } from "../gl/glsl"

// GPGPU particles: glowing dots that come out of the depth. State lives in two float textures
// (MRT, ping-pong): A = position.xyz + life, B = velocity.xyz + seed. Positions are relative to
// the camera, so the field always surrounds it; camera motion is subtracted each step, which
// makes them stream past faster while scrolling. The fluid pushes them at their screen position.

const NEAR = -0.6 // respawn once a particle passes this (camera-relative z)
const DEPTH = 42 // spawn depth in front of the camera

const stepShader = /* glsl */ `
  in vec2 vUv;
  layout(location = 0) out vec4 outPos;
  layout(location = 1) out vec4 outVel;
  uniform sampler2D uPos;
  uniform sampler2D uVel;
  uniform sampler2D uFluid;
  uniform float uInit;
  uniform float uDt;
  uniform float uTime;
  uniform float uDrift;
  uniform vec3 uCamDelta;
  uniform mat4 uViewProj;
  uniform float uTanHalf;
  uniform float uAspect;
  uniform float uFluidGain;
  uniform float uPull; // 0..1: a vortex around the view axis sucks particles in (project transition)
  ${noiseGLSL}

  // Hashes take the texel coordinate (integers): hashing the continuous seed correlates
  // particles with similar seeds and lines them up in rows.
  vec3 spawn(float depthMin, float depthMax, float salt) {
    vec2 id = gl_FragCoord.xy;
    float h1 = hash12(id + salt * vec2(17.31, 5.93));
    float h2 = hash12(id * 1.37 + salt * vec2(3.17, 11.7) + 911.0);
    float h3 = hash12(id * 0.71 + salt * vec2(7.73, 2.39) + 1733.0);
    float z = -mix(depthMin, depthMax, h1);
    float halfH = -z * uTanHalf * 1.25 + 0.6;
    return vec3((h2 * 2.0 - 1.0) * halfH * uAspect, (h3 * 2.0 - 1.0) * halfH, z);
  }

  // Divergence-free-ish swirl from noise gradients (finite differences).
  vec3 curl(vec3 p) {
    const float e = 0.1;
    float n1 = noise3(p + vec3(0.0, e, 0.0)), n2 = noise3(p - vec3(0.0, e, 0.0));
    float n3 = noise3(p + vec3(0.0, 0.0, e)), n4 = noise3(p - vec3(0.0, 0.0, e));
    float n5 = noise3(p + vec3(e, 0.0, 0.0)), n6 = noise3(p - vec3(e, 0.0, 0.0));
    vec3 q = p + 19.1;
    float m1 = noise3(q + vec3(0.0, e, 0.0)), m2 = noise3(q - vec3(0.0, e, 0.0));
    float m3 = noise3(q + vec3(0.0, 0.0, e)), m4 = noise3(q - vec3(0.0, 0.0, e));
    float m5 = noise3(q + vec3(e, 0.0, 0.0)), m6 = noise3(q - vec3(e, 0.0, 0.0));
    return vec3((n1 - n2) - (m3 - m4), (n3 - n4) - (m5 - m6), (m1 - m2) - (n5 - n6)) / (2.0 * e);
  }

  void main() {
    vec4 P = texture(uPos, vUv);
    vec4 V = texture(uVel, vUv);
    float seed = V.w;

    float lifetime = mix(7.0, 16.0, fract(seed * 7.13));
    if (uInit > 0.5) {
      // Start in the steady state: spawned deep, then drifted for a random part of the life.
      // (A uniform fill would put far too many big, near particles on the first screen.)
      seed = hash12(gl_FragCoord.xy + 0.37);
      lifetime = mix(7.0, 16.0, fract(seed * 7.13));
      float age = hash12(gl_FragCoord.xy * 1.91 + 57.0);
      vec3 p0 = spawn(DEPTH * 0.7, DEPTH, 3.1);
      p0.z += uDrift * mix(0.6, 1.4, fract(seed * 3.7)) * age * lifetime;
      outPos = vec4(p0, age);
      outVel = vec4(0.0, 0.0, uDrift, seed);
      return;
    }

    float life = P.w + uDt / lifetime;
    vec3 pos = P.xyz - uCamDelta;

    vec3 swirl = curl(pos * 0.18 + vec3(0.0, 0.0, uTime * 0.04)) * 0.18;
    vec3 target = swirl + vec3(0.0, 0.0, uDrift * mix(0.6, 1.4, fract(seed * 3.7)));
    // Vortex pull: swirl around the view axis and towards it, faster the closer they are.
    if (uPull > 0.0) {
      vec2 r = pos.xy;
      float d = length(r) + 0.3;
      vec2 tangent = vec2(-r.y, r.x) / d;
      target.xy += (tangent * 6.0 - r / d * 3.5) * uPull;
      target.z += 4.0 * uPull;
    }
    vec3 vel = mix(V.xyz, target, 1.0 - exp(-uDt * (1.5 + 3.0 * uPull)));
    pos += vel * uDt;

    // The liquid carries them: fluid velocity (uv/s) at the projected position -> world units.
    vec4 clip = uViewProj * vec4(pos, 1.0);
    if (clip.w > 0.05) {
      vec2 suv = clip.xy / clip.w * 0.5 + 0.5;
      if (all(greaterThan(suv, vec2(0.0))) && all(lessThan(suv, vec2(1.0)))) {
        vec2 fv = texture(uFluid, suv).xy;
        float perUv = 2.0 * clip.w * uTanHalf;
        pos.xy += fv * perUv * vec2(uAspect, 1.0) * uDt * uFluidGain;
      }
    }

    float halfH = -pos.z * uTanHalf * 1.4 + 1.5;
    bool outside = abs(pos.x) > halfH * uAspect || abs(pos.y) > halfH || pos.z < FAR_LIMIT;
    if (life >= 1.0 || pos.z > NEAR_LIMIT || outside) {
      // Respawn deep, with a fresh random position each time.
      pos = spawn(DEPTH * 0.7, DEPTH, fract(uTime * 0.731) * 97.0);
      life = 0.0;
      vel = vec3(0.0, 0.0, uDrift);
    }
    outPos = vec4(pos, life);
    outVel = vec4(vel, seed);
  }
`
  .replaceAll("DEPTH", DEPTH.toFixed(1))
  .replaceAll("FAR_LIMIT", (-DEPTH - 4).toFixed(1))
  .replaceAll("NEAR_LIMIT", NEAR.toFixed(1))

const renderVertex = /* glsl */ `
  precision highp float;
  precision highp sampler2D;
  in vec2 ref;
  uniform sampler2D uPos;
  uniform sampler2D uVel;
  uniform mat4 modelViewMatrix;
  uniform mat4 projectionMatrix;
  uniform float uTime;
  uniform float uPixelHeight; // drawing buffer height in px
  uniform float uTanHalf;
  uniform float uOpacity;
  uniform vec3 uWhite;
  uniform vec3 uCyan;
  uniform vec3 uViolet;
  uniform vec3 uTint;
  uniform float uTintMix;
  out vec3 vColor;
  out float vCore;
  ${noiseGLSL}

  void main() {
    vec4 P = texture(uPos, ref);
    // Independent per-particle randoms from the texel id (see spawn() in the step shader).
    vec2 id = floor(ref * 4096.0);
    float r1 = hash12(id + 1.7), r2 = hash12(id + 23.1), r3 = hash12(id + 41.9);
    float r4 = hash12(id + 67.3), r5 = hash12(id + 89.5), r6 = hash12(id + 7.9);
    vec4 mv = modelViewMatrix * vec4(P.xyz, 1.0);
    gl_Position = projectionMatrix * mv;
    float depth = max(-mv.z, 0.1);

    // Size: mostly fine dust, a few big bright ones.
    float big = step(0.965, r1);
    float worldSize = mix(0.03, 0.065, r2) + big * 0.07;
    float px = worldSize / (2.0 * depth * uTanHalf) * uPixelHeight;
    gl_PointSize = clamp(px, 1.5, 64.0);

    float life = P.w;
    float fade = smoothstep(0.0, 0.15, life) * (1.0 - smoothstep(0.6, 1.0, life));
    float depthFade = smoothstep(42.0, 26.0, depth) * smoothstep(0.6, 2.0, depth);
    float twinkle = 0.65 + 0.35 * sin(uTime * mix(1.5, 4.0, r3) + r6 * 60.0);
    float bright = mix(0.12, 0.6, r4) * mix(1.0, 2.6, big);
    // Points smaller than ~2px would alias; trade size for brightness instead.
    float sub = clamp(px / 1.5, 0.0, 1.0);

    float pick = r5;
    vec3 col = pick < 0.5 ? uWhite : pick < 0.78 ? uCyan : uViolet;
    col = mix(col, uTint * (0.8 + 0.6 * r6), uTintMix * step(0.35, pick));
    vColor = col * fade * depthFade * twinkle * bright * sub * sub * uOpacity;
    vCore = mix(18.0, 30.0, big);
  }
`

const renderFragment = /* glsl */ `
  precision highp float;
  in vec3 vColor;
  in float vCore;
  out vec4 fragColor;
  void main() {
    vec2 d = gl_PointCoord * 2.0 - 1.0;
    float r2 = dot(d, d);
    if (r2 > 1.0) discard;
    float core = exp(-r2 * vCore);
    float halo = exp(-r2 * 4.0) * 0.28;
    fragColor = vec4(vColor * (core * 1.6 + halo) * (1.0 - r2), 1.0);
  }
`

export interface ParticleOptions {
  size?: number // state texture side; count = size^2
}

export class Particles {
  readonly points: THREE.Points
  private readonly renderer: THREE.WebGLRenderer
  private readonly pass: FullscreenPass
  private read: THREE.WebGLRenderTarget
  private write: THREE.WebGLRenderTarget
  private initialised = false

  private readonly stepU = {
    uPos: { value: null as THREE.Texture | null },
    uVel: { value: null as THREE.Texture | null },
    uFluid: { value: null as THREE.Texture | null },
    uInit: { value: 0 },
    uDt: { value: 0 },
    uTime: { value: 0 },
    uDrift: { value: 0.7 },
    uCamDelta: { value: new THREE.Vector3() },
    uViewProj: { value: new THREE.Matrix4() },
    uTanHalf: { value: 0.3 },
    uAspect: { value: 1 },
    uFluidGain: { value: 0.6 },
    uPull: { value: 0 },
  }
  private readonly stepMat: THREE.RawShaderMaterial

  readonly renderU = {
    uPos: { value: null as THREE.Texture | null },
    uVel: { value: null as THREE.Texture | null },
    uTime: { value: 0 },
    uPixelHeight: { value: 1 },
    uTanHalf: { value: 0.3 },
    uOpacity: { value: 1 },
    uWhite: { value: linear(PALETTE.white).multiplyScalar(1.4) },
    uCyan: { value: linear(PALETTE.cyan).multiplyScalar(1.2) },
    uViolet: { value: linear(PALETTE.lavender) },
    uTint: { value: linear(PALETTE.cyan) },
    uTintMix: { value: 0 },
  }

  constructor(renderer: THREE.WebGLRenderer, fluidVelocity: THREE.Texture, options: ParticleOptions = {}) {
    this.renderer = renderer
    this.pass = new FullscreenPass(renderer)
    const size = options.size ?? 128

    // Float state: half floats cannot resolve per-frame drift at z ~ 40.
    const canFloat = renderer.extensions.has("EXT_color_buffer_float")
    const make = () => {
      const t = new THREE.WebGLRenderTarget(size, size, {
        count: 2,
        type: canFloat ? THREE.FloatType : THREE.HalfFloatType,
        format: THREE.RGBAFormat,
        minFilter: THREE.NearestFilter,
        magFilter: THREE.NearestFilter,
        depthBuffer: false,
        stencilBuffer: false,
        generateMipmaps: false,
      })
      for (const tex of t.textures) tex.colorSpace = THREE.NoColorSpace
      return t
    }
    this.read = make()
    this.write = make()

    this.stepU.uFluid.value = fluidVelocity
    this.stepMat = passMaterial(stepShader, this.stepU)

    const count = size * size
    const refs = new Float32Array(count * 2)
    for (let i = 0; i < count; i++) {
      refs[i * 2] = ((i % size) + 0.5) / size
      refs[i * 2 + 1] = (Math.floor(i / size) + 0.5) / size
    }
    const geometry = new THREE.BufferGeometry()
    geometry.setAttribute("ref", new THREE.BufferAttribute(refs, 2))
    // Positions come from the texture; a dummy attribute keeps three's draw call happy.
    geometry.setAttribute("position", new THREE.BufferAttribute(new Float32Array(count * 3), 3))
    geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e6)

    const material = new THREE.RawShaderMaterial({
      glslVersion: THREE.GLSL3,
      vertexShader: renderVertex,
      fragmentShader: renderFragment,
      uniforms: this.renderU,
      transparent: true,
      depthWrite: false,
      depthTest: true,
      blending: THREE.AdditiveBlending,
    })
    this.points = new THREE.Points(geometry, material)
    this.points.frustumCulled = false
    this.points.renderOrder = 10
  }

  // camera: the scene camera (its matrices must be current). camDelta: world motion since the
  // last step. The Points object is moved onto the camera so state stays camera-relative.
  // Vortex pull strength 0..1 (project transition).
  set pull(value: number) {
    this.stepU.uPull.value = value
  }

  update(dt: number, time: number, camera: THREE.PerspectiveCamera, camDelta: THREE.Vector3, pixelHeight: number) {
    const u = this.stepU
    u.uDt.value = Math.min(dt, 1 / 20)
    u.uTime.value = time
    u.uCamDelta.value.copy(camDelta)
    u.uTanHalf.value = Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2)
    u.uAspect.value = camera.aspect

    // Camera-relative position -> clip: projection * view * translate(camera position).
    this.points.position.copy(camera.position)
    this.points.updateMatrixWorld()
    u.uViewProj.value.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse).multiply(this.points.matrixWorld)

    const prevTarget = this.renderer.getRenderTarget()
    u.uInit.value = this.initialised ? 0 : 1
    this.initialised = true
    u.uPos.value = this.read.textures[0]
    u.uVel.value = this.read.textures[1]
    this.stepMat.uniformsNeedUpdate = true
    this.pass.render(this.stepMat, this.write)
    this.renderer.setRenderTarget(prevTarget)
    const t = this.read
    this.read = this.write
    this.write = t

    const r = this.renderU
    r.uPos.value = this.read.textures[0]
    r.uVel.value = this.read.textures[1]
    r.uTime.value = time
    r.uPixelHeight.value = pixelHeight
    r.uTanHalf.value = u.uTanHalf.value
  }

  // Dev: the current state textures (position + life, velocity + seed).
  get state() {
    return this.read.textures
  }

  dispose() {
    this.read.dispose()
    this.write.dispose()
    this.stepMat.dispose()
    this.points.geometry.dispose()
    ;(this.points.material as THREE.Material).dispose()
  }
}
