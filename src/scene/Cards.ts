import * as THREE from "three"
import { PALETTE, linear, noiseGLSL } from "../gl/glsl"
import { CARD_H, CARD_W, type Vec3, cardFade, cardPosition } from "../core/timeline"

// Project cards floating in depth. Each is a finely subdivided plane: the vertex shader bends it
// with the fluid velocity sampled at the vertex's screen position plus a slow idle wave; the
// fragment shader cuts the rounded rectangle (SDF), refracts and colour-splits the image where the
// liquid moves, tints everything towards indigo and draws a faint glow around it.
//
// Interaction: `uHover` lights a soft, breathing halo in the project's accent colour and a sheen;
// `uDissolve` burns the card away along a noisy, glowing edge (used by the project transition).
// A card's pose can be overridden (the transition carries it out of its slot).

const MARGIN = 0.34 // plane extends past the card for the glow and the halo (both reach 0 before its edge)
const RADIUS = 0.05

const vertex = /* glsl */ `
  precision highp float;
  precision highp sampler2D;
  in vec3 position;
  in vec2 uv;
  uniform mat4 modelMatrix;
  uniform mat4 viewMatrix;
  uniform mat4 projectionMatrix;
  uniform sampler2D uVelocity;
  uniform float uTime;
  uniform float uSeed;
  uniform float uTanHalf;
  uniform float uAspect;
  uniform float uWarp;
  out vec2 vUv;

  void main() {
    vUv = uv;
    vec4 world = modelMatrix * vec4(position, 1.0);
    vec3 normalW = normalize(mat3(modelMatrix) * vec3(0.0, 0.0, 1.0));
    float wave = sin(position.x * 2.1 + uTime * 0.7 + uSeed * 6.0) * 0.022
               + sin(position.y * 2.7 - uTime * 0.5 + uSeed * 3.0) * 0.014;
    world.xyz += normalW * wave;

    vec4 view = viewMatrix * world;
    vec4 clip = projectionMatrix * view;
    vec2 suv = clamp(clip.xy / clip.w * 0.5 + 0.5, 0.0, 1.0);
    vec2 vel = texture(uVelocity, suv).xy;
    // uv/s -> world offset at this depth; the liquid drags the surface and bulges it forward.
    float perUv = 2.0 * max(-view.z, 0.1) * uTanHalf;
    view.xy += vel * vec2(uAspect, 1.0) * perUv * 0.015 * uWarp;
    view.z += min(length(vel), 4.0) * 0.04 * uWarp;
    gl_Position = projectionMatrix * view;
  }
`

