import * as THREE from "three"
import { FullscreenPass, passMaterial } from "../gl/targets"
import { PALETTE, linear, noiseGLSL } from "../gl/glsl"

// Full-screen backdrop, drawn first into the scene target: indigo gradient plus large, very soft
// violet / blue clouds that drift slowly and lean with the pointer (the farthest layer, so it
// moves least).

const fragment = /* glsl */ `
  in vec2 vUv;
  out vec4 fragColor;
  uniform float uTime;
  uniform float uAspect;
  uniform vec2 uOffset;
  uniform float uBrightness;
  uniform vec3 uIndigo;
  uniform vec3 uDeep;
  uniform vec3 uViolet;
  uniform vec3 uBlue;
  ${noiseGLSL}

  void main() {
    vec2 p = (vUv - 0.5) * vec2(uAspect, 1.0);
    float r = length(p);

    // Base: indigo centre falling off to near-black indigo at the edges.
    vec3 col = mix(uIndigo, uDeep, smoothstep(0.1, 1.05, r));

    // Clouds: low-frequency fbm, domain-warped so they look smoky rather than blobby.
    vec2 q = p * 1.1 + uOffset;
    float t = uTime * 0.018;
    vec2 warp = vec2(fbm2(q * 0.9 + vec2(t, -t)), fbm2(q * 0.9 + vec2(-t, 5.2 + t)));
    float violet = smoothstep(-0.05, 0.6, fbm2(q * 0.8 + warp * 0.9 + vec2(1.7, 9.2)));
    float blue = smoothstep(0.0, 0.65, fbm2(q * 0.7 - warp * 0.8 + vec2(8.3, 2.8)));

    // Clouds favour the screen edges: the centre stays clear for the content.
    float edge = smoothstep(0.25, 0.95, r);
    col += uViolet * violet * (0.06 + 0.15 * edge);
    col += uBlue * blue * (0.03 + 0.14 * edge) * smoothstep(0.2, 0.9, abs(p.x) / uAspect * 2.0);

    fragColor = vec4(col * uBrightness, 1.0);
  }
`

export class Nebula {
  readonly uniforms = {
    uTime: { value: 0 },
    uAspect: { value: 1 },
    uOffset: { value: new THREE.Vector2() },
    uBrightness: { value: 1 },
    uIndigo: { value: linear(PALETTE.indigo) },
    uDeep: { value: linear(PALETTE.deep) },
    uViolet: { value: linear(PALETTE.violet) },
    uBlue: { value: linear(PALETTE.blue) },
  }
  private readonly material = passMaterial(fragment, this.uniforms)
  private readonly pass: FullscreenPass

  constructor(renderer: THREE.WebGLRenderer) {
    this.pass = new FullscreenPass(renderer)
  }

  render(target: THREE.WebGLRenderTarget) {
    this.pass.render(this.material, target)
  }
}
