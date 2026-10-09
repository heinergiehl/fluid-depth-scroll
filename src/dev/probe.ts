import * as THREE from "three"
import { FullscreenPass, createTarget, passMaterial } from "../gl/targets"

// Dev only: reads GPU textures (fluid velocity / dye, particle state) back as floats so headless
// checks can assert on numbers instead of screenshots.

export class TextureProbe {
  private readonly pass: FullscreenPass
  private readonly target = createTarget(1, 1, { type: THREE.FloatType, filter: THREE.NearestFilter })
  private readonly u = { uSource: { value: null as THREE.Texture | null } }
  private readonly mat = passMaterial(
    /* glsl */ `
    in vec2 vUv;
    out vec4 fragColor;
    uniform sampler2D uSource;
    void main() { fragColor = texture(uSource, vUv); }
  `,
    this.u,
  )

  constructor(private readonly renderer: THREE.WebGLRenderer) {
    this.pass = new FullscreenPass(renderer)
  }

  // Copies the texture at its own size and returns RGBA floats, row 0 = bottom (uv y = 0).
  read(texture: THREE.Texture) {
    const img = texture.image as { width: number; height: number }
    const w = img.width
    const h = img.height
    this.target.setSize(w, h)
    this.u.uSource.value = texture
    const prev = this.renderer.getRenderTarget()
    this.pass.render(this.mat, this.target)
    const data = new Float32Array(w * h * 4)
    this.renderer.readRenderTargetPixels(this.target, 0, 0, w, h, data)
    this.renderer.setRenderTarget(prev)
    return { w, h, data }
  }

  // Summary statistics of one channel set, enough for most assertions.
  stats(texture: THREE.Texture, channels = 2) {
    const { w, h, data } = this.read(texture)
    let max = 0
    let nan = 0
    let sum = 0
    let cx = 0
    let cy = 0
    let maxAt = [0, 0]
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const o = (y * w + x) * 4
        let m2 = 0
        for (let c = 0; c < channels; c++) {
          const v = data[o + c]
          if (!Number.isFinite(v)) nan++
          else m2 += v * v
        }
        const m = Math.sqrt(m2)
        sum += m
        cx += m * (x + 0.5) / w
        cy += m * (y + 0.5) / h
        if (m > max) {
          max = m
          maxAt = [(x + 0.5) / w, (y + 0.5) / h]
        }
      }
    }
    return { w, h, max, maxAt, nan, sum: sum / (w * h), centroid: sum > 0 ? [cx / sum, cy / sum] : [0, 0] }
  }

  // Value at a uv position (nearest texel).
  at(texture: THREE.Texture, u: number, v: number) {
    const { w, h, data } = this.read(texture)
    const x = Math.min(w - 1, Math.max(0, Math.floor(u * w)))
    const y = Math.min(h - 1, Math.max(0, Math.floor(v * h)))
    const o = (y * w + x) * 4
    return [data[o], data[o + 1], data[o + 2], data[o + 3]]
  }
}