const fragment = /* glsl */ `
  precision highp float;
  precision highp sampler2D;
  in vec2 vUv;
  uniform sampler2D uMap;
  uniform sampler2D uVelocity;
  uniform sampler2D uDye;
  uniform vec2 uResolution;
  uniform vec2 uPlane; // plane size incl. margin
  uniform vec2 uCard; // card size
  uniform float uRadius;
  uniform float uOpacity;
  uniform float uFocus; // 1 for the focused card
  uniform float uHover; // 0..1
  uniform float uDissolve; // 0 = whole, 1 = gone
  uniform float uReveal; // 0 = indigo-tinted, 1 = closer to the real image (project view)
  uniform float uTime;
  uniform float uSeed;
  uniform vec2 uImageScale; // cover fit
  uniform vec3 uTint;
  uniform vec3 uGlow;
  uniform vec3 uAccent;
  uniform vec3 uRim;
  out vec4 fragColor;
  ${noiseGLSL}

  float sdRoundRect(vec2 p, vec2 b, float r) {
    vec2 q = abs(p) - b + r;
    return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - r;
  }

  void main() {
    vec2 p = (vUv - 0.5) * uPlane;
    float d = sdRoundRect(p, uCard * 0.5, uRadius);
    float aa = fwidth(d) * 0.75;
    float inside = 1.0 - smoothstep(-aa, aa, d);

    vec2 suv = gl_FragCoord.xy / uResolution;
    vec2 vel = texture(uVelocity, suv).xy;
    vec3 dye = texture(uDye, suv).rgb;

    // Image, refracted and colour-split by the liquid.
    vec2 cuv = (p / uCard) * uImageScale + 0.5;
    vec2 off = vel * 0.013;
    vec2 split = vel * 0.004 + vec2(0.0012, 0.0);
    vec3 img;
    img.r = texture(uMap, cuv - off - split).r;
    img.g = texture(uMap, cuv - off).g;
    img.b = texture(uMap, cuv - off + split).b;

    // Never raw colours: darken and pull towards indigo / violet. Hover and the project view
    // let more of the real image through.
    float luma = dot(img, vec3(0.299, 0.587, 0.114));
    vec3 col = img * 0.42;
    col = mix(col, luma * uTint * 1.1, 0.5);
    col += uTint * 0.02;
    col = mix(col, img * 0.78, clamp(uHover * 0.35 + uReveal * 0.55, 0.0, 1.0));
    col *= mix(0.65, 1.0, max(uFocus, uHover));
    col += dye * 0.1;

    // Thin bright inner rim; brighter on hover.
    float rim = smoothstep(-0.03, 0.0, d) * inside;
    col += mix(uRim, uAccent, uHover) * rim * (0.1 + 0.15 * uHover);

    // Hover sheen: a soft diagonal band sweeping across.
    float band = fract((p.x * 0.55 + p.y * 0.35) * 0.5 - uTime * 0.35 + uSeed);
    col += uAccent * smoothstep(0.0, 0.08, band) * smoothstep(0.2, 0.08, band) * 0.1 * uHover * inside;

    // Glow outside the card, widening into a halo on hover, plus a slow pulsing ring.
    float dOut = max(d, 0.0);
    // Rounded by construction: outside a rounded rectangle the distance iso-lines are rounded too.
    // The plane is a rectangle, so everything must have faded to 0 before its edge.
    float margin = (uPlane.x - uCard.x) * 0.5;
    float window = 1.0 - smoothstep(margin * 0.45, margin * 0.92, dOut);
    float rest = exp(-dOut / 0.05) * 0.16;
    // Hover halo: bright close to the card, a long soft tail, gently breathing and uneven like
    // light in liquid.
    float shimmer = 0.75 + 0.35 * (fbm2(p * 1.6 + vec2(uTime * 0.12, -uTime * 0.09)) * 0.5 + 0.5);
    float breathe = 0.9 + 0.1 * sin(uTime * 1.4 + uSeed * 6.0);
    float halo = (exp(-pow(dOut / 0.04, 1.2)) * 0.12 + exp(-pow(dOut / 0.16, 1.4)) * 0.13) * shimmer * breathe;
    float glow = mix(rest, halo, uHover) * window * (1.0 - inside);
    vec3 glowCol = mix(uGlow, uAccent * 1.2, uHover);

    // Dissolve: noise threshold with a hot edge in the accent colour.
    float n = fbm2(p * 3.2 + uSeed * 10.0) * 0.5 + 0.5;
    n = mix(n, fbm2(p * 9.0 - uSeed * 7.0) * 0.5 + 0.5, 0.3);
    float cut = uDissolve * 1.25 - 0.1;
    float alive = smoothstep(cut - 0.02, cut + 0.02, n);
    float edge = (1.0 - smoothstep(0.0, 0.07, abs(n - cut))) * step(0.001, uDissolve) * step(uDissolve, 0.999);
    col += uAccent * edge * 2.2;

    vec3 outCol = mix(glowCol, col, inside);
    float alpha = (inside * max(alive, edge) + glow * (1.0 - uDissolve)) * uOpacity;
    if (alpha < 0.003) discard;
    fragColor = vec4(outCol, alpha);
  }
`

export interface Pose {
  position: THREE.Vector3
  quaternion: THREE.Quaternion
  scale: number
}

interface Card {
  mesh: THREE.Mesh
  uniforms: Record<string, THREE.IUniform>
  tilt: THREE.Euler
  seed: number
  hover: number // damped 0..1
  // When set, the card sits at this world pose instead of its slot (and ignores the depth fade).
  override: { position: THREE.Vector3; quaternion: THREE.Quaternion; scale: number; opacity: number } | null
}

