import * as THREE from "three"

// A layer of WebGL text that sits in front of the camera and is laid out in CSS pixels.
// It lives inside the 3D scene (not on top of the canvas), so the composite pass refracts,
// twists and grades the text together with everything else: the liquid moves the words too.
//
// Children are positioned in px with y up from the screen centre via `place()`; the group is
// scaled so that 1 local unit = 1 px at its distance from the camera.

const DISTANCE = 3 // in front of the camera; closer than every card at focus

export class Hud extends THREE.Group {
  width = 1
  height = 1

  constructor(private readonly camera: THREE.PerspectiveCamera) {
    super()
    this.position.set(0, 0, -DISTANCE)
    camera.add(this)
  }

  resize(width: number, height: number) {
    this.width = width
    this.height = height
    const worldPerPx = (2 * DISTANCE * Math.tan(THREE.MathUtils.degToRad(this.camera.fov) / 2)) / height
    this.scale.setScalar(worldPerPx)
  }

  // Place an object by its top-left (or top-centre) corner given in CSS px from the top-left.
  place(object: THREE.Object3D, left: number, top: number) {
    object.position.set(left - this.width / 2, this.height / 2 - top, 0)
  }
}
