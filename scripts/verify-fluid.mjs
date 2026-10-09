// GPU check of the fluid simulation: numeric asserts via the dev probe plus debug screenshots.
// Needs the dev server (npm run dev) and a Playwright Chromium in %LOCALAPPDATA%\ms-playwright.
// Run: node scripts/verify-fluid.mjs
import { chromium } from "playwright-core"
import { mkdirSync } from "node:fs"
import { fileURLToPath } from "node:url"

const url = process.env.URL ?? "http://localhost:5180/"
const out = fileURLToPath(new URL("../docs/verify/", import.meta.url))
mkdirSync(out, { recursive: true })

const browser = await chromium.launch({ headless: true, args: ["--enable-gpu", "--ignore-gpu-blocklist", "--use-angle=d3d11"] })
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } })
const errors = []
page.on("console", m => { if (m.type() === "error" || m.type() === "warning") errors.push(m.text()) })
page.on("pageerror", e => errors.push(String(e)))

await page.goto(url + "?debug=dye")
await page.waitForFunction(() => window.__demo?.probe)

const results = await page.evaluate(() => {
  const { fluid, probe, pause, renderer } = window.__demo
  pause(true)
  const gl = renderer.getContext()
  const dbg = gl.getExtension("WEBGL_debug_renderer_info")
  const out = { gpu: dbg ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : "?", checks: [] }
  const check = (name, ok, detail) => out.checks.push({ name, ok: !!ok, detail })
  const W = innerWidth
  const H = innerHeight
  const aspect = W / H
  // A real size change clears the fluid; use it as "reset".
  const reset = (w = W, h = H) => { fluid.resize(1, 1); fluid.resize(w, h) }
  const steps = (n, dt = 1 / 60) => { for (let i = 0; i < n; i++) fluid.update(dt) }
  const r3 = v => Math.round(v * 1000) / 1000

  // 1. Clean start.
  reset()
  const v0 = probe.stats(fluid.velocity)
  const d0 = probe.stats(fluid.dye, 3)
  check("starts at zero", v0.max === 0 && d0.max === 0 && v0.nan + d0.nan === 0, { vel: v0.max, dye: d0.max, grid: [v0.w, v0.h], dyeGrid: [d0.w, d0.h] })

  // 2. Splat lands where asked (uv, y up) and is round on screen.
  reset()
  fluid.splat(0.3, 0.7, 0, 0, [1, 0, 0], 0.05)
  fluid.update(0)
  const s = probe.stats(fluid.dye, 3)
  const peak = probe.at(fluid.dye, 0.3, 0.7)[0]
  const rx = probe.at(fluid.dye, 0.3 + 0.05 / aspect, 0.7)[0]
  const ry = probe.at(fluid.dye, 0.3, 0.75)[0]
  check("splat position", Math.abs(s.maxAt[0] - 0.3) < 0.01 && Math.abs(s.maxAt[1] - 0.7) < 0.01, { maxAt: s.maxAt.map(r3) })
  check("splat amplitude ~1", Math.abs(peak - 1) < 0.05, { peak: r3(peak) })
  check("splat round (1/e at radius on both axes)", Math.abs(rx - 1 / Math.E) < 0.05 && Math.abs(ry - 1 / Math.E) < 0.05, { rx: r3(rx), ry: r3(ry), expected: r3(1 / Math.E) })

  // 3. Velocity direction: +x moves dye right, +y moves dye up.
  for (const [name, dx, dy] of [["+x moves right", 2, 0], ["+y moves up", 0, 2], ["-x moves left", -2, 0]]) {
    reset()
    fluid.splat(0.5, 0.5, dx, dy, [0, 1, 0], 0.06)
    fluid.update(1 / 60)
    const vc = probe.at(fluid.velocity, 0.5, 0.5)
    steps(30)
    const c = probe.stats(fluid.dye, 3).centroid
    const moved = [c[0] - 0.5, c[1] - 0.5]
    // Main axis moves at least 0.02 uv in the splat direction, the other axis stays put.
    const [main, side] = dx ? [moved[0] * Math.sign(dx), moved[1]] : [moved[1] * Math.sign(dy), moved[0]]
    const ok = main > 0.02 && Math.abs(side) < 0.01
    // Velocity at the centre points along the splat; the cross component is sampling noise.
    const [vMain, vSide] = dx ? [vc[0] * Math.sign(dx), vc[1]] : [vc[1] * Math.sign(dy), vc[0]]
    check(name, ok && vMain > 0.5 && Math.abs(vSide) < 0.1 * vMain, { velAtCentre: vc.slice(0, 2).map(r3), centroidShift: moved.map(r3) })
  }

  // 4. Radial push: outward velocity around the centre, ~0 at the centre.
  reset()
  fluid.push(0.5, 0.5, 1, 0.25)
  fluid.update(1 / 60)
  const pc = probe.at(fluid.velocity, 0.5, 0.5)
  const pr = probe.at(fluid.velocity, 0.5 + 0.25 / aspect, 0.5)
  const pu = probe.at(fluid.velocity, 0.5, 0.75)
  check("push outward (after projection)", pr[0] > 0 && pu[1] > 0, { centre: pc.slice(0, 2).map(r3), right: pr.slice(0, 2).map(r3), up: pu.slice(0, 2).map(r3), note: "1 height/s requested at r=0.25; right is uv/s (x / aspect)" })
  // Repeated pushes (scrolling): how much survives the projection?
  reset()
  for (let i = 0; i < 30; i++) { fluid.push(0.5, 0.5, 1, 0.25); fluid.update(1 / 60) }
  const pr30 = probe.at(fluid.velocity, 0.5 + 0.25 / aspect, 0.5)
  const pu30 = probe.at(fluid.velocity, 0.5, 0.75)
  check("push sustained over 30 frames", pr30[0] > 0 && pu30[1] > 0, { right: pr30.slice(0, 2).map(r3), up: pu30.slice(0, 2).map(r3) })

  // 5. Dye decay matches 1 / (1 + 1.4 dt) per step.
  reset()
  fluid.splat(0.5, 0.5, 0, 0, [1, 1, 1], 0.1)
  fluid.update(0)
  const before = probe.at(fluid.dye, 0.5, 0.5)[0]
  steps(60)
  const after = probe.at(fluid.dye, 0.5, 0.5)[0]
  const expected = before * Math.pow(1 / (1 + 1.4 / 60), 60)
  check("dye decay rate", Math.abs(after - expected) < 0.02, { before: r3(before), after: r3(after), expected: r3(expected) })

  // 6. dt clamp: a 1 s hitch behaves like 1/30 s.
  reset()
  fluid.splat(0.5, 0.5, 0, 0, [1, 1, 1], 0.1)
  fluid.update(0)
  fluid.update(1)
  const hitch = probe.at(fluid.dye, 0.5, 0.5)[0]
  check("dt clamped to 1/30", Math.abs(hitch - before / (1 + 1.4 / 30)) < 0.01, { hitch: r3(hitch), expected: r3(before / (1 + 1.4 / 30)) })

  // 7. Renderer state is restored.
  const dummy = new (renderer.getRenderTarget()?.constructor ?? Object)()
  renderer.setRenderTarget(null)
  renderer.autoClear = true
  fluid.update(1 / 60)
  check("restores target + autoClear", renderer.getRenderTarget() === null && renderer.autoClear === true, {})
  void dummy

  // 8. Stress: 600 frames of max-strength splats and pushes; no NaN, velocity bounded.
  reset()
  let seed = 1
  const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647
  let worst = 0
  let nan = 0
  for (let f = 0; f < 600; f++) {
    for (let i = 0; i < 31; i++) fluid.splat(rnd(), rnd(), (rnd() * 2 - 1) * 4, (rnd() * 2 - 1) * 4, [0.3 * rnd(), 0.3 * rnd(), 0.3 * rnd()], 0.03 + 0.03 * rnd())
    fluid.push(0.5, 0.5, 1.5, 0.25)
    fluid.update(1 / 60)
    if (f % 100 === 99) {
      const st = probe.stats(fluid.velocity)
      worst = Math.max(worst, st.max)
      nan += st.nan
    }
  }
  const dyeStress = probe.stats(fluid.dye, 3)
  check("stress: no NaN/Inf", nan === 0 && dyeStress.nan === 0, { velNaN: nan, dyeNaN: dyeStress.nan })
  check("stress: velocity bounded", worst < 9, { maxVel: r3(worst), clamp: "8 heights/s = 4.5 uv/s in x, 8 in y" })
  // Calm down: velocity must die out once input stops.
  steps(600)
  const calm = probe.stats(fluid.velocity)
  check("velocity dissipates after input stops", calm.max < 0.05, { maxVelAfter10s: r3(calm.max) })

  // 9. Portrait: grid follows aspect, splats stay round.
  reset(600, 1000)
  const pv = probe.stats(fluid.velocity)
  fluid.splat(0.5, 0.5, 0, 0, [1, 0, 0], 0.05)
  fluid.update(0)
  const prx = probe.at(fluid.dye, 0.5 + 0.05 / 0.6, 0.5)[0]
  const pry = probe.at(fluid.dye, 0.5, 0.55)[0]
  check("portrait grid + round splat", pv.w === 128 && pv.h === 213 && Math.abs(prx - pry) < 0.05, { grid: [pv.w, pv.h], rx: r3(prx), ry: r3(pry) })

  // 10. Cost per update at 1600x900 (GPU synced by a 1x1 read).
  reset()
  const px = new Uint8Array(4)
  const sync = () => gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px)
  steps(20)
  sync()
  const t0 = performance.now()
  for (let i = 0; i < 200; i++) { fluid.splat(0.5, 0.5, 1, 0, [0.1, 0.1, 0.1], 0.04); fluid.update(1 / 60) }
  sync()
  const ms = (performance.now() - t0) / 200
  check("update cost", ms < 4, { msPerUpdate: r3(ms) })

  reset()
  return out
})

console.log("GPU:", results.gpu)
let failed = 0
for (const c of results.checks) {
  if (!c.ok) failed++
  console.log(`${c.ok ? "PASS" : "FAIL"}  ${c.name}  ${JSON.stringify(c.detail)}`)
}

// Visual: drive the real pointer path through the debug views.
await page.evaluate(() => window.__demo.pause(false))
for (const mode of ["dye", "velocity"]) {
  await page.goto(url + `?debug=${mode}`)
  await page.waitForFunction(() => window.__demo?.probe)
  await page.mouse.move(300, 450)
  for (let i = 0; i <= 60; i++) {
    const t = i / 60
    await page.mouse.move(300 + 1000 * t, 450 + 250 * Math.sin(t * Math.PI * 2))
    await page.waitForTimeout(16)
  }
  await page.waitForTimeout(250)
  await page.screenshot({ path: `${out}fluid-${mode}.png` })
}

console.log(errors.length ? "console:\n" + errors.join("\n") : "console: clean")
console.log(failed ? `${failed} check(s) failed` : "all checks passed")
await browser.close()
process.exit(failed ? 1 : 0)