export class Cards {
  readonly group = new THREE.Group()
  private readonly cards: Card[] = []
  private readonly shared = {
    uVelocity: { value: null as THREE.Texture | null },
    uDye: { value: null as THREE.Texture | null },
    uResolution: { value: new THREE.Vector2(1, 1) },
    uTime: { value: 0 },
    uTanHalf: { value: 0.3 },
    uAspect: { value: 1 },
    uWarp: { value: 1 },
  }
  private readonly pos: Vec3 = { x: 0, y: 0, z: 0 }
  private readonly raycaster = new THREE.Raycaster()
  private readonly ndc = new THREE.Vector2()
  private readonly euler = new THREE.Euler()
  private readonly rest: Pose = { position: new THREE.Vector3(), quaternion: new THREE.Quaternion(), scale: 1 }
  hovered = -1 // set by the caller (picking result), drives uHover

  constructor(renderer: THREE.WebGLRenderer, images: string[], accents: number[], velocity: THREE.Texture, dye: THREE.Texture) {
    this.shared.uVelocity.value = velocity
    this.shared.uDye.value = dye
    const geometry = new THREE.PlaneGeometry(CARD_W + 2 * MARGIN, CARD_H + 2 * MARGIN, 24, 16)
    const loader = new THREE.TextureLoader()
    const anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy())

