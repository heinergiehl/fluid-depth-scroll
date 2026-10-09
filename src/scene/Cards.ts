import * as THREE from "three"
import { PALETTE, linear } from "../gl/glsl"
import { CARD_H, CARD_W, type Vec3, cardFade, cardPosition } from "../core/timeline"

// Project cards floating in depth. Each is a finely subdivided plane: the vertex shader bends it
// with the fluid velocity sampled at the vertex's screen position plus a slow idle wave; the
// fragment shader cuts the rounded rectangle (SDF), refracts and colour-splits the image where the
// liquid moves, adds the dye, tints everything towards indigo and draws a faint glow around it.

const MARGIN = 0.16 // plane extends past the card for the glow
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
    view.xy += vel * vec2(uAspect, 1.0) * perUv * 0.022 * uWarp;
    view.z += min(length(vel), 4.0) * 0.06 * uWarp;
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
  uniform vec2 uImageScale; // cover fit
  uniform vec3 uTint;
  uniform vec3 uGlow;
  uniform vec3 uRim;
  out vec4 fragColor;

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
    vec2 off = vel * 0.018;
    vec2 split = vel * 0.006 + vec2(0.0015, 0.0);
    vec3 img;
    img.r = texture(uMap, cuv - off - split).r;
    img.g = texture(uMap, cuv - off).g;
    img.b = texture(uMap, cuv - off + split).b;

    // Never raw colours: darken and pull towards indigo / violet.
    float luma = dot(img, vec3(0.299, 0.587, 0.114));
    vec3 col = img * 0.42;
    col = mix(col, luma * uTint * 1.1, 0.5);
    col += uTint * 0.02;
    col *= mix(0.65, 1.0, uFocus);
    col += dye * 0.25;

    // Thin bright inner rim.
    float rim = smoothstep(-0.03, 0.0, d) * inside;
    col += uRim * rim * 0.1;

    // Faint glow outside the card.
    float glow = exp(-max(d, 0.0) / 0.05) * (1.0 - inside) * 0.16;

    vec3 outCol = mix(uGlow, col, inside);
    float alpha = (inside + glow) * uOpacity;
    if (alpha < 0.003) discard;
    fragColor = vec4(outCol, alpha);
  }
`

interface Card {
  mesh: THREE.Mesh
  uniforms: Record<string, THREE.IUniform>
  tilt: THREE.Euler
  seed: number
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

  constructor(renderer: THREE.WebGLRenderer, images: string[], velocity: THREE.Texture, dye: THREE.Texture) {
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
        uImageScale: { value: new THREE.Vector2(1, 1) },
        uTint: { value: linear(0x6b5cff) },
        uGlow: { value: linear(PALETTE.violet).multiplyScalar(0.6) },
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
      // Each card floats with its own tilt: a few degrees in x and y, alternating.
      const r = (k: number) => Math.sin(i * 12.9898 + k * 78.233) * 0.5 + 0.5
      const tilt = new THREE.Euler(
        THREE.MathUtils.degToRad(-4 - 5 * r(1)),
        THREE.MathUtils.degToRad((i % 2 === 0 ? 1 : -1) * (6 + 6 * r(2))),
        THREE.MathUtils.degToRad((r(3) - 0.5) * 6),
      )
      this.cards.push({ mesh, uniforms, tilt, seed: r(4) })
      this.group.add(mesh)
    })
  }

  get count() {
    return this.cards.length
  }

  update(time: number, camera: THREE.PerspectiveCamera, aspect: number, alpha: number, s: number, resolution: THREE.Vector2) {
    this.shared.uTime.value = time
    this.shared.uTanHalf.value = Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2)
    this.shared.uAspect.value = aspect
    this.shared.uResolution.value.copy(resolution)

    for (let i = 0; i < this.cards.length; i++) {
      const card = this.cards[i]
      cardPosition(i, aspect, this.pos)
      const distance = camera.position.z - this.pos.z
      const opacity = alpha * cardFade(distance)
      card.mesh.visible = opacity > 0.002
      if (!card.mesh.visible) continue
      card.mesh.position.set(this.pos.x, this.pos.y, this.pos.z)
      // Idle float on top of the fixed tilt.
      card.mesh.rotation.set(
        card.tilt.x + Math.sin(time * 0.35 + card.seed * 9) * 0.025,
        card.tilt.y + Math.sin(time * 0.29 + card.seed * 5) * 0.035,
        card.tilt.z,
      )
      card.mesh.position.y += Math.sin(time * 0.5 + card.seed * 7) * 0.03
      card.uniforms.uOpacity.value = opacity
      card.uniforms.uFocus.value = 1 - THREE.MathUtils.smoothstep(Math.abs(s - i), 0.3, 1.0)
    }
  }
}
