import * as THREE from "three"
import { FullscreenPass, passMaterial } from "../gl/targets"
import type { FluidSim } from "../fluid/FluidSim"

// Dev view: the fluid alone, full screen. Dye as colour, or velocity with direction as hue and
// speed as brightness (full at 2 uv/s, black at rest).
export class FluidView {
  private readonly pass: FullscreenPass
  private readonly material: THREE.RawShaderMaterial

  constructor(renderer: THREE.WebGLRenderer, fluid: FluidSim, mode: "dye" | "velocity") {
    this.pass = new FullscreenPass(renderer)
    this.material = passMaterial(
      /* glsl */ `
      in vec2 vUv;
      out vec4 fragColor;
      uniform sampler2D uDye;
      uniform sampler2D uVelocity;
      uniform int uMode;
      void main() {
        vec3 c;
        if (uMode == 1) {
          vec2 v = texture(uVelocity, vUv).xy;
          float h = atan(v.y, v.x) / 6.2831853 + 0.5;
          vec3 hue = clamp(abs(fract(h + vec3(0.0, 2.0, 1.0) / 3.0) * 6.0 - 3.0) - 1.0, 0.0, 1.0);
          c = hue * min(length(v) / 2.0, 1.0);
        } else {
          c = texture(uDye, vUv).rgb;
          c = pow(c / (1.0 + c), vec3(1.0 / 2.2)); // soft clip so heavy dye does not just turn white
        }
        fragColor = vec4(c, 1.0);
      }
    `,
      {
        uDye: { value: fluid.dye },
        uVelocity: { value: fluid.velocity },
        uMode: { value: mode === "velocity" ? 1 : 0 },
      },
    )
  }

  render() {
    this.pass.render(this.material, null)
  }
}