    images.forEach((src, i) => {
      const uniforms: Record<string, THREE.IUniform> = {
        ...this.shared,
        uMap: { value: null },
        uSeed: { value: i * 0.37 + 0.1 },
        uPlane: { value: new THREE.Vector2(CARD_W + 2 * MARGIN, CARD_H + 2 * MARGIN) },
        uCard: { value: new THREE.Vector2(CARD_W, CARD_H) },
        uRadius: { value: RADIUS },
        uOpacity: { value: 0 },
        uFocus: { value: 0 },
        uHover: { value: 0 },
        uDissolve: { value: 0 },
        uReveal: { value: 0 },
        uImageScale: { value: new THREE.Vector2(1, 1) },
        uTint: { value: linear(0x6b5cff) },
        uGlow: { value: linear(PALETTE.violet).multiplyScalar(0.6) },
        uAccent: { value: linear(accents[i] ?? PALETTE.cyan) },
        uRim: { value: linear(PALETTE.lavender) },
      }
      const texture = loader.load(src, tex => {
        // Cover fit: crop the image to the card's aspect.
        const img = tex.image as { width: number; height: number }
        const imageAspect = img.width / img.height
        const cardAspect = CARD_W / CARD_H
        uniforms.uImageScale.value.set(imageAspect > cardAspect ? cardAspect / imageAspect : 1, imageAspect > cardAspect ? 1 : imageAspect / cardAspect)
      })
      texture.colorSpace = THREE.SRGBColorSpace
      texture.anisotropy = anisotropy
      uniforms.uMap.value = texture

      const material = new THREE.RawShaderMaterial({
        glslVersion: THREE.GLSL3,
        vertexShader: vertex,
        fragmentShader: fragment,
        uniforms,
        transparent: true,
        depthWrite: false,
        side: THREE.DoubleSide,
      })
      const mesh = new THREE.Mesh(geometry, material)
      mesh.renderOrder = 3
      mesh.visible = false
      mesh.userData.index = i
      // Each card floats with its own tilt: a few degrees in x and y, alternating.
      const r = (k: number) => Math.sin(i * 12.9898 + k * 78.233) * 0.5 + 0.5
      const tilt = new THREE.Euler(
        THREE.MathUtils.degToRad(-4 - 5 * r(1)),
        THREE.MathUtils.degToRad((i % 2 === 0 ? 1 : -1) * (6 + 6 * r(2))),
        THREE.MathUtils.degToRad((r(3) - 0.5) * 6),
      )
      this.cards.push({ mesh, uniforms, tilt, seed: r(4), hover: 0, override: null })
      this.group.add(mesh)
    })
  }

  get count() {
    return this.cards.length
  }

  mesh(i: number) {
    return this.cards[i].mesh
  }

  uniforms(i: number) {
    return this.cards[i].uniforms
  }

  setOverride(i: number, pose: Card["override"]) {
    this.cards[i].override = pose
  }

  // Index of the card under the pointer (ndc), among cards that are clearly visible, or -1.
  pick(camera: THREE.Camera, x: number, y: number, minOpacity = 0.5) {
    this.ndc.set(x, y)
    this.raycaster.setFromCamera(this.ndc, camera)
    let best = -1
    let bestDistance = Infinity
    for (let i = 0; i < this.cards.length; i++) {
      const c = this.cards[i]
      if (!c.mesh.visible || c.override || (c.uniforms.uOpacity.value as number) < minOpacity) continue
      const hit = this.raycaster.intersectObject(c.mesh, false)[0]
      // Ignore hits in the glow margin: only the card itself is clickable.
      if (!hit?.uv) continue
      const u = (hit.uv.x - 0.5) * (CARD_W + 2 * MARGIN)
      const v = (hit.uv.y - 0.5) * (CARD_H + 2 * MARGIN)
      if (Math.abs(u) > CARD_W / 2 || Math.abs(v) > CARD_H / 2) continue
      if (hit.distance < bestDistance) {
        best = i
        bestDistance = hit.distance
      }
    }
    return best
  }

  update(
    time: number,
    dt: number,
    camera: THREE.PerspectiveCamera,
    aspect: number,
    alpha: number,
    s: number,
    resolution: THREE.Vector2,
    pointer: { x: number; y: number },
  ) {
    this.shared.uTime.value = time
    this.shared.uTanHalf.value = Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2)
    this.shared.uAspect.value = aspect
    this.shared.uResolution.value.copy(resolution)

    for (let i = 0; i < this.cards.length; i++) {
      const card = this.cards[i]
      card.hover += ((i === this.hovered ? 1 : 0) - card.hover) * (1 - Math.exp(-dt * 7))
      card.uniforms.uHover.value = card.hover

      if (card.override) {
        const o = card.override
        card.mesh.visible = o.opacity > 0.002
        card.mesh.position.copy(o.position)
        card.mesh.quaternion.copy(o.quaternion)
        card.mesh.scale.setScalar(o.scale)
        card.uniforms.uOpacity.value = o.opacity
        card.uniforms.uFocus.value = 1
        continue
      }

      cardPosition(i, aspect, this.pos)
      const distance = camera.position.z - this.pos.z
      const opacity = alpha * cardFade(distance)
      card.mesh.visible = opacity > 0.002
      if (!card.mesh.visible) continue
      this.restPose(i, time, pointer, this.rest)
      card.mesh.position.copy(this.rest.position)
      card.mesh.quaternion.copy(this.rest.quaternion)
      card.mesh.scale.setScalar(this.rest.scale)
      card.uniforms.uOpacity.value = opacity
      card.uniforms.uFocus.value = 1 - THREE.MathUtils.smoothstep(Math.abs(s - i), 0.3, 1.0)
    }
  }

  // The pose card i has in its slot at this time: slot position, fixed tilt plus an idle float;
  // on hover it grows a little and leans towards the pointer. The transition starts from and
  // returns to this pose.
  restPose(i: number, time: number, pointer: { x: number; y: number }, out: Pose) {
    const card = this.cards[i]
    cardPosition(i, this.shared.uAspect.value, this.pos)
    const h = card.hover
    out.position.set(this.pos.x, this.pos.y + Math.sin(time * 0.5 + card.seed * 7) * 0.03, this.pos.z)
    this.euler.set(
      card.tilt.x + Math.sin(time * 0.35 + card.seed * 9) * 0.025 - pointer.y * 0.12 * h,
      card.tilt.y + Math.sin(time * 0.29 + card.seed * 5) * 0.035 + pointer.x * 0.16 * h,
      card.tilt.z,
    )
    out.quaternion.setFromEuler(this.euler)
    out.scale = 1 + 0.045 * h
    return out
  }
}
