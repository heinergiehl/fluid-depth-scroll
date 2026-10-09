import * as THREE from "three"
import { FullscreenPass, createTarget, passMaterial } from "../gl/targets"
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
  uniform vec3 uAccent;
  uniform float uAccentMix;
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

    // A project's cosmos takes on its accent colour, strongest in the clouds.
    col = mix(col, col * 0.6 + uAccent * (0.05 + 0.22 * max(violet, blue) * edge + 0.04 * (1.0 - r)), uAccentMix);

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
    uAccent: { value: linear(PALETTE.cyan) },
    uAccentMix: { value: 0 },
  }
  private readonly material = passMaterial(fragment, this.uniforms)
  private readonly pass: FullscreenPass
  // The clouds are drawn at a fraction of the resolution and upscaled with linear filtering:
  // there is no detail to lose, and it saves most of the cost of the noise.
  private readonly low = createTarget(1, 1)
  private readonly copyU = { uSource: { value: this.low.texture as THREE.Texture } }
  private readonly copy = passMaterial(
    /* glsl */ `
    in vec2 vUv;
    out vec4 fragColor;
    uniform sampler2D uSource;
    void main() { fragColor = texture(uSource, vUv); }
  `,
    this.copyU,
  )

  constructor(
    renderer: THREE.WebGLRenderer,
    private readonly scale = 0.5,
  ) {
    this.pass = new FullscreenPass(renderer)
  }

  setSize(width: number, height: number) {
    this.low.setSize(Math.max(1, Math.round(width * this.scale)), Math.max(1, Math.round(height * this.scale)))
  }

  render(target: THREE.WebGLRenderTarget) {
    this.pass.render(this.material, this.low)
    this.pass.render(this.copy, target)
  }
}
