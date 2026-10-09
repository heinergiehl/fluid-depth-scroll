import * as THREE from "three"
import { FullscreenPass, passMaterial } from "../gl/targets"
import { noiseGLSL } from "../gl/glsl"

// Final pass to the canvas: the HDR scene seen through the liquid. Vortex twist, refraction by
// the fluid velocity, dye glow, chromatic aberration growing towards the edges, vignette, ACES-ish
// tone map, sRGB encode, film grain.

const fragment = /* glsl */ `
  in vec2 vUv;
  out vec4 fragColor;
  uniform sampler2D uScene;
  uniform sampler2D uVelocity;
  uniform sampler2D uDye;
  uniform vec2 uResolution;
  uniform float uAspect;
  uniform float uTime;
  uniform float uVortex;
  uniform float uZoom; // radial zoom blur, 0..1 (the project transition's rush)
  uniform float uRefraction;
  uniform float uDyeGlow;
  uniform float uExposure;
  uniform float uGrain;
  ${noiseGLSL}

  vec3 aces(vec3 x) {
    return clamp((x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14), 0.0, 1.0);
  }
  vec3 toSRGB(vec3 c) {
    return mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(0.0031308, c));
  }

  void main() {
    vec2 aspect = vec2(uAspect, 1.0);
    vec2 p = (vUv - 0.5) * aspect;
    float r = length(p);

    // Vortex: twist strongest in the middle, plus a slight pull towards the centre.
    float twist = uVortex * 1.5 * pow(max(1.0 - r / 1.1, 0.0), 2.0);
    float s = sin(twist);
    float c = cos(twist);
    p = mat2(c, s, -s, c) * p * (1.0 - 0.08 * uVortex);
    vec2 uv = p / aspect + 0.5;

    // Refraction by the liquid.
    vec2 vel = texture(uVelocity, uv).xy;
    uv -= vel * uRefraction;

    // Chromatic aberration: radial, stronger at the edges and where the liquid moves.
    vec2 dir = (vUv - 0.5) * aspect;
    float ca = 0.0035 * dot(dir, dir) + 0.0025 * min(length(vel), 3.0);
    vec2 off = normalize(dir + 1e-5) * ca / aspect;
    vec3 col;
    if (uZoom > 0.001) {
      // Rush: average samples towards the centre; streaks grow with the distance from it.
      vec2 toC = (vec2(0.5) - uv) * uZoom * 0.22;
      col = vec3(0.0);
      float wsum = 0.0;
      for (int i = 0; i < 12; i++) {
        float k = float(i) / 11.0;
        float w = 1.0 - k * 0.6;
        vec2 suv = uv + toC * k;
        col.r += texture(uScene, suv + off).r * w;
        col.g += texture(uScene, suv).g * w;
        col.b += texture(uScene, suv - off).b * w;
        wsum += w;
      }
      col /= wsum;
      col *= 1.0 + 0.6 * uZoom; // the streaks glow a little
    } else {
      col.r = texture(uScene, uv + off).r;
      col.g = texture(uScene, uv).g;
      col.b = texture(uScene, uv - off).b;
    }

    // Dye glows faintly where the cursor stirred.
    vec3 dye = texture(uDye, uv).rgb;
    col += dye * uDyeGlow;

    // Vignette.
    col *= mix(1.0, 0.55, smoothstep(0.45, 1.25, r));

    col = aces(col * uExposure);
    col = toSRGB(col);

    // Grain + dither against banding in the dark gradients.
    float g = hash12(vUv * uResolution + fract(uTime * 7.31) * 113.0) - 0.5;
    col += g * uGrain;
    fragColor = vec4(col, 1.0);
  }
`

export class Composite {
  readonly uniforms = {
    uScene: { value: null as THREE.Texture | null },
    uVelocity: { value: null as THREE.Texture | null },
    uDye: { value: null as THREE.Texture | null },
    uResolution: { value: new THREE.Vector2(1, 1) },
    uAspect: { value: 1 },
    uTime: { value: 0 },
    uVortex: { value: 0 },
    uZoom: { value: 0 },
    uRefraction: { value: 0.013 },
    uDyeGlow: { value: 0.12 },
    uExposure: { value: 1.0 },
    uGrain: { value: 0.035 },
  }
  private readonly material = passMaterial(fragment, this.uniforms)
  private readonly pass: FullscreenPass

  constructor(renderer: THREE.WebGLRenderer, velocity: THREE.Texture, dye: THREE.Texture) {
    this.pass = new FullscreenPass(renderer)
    this.uniforms.uVelocity.value = velocity
    this.uniforms.uDye.value = dye
  }

  render(scene: THREE.Texture) {
    this.uniforms.uScene.value = scene
    this.pass.render(this.material, null)
  }
}
