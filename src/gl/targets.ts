import * as THREE from "three"

// GPU plumbing shared by the fluid simulation, the particle simulation and the post pass:
// float render targets, ping-pong pairs and a fullscreen triangle.

export interface TargetOptions {
  type?: THREE.TextureDataType
  filter?: THREE.MinificationTextureFilter & THREE.MagnificationTextureFilter
  format?: THREE.PixelFormat
  wrap?: THREE.Wrapping
}

export function createTarget(width: number, height: number, options: TargetOptions = {}) {
  const target = new THREE.WebGLRenderTarget(width, height, {
    type: options.type ?? THREE.HalfFloatType,
    format: options.format ?? THREE.RGBAFormat,
    minFilter: options.filter ?? THREE.LinearFilter,
    magFilter: options.filter ?? THREE.LinearFilter,
    wrapS: options.wrap ?? THREE.ClampToEdgeWrapping,
    wrapT: options.wrap ?? THREE.ClampToEdgeWrapping,
    depthBuffer: false,
    stencilBuffer: false,
    generateMipmaps: false,
  })
  target.texture.colorSpace = THREE.NoColorSpace
  return target
}

// Two targets that swap roles every step: read from one, write into the other.
export class PingPong {
  read: THREE.WebGLRenderTarget
  write: THREE.WebGLRenderTarget

  constructor(width: number, height: number, options?: TargetOptions) {
    this.read = createTarget(width, height, options)
    this.write = createTarget(width, height, options)
  }

  swap() {
    const read = this.read
    this.read = this.write
    this.write = read
  }

  setSize(width: number, height: number) {
    this.read.setSize(width, height)
    this.write.setSize(width, height)
  }

  dispose() {
    this.read.dispose()
    this.write.dispose()
  }
}

// One oversized triangle covers the viewport; cheaper than a quad (no diagonal seam).
const triangle = new THREE.BufferGeometry()
triangle.setAttribute("position", new THREE.BufferAttribute(new Float32Array([-1, -1, 0, 3, -1, 0, -1, 3, 0]), 3))
triangle.setAttribute("uv", new THREE.BufferAttribute(new Float32Array([0, 0, 2, 0, 0, 2]), 2))

// Shared vertex stage for every fullscreen pass. vUv spans 0..1 across the target.
export const fullscreenVertex = /* glsl */ `
  out vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = vec4(position.xy, 0.0, 1.0);
  }
`

export function passMaterial(fragmentShader: string, uniforms: Record<string, THREE.IUniform>, options: Partial<THREE.ShaderMaterialParameters> = {}) {
  return new THREE.RawShaderMaterial({
    glslVersion: THREE.GLSL3,
    vertexShader: "precision highp float;\nin vec3 position;\nin vec2 uv;\n" + fullscreenVertex,
    fragmentShader: "precision highp float;\nprecision highp sampler2D;\n" + fragmentShader,
    uniforms,
    depthTest: false,
    depthWrite: false,
    ...options,
  })
}

// Renders a material over a whole target (or the canvas when target is null).
export class FullscreenPass {
  private readonly scene = new THREE.Scene()
  private readonly camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1)
  private readonly mesh = new THREE.Mesh(triangle)

  constructor(private readonly renderer: THREE.WebGLRenderer) {
    this.mesh.frustumCulled = false
    this.scene.add(this.mesh)
  }

  render(material: THREE.Material, target: THREE.WebGLRenderTarget | null) {
    this.mesh.material = material
    this.renderer.setRenderTarget(target)
    this.renderer.render(this.scene, this.camera)
  }
}
