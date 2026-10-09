import * as THREE from "three"
import { PALETTE, linear, noiseGLSL } from "../gl/glsl"

// The pearlescent sphere, used for the hero and the finale. View-dependent gradient (lavender top
// left, blue middle, cyan right, a cyan-green glow caught at the bottom), soft bright rim, slow
// internal swirl, no hard specular.
//
// The vortex transition lives here too: a screen-space hole around the sphere's projected centre,
// with a turbulent, smoky edge broken up by noise and the fluid dye. Inside the hole the sphere is
// transparent, so whatever lies behind it (the next section) shows through.

const vertex = /* glsl */ `
  precision highp float;
  in vec3 position;
  in vec3 normal;
  uniform mat4 modelViewMatrix;
  uniform mat4 projectionMatrix;
  uniform mat3 normalMatrix;
  out vec3 vNormal;
  out vec3 vViewPos;
  out vec3 vObjNormal;
  void main() {
    vec4 view = modelViewMatrix * vec4(position, 1.0);
    vViewPos = view.xyz;
    vNormal = normalize(normalMatrix * normal);
    vObjNormal = normal;
    gl_Position = projectionMatrix * view;
  }
`

const fragment = /* glsl */ `
  precision highp float;
  precision highp sampler2D;
  in vec3 vNormal;
  in vec3 vViewPos;
  in vec3 vObjNormal;
  uniform float uTime;
  uniform vec2 uResolution;
  uniform float uAspect;
  uniform vec2 uHoleCenter; // screen uv
  uniform float uHole; // radius as a fraction of the projected sphere radius
  uniform float uSphereR; // projected sphere radius in screen heights
  uniform float uAlpha;
  uniform float uDarken;
  uniform sampler2D uDye;
  uniform vec3 uLavender;
  uniform vec3 uBlue;
  uniform vec3 uCyan;
  uniform vec3 uTeal;
  uniform vec3 uViolet;
  uniform vec3 uWhite;
  uniform vec3 uSmoke;
  out vec4 fragColor;
  ${noiseGLSL}

  void main() {
    vec3 N = normalize(vNormal);
    vec3 V = normalize(-vViewPos);
    float ndv = clamp(dot(N, V), 0.0, 1.0);
    float fres = 1.0 - ndv;

    // Slow internal swirl: warps the gradient coordinates.
    vec3 sw = vObjNormal * 1.6 + vec3(uTime * 0.03, -uTime * 0.02, uTime * 0.025);
    float n1 = fbm3(sw);
    float n2 = fbm3(sw + 7.3);
    vec3 Nw = normalize(N + 0.35 * vec3(n1, n2, 0.0));

    // Pearlescent gradient by view-space normal: blue body, lavender upper left, cyan to the
    // right, violet lower left.
    float topLeft = dot(Nw, normalize(vec3(-0.6, 0.75, 0.25)));
    vec3 col = mix(uBlue, uLavender, smoothstep(0.05, 0.95, topLeft));
    col = mix(col, uCyan, smoothstep(0.1, 0.9, Nw.x - Nw.y * 0.2) * 0.55);
    col = mix(col, uViolet, smoothstep(0.25, 0.95, -Nw.x - Nw.y * 0.5) * 0.45);
    // Light caught inside at the bottom: strongest towards the centre of the disc.
    float glow = smoothstep(0.1, 0.95, -Nw.y + Nw.x * 0.25) * smoothstep(0.1, 0.8, ndv);
    col = mix(col, uTeal, glow * 0.7);

    // Soft bright rim, brighter on the upper left.
    float rim = pow(fres, 3.0);
    col += mix(uLavender, uWhite, 0.3) * rim * (0.25 + 0.4 * smoothstep(-0.5, 0.8, topLeft));
    // A thin darker band just inside the silhouette gives the edge some weight.
    col *= 1.0 - 0.25 * smoothstep(0.7, 0.95, fres) * (1.0 - smoothstep(0.95, 1.0, fres));

    float alpha = uAlpha * smoothstep(0.0, 0.025, ndv); // anti-aliased silhouette

    // --- Vortex hole ----------------------------------------------------------------------------
    if (uHole > 0.0) {
      vec2 suv = gl_FragCoord.xy / uResolution;
      vec2 q = (suv - uHoleCenter) * vec2(uAspect, 1.0);
      float r = length(q);
      // Swirl the noise domain: inner parts turn faster.
      float ang = uTime * 0.25 + 1.6 / (r + 0.3);
      vec2 dq = mat2(cos(ang), sin(ang), -sin(ang), cos(ang)) * q;
      float n = fbm2(dq * 3.2 + uTime * 0.1) + 0.5 * fbm2(dq * 7.0 - uTime * 0.2);
      vec3 dye = texture(uDye, suv).rgb;
      n += 0.6 * (dye.r + dye.g + dye.b);
      float edge = uHole * uSphereR * (1.0 + 0.45 * n);
      float soft = (0.05 + 0.18 * uHole) * uSphereR;
      float open = smoothstep(edge - soft, edge + soft, r); // 0 in the hole
      // Smoke: darkening that bleeds outwards from the hole edge.
      float smoke = 1.0 - smoothstep(edge, edge + (0.1 + 0.45 * uHole) * uSphereR, r);
      float ramp = smoothstep(0.0, 0.06, uHole);
      col = mix(col, uSmoke, smoke * 0.85 * ramp);
      alpha *= mix(1.0, open, ramp);
    }

    col *= 1.0 - 0.55 * uDarken;
    if (alpha < 0.004) discard; // let the hole show what is behind, depth included
    fragColor = vec4(col, alpha);
  }
`

