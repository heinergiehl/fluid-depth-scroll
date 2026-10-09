import * as THREE from "three"
import { PALETTE, linear } from "../gl/glsl"

// Big translucent bubbles in a tunnel around the camera: dark interiors, thin iridescent rims,
// out of focus. They are static in the world along z (the camera flies towards them) plus a slow
// drift, and wrap to the far end once they pass the camera.

const LENGTH = 36 // tunnel length; z range relative to the camera is [2 - LENGTH, 2)

const vertex = /* glsl */ `
  precision highp float;
  in vec3 position;
  in vec3 normal;
  in vec2 aOffset;
  in float aPhase;
  in float aRadius;
  in float aSeed;
  uniform mat4 viewMatrix;
  uniform mat4 projectionMatrix;
  uniform vec3 uCamPos;
  uniform float uTravel;
  uniform float uTime;
  out vec3 vNormal;
  out vec3 vViewPos;
  out float vSeed;
  out float vDepth;

  void main() {
    float zrel = 2.0 - LENGTH + mod(aPhase * LENGTH + uTravel, LENGTH);
    vec3 centre = uCamPos + vec3(aOffset, zrel);
    centre.xy += 0.25 * vec2(sin(uTime * 0.13 + aSeed * 40.0), cos(uTime * 0.11 + aSeed * 30.0));
    // Slight wobble so they read as liquid, not glass.
    vec3 p = position * (1.0 + 0.025 * sin(uTime * 0.7 + position.y * 3.0 + aSeed * 10.0));
    vec4 view = viewMatrix * vec4(centre + p * aRadius, 1.0);
    vViewPos = view.xyz;
    vNormal = normalize(mat3(viewMatrix) * normal);
    vSeed = aSeed;
    vDepth = -(viewMatrix * vec4(centre, 1.0)).z;
    gl_Position = projectionMatrix * view;
  }
`.replaceAll("LENGTH", LENGTH.toFixed(1))

const fragment = /* glsl */ `
  precision highp float;
  in vec3 vNormal;
  in vec3 vViewPos;
  in float vSeed;
  in float vDepth;
  uniform float uFocus;
  uniform float uOpacity;
  uniform vec3 uInterior;
  uniform vec3 uViolet;
  uniform vec3 uCyan;
  uniform vec3 uLavender;
  out vec4 fragColor;

  void main() {
    vec3 N = normalize(vNormal);
    vec3 V = normalize(-vViewPos);
    float ndv = clamp(dot(N, V), 0.0, 1.0);
    float fres = 1.0 - ndv;

    // Fake depth of field: out of focus -> wider, dimmer rim and a softer silhouette.
    float blur = clamp(abs(vDepth - uFocus) / (uFocus * 0.8), 0.0, 1.0);
    float rim = pow(fres, mix(6.0, 2.5, blur)) * mix(0.7, 0.3, blur);

    // Thin-film interference: hue walks with the film thickness (fresnel) and per bubble.
    vec3 film = 0.5 + 0.5 * cos(6.2831 * (fres * 1.4 + vSeed + vec3(0.0, 0.33, 0.67)));
    vec3 irid = mix(uViolet, uCyan, film.y) + uLavender * film.z * 0.35;

    // Light from the top left catches one side of the rim.
    float light = 0.35 + 0.65 * smoothstep(-0.4, 0.8, dot(N, normalize(vec3(-0.55, 0.7, 0.35))));

    vec3 col = mix(uInterior, irid * light, clamp(rim * 1.4, 0.0, 1.0));
    float alpha = 0.12 + rim * 0.55;
    alpha *= smoothstep(0.0, mix(0.08, 0.5, blur), ndv); // soft silhouette

    float depthFade = smoothstep(34.0, 22.0, vDepth) * smoothstep(0.5, 3.0, vDepth);
    fragColor = vec4(col, alpha * depthFade * uOpacity);
  }
`

export class Bubbles {
  readonly mesh: THREE.Mesh
  readonly uniforms = {
    uCamPos: { value: new THREE.Vector3() },
    uTravel: { value: 0 },
    uTime: { value: 0 },
    uFocus: { value: 7 },
    uOpacity: { value: 1 },
    uInterior: { value: linear(0x120d3a) },
    uViolet: { value: linear(PALETTE.violet) },
    uCyan: { value: linear(PALETTE.cyan) },
    uLavender: { value: linear(PALETTE.lavender) },
  }

  constructor(count = 40) {
    const base = new THREE.SphereGeometry(1, 48, 24)
    const geometry = new THREE.InstancedBufferGeometry()
    geometry.index = base.index
    geometry.setAttribute("position", base.getAttribute("position"))
    geometry.setAttribute("normal", base.getAttribute("normal"))

    const offset = new Float32Array(count * 2)
    const phase = new Float32Array(count)
    const radius = new Float32Array(count)
    const seed = new Float32Array(count)
    let s = 7
    const rnd = () => ((s = (s * 16807) % 2147483647) - 1) / 2147483646
    for (let i = 0; i < count; i++) {
      // Keep the middle of the tunnel clear for the content.
      const a = rnd() * Math.PI * 2
      const r = 3.2 + rnd() * 7
      offset[i * 2] = Math.cos(a) * r * 1.5
      offset[i * 2 + 1] = Math.sin(a) * r
      phase[i] = (i + rnd() * 0.8) / count
      radius[i] = 1.0 + Math.pow(rnd(), 1.4) * 2.8
      seed[i] = rnd()
    }
    geometry.setAttribute("aOffset", new THREE.InstancedBufferAttribute(offset, 2))
    geometry.setAttribute("aPhase", new THREE.InstancedBufferAttribute(phase, 1))
    geometry.setAttribute("aRadius", new THREE.InstancedBufferAttribute(radius, 1))
    geometry.setAttribute("aSeed", new THREE.InstancedBufferAttribute(seed, 1))
    geometry.instanceCount = count

    const material = new THREE.RawShaderMaterial({
      glslVersion: THREE.GLSL3,
      vertexShader: vertex,
      fragmentShader: fragment,
      uniforms: this.uniforms,
      transparent: true,
      depthWrite: false,
    })
    this.mesh = new THREE.Mesh(geometry, material)
    this.mesh.frustumCulled = false
    this.mesh.renderOrder = 1
  }
}