let sharedGeometry: THREE.SphereGeometry | null = null

export class Sphere {
  readonly mesh: THREE.Mesh
  readonly uniforms = {
    uTime: { value: 0 },
    uResolution: { value: new THREE.Vector2(1, 1) },
    uAspect: { value: 1 },
    uHoleCenter: { value: new THREE.Vector2(0.5, 0.5) },
    uHole: { value: 0 },
    uSphereR: { value: 0.5 },
    uAlpha: { value: 1 },
    uDarken: { value: 0 },
    uDye: { value: null as THREE.Texture | null },
    uLavender: { value: linear(0xa99be8) },
    uBlue: { value: linear(0x5468cc) },
    uCyan: { value: linear(0x47a6dc) },
    uTeal: { value: linear(0x5cc6b8) },
    uViolet: { value: linear(0x5a48c4) },
    uWhite: { value: linear(PALETTE.white) },
    uSmoke: { value: linear(0x1c1850) },
  }
  private readonly projected = new THREE.Vector3()
  private readonly center = new THREE.Vector3()

  constructor(dye: THREE.Texture) {
    sharedGeometry ??= new THREE.SphereGeometry(1, 128, 64)
    this.uniforms.uDye.value = dye
    const material = new THREE.RawShaderMaterial({
      glslVersion: THREE.GLSL3,
      vertexShader: vertex,
      fragmentShader: fragment,
      uniforms: this.uniforms,
      transparent: true,
      depthWrite: true,
    })
    this.mesh = new THREE.Mesh(sharedGeometry, material)
    this.mesh.renderOrder = 2
  }

  // Hole centre and scale follow the sphere's projection.
  updateHoleCenter(camera: THREE.PerspectiveCamera) {
    this.center.setFromMatrixPosition(this.mesh.matrixWorld)
    const distance = this.center.distanceTo(camera.position)
    const radius = this.mesh.scale.x
    const angle = Math.asin(Math.min(radius / Math.max(distance, 1e-3), 0.999))
    this.uniforms.uSphereR.value = Math.tan(angle) / (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2))
    this.projected.copy(this.center).project(camera)
    this.uniforms.uHoleCenter.value.set(this.projected.x * 0.5 + 0.5, this.projected.y * 0.5 + 0.5)
  }
}
