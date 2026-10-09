// Screenshots of every phase on a real GPU, for comparison with docs/reference.
// Needs the dev server (npm run dev). Run: node scripts/verify-scene.mjs [p1 p2 ...]
// Env: W/H viewport (default 1600x900), MOBILE=1 for a touch phone viewport.
import { chromium } from "playwright-core"
import { mkdirSync } from "node:fs"
import { fileURLToPath } from "node:url"

const url = process.env.URL ?? "http://localhost:5180/"
const out = fileURLToPath(new URL("../docs/verify/", import.meta.url))
mkdirSync(out, { recursive: true })
const mobile = process.env.MOBILE === "1"
const width = Number(process.env.W ?? (mobile ? 390 : 1600))
const height = Number(process.env.H ?? (mobile ? 844 : 900))
const prefix = process.env.PREFIX ?? (mobile ? "m-" : "")

const browser = await chromium.launch({ headless: true, args: ["--enable-gpu", "--ignore-gpu-blocklist", "--use-angle=d3d11"] })
const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: mobile ? 2 : 1, isMobile: mobile, hasTouch: mobile })
const logs = []
page.on("console", m => logs.push(`${m.type()}: ${m.text()}`))
page.on("pageerror", e => logs.push(`pageerror: ${e}`))

await page.goto(url)
await page.waitForFunction(() => window.__demo?.seek, null, { timeout: 30000 })
await page.waitForLoadState("networkidle")
await page.evaluate(() => document.fonts.ready)

// Particle state: life in 0..1, positions inside the camera-relative volume, no NaN, and the
// whole population keeps cycling (respawns happen) both idle and while flying through the cards.
const particleCheck = await page.evaluate(() => {
  const { particles, probe, pause, step, seek } = window.__demo
  pause(true)
  const sample = () => {
    const { data, w, h } = probe.read(particles.state[0])
    let nan = 0, badLife = 0, outside = 0, near = 0, young = 0
    const n = w * h
    for (let i = 0; i < n; i++) {
      const [x, y, z, life] = data.subarray(i * 4, i * 4 + 4)
      if (![x, y, z, life].every(Number.isFinite)) nan++
      if (life < 0 || life > 1) badLife++
      if (z > -0.6 || z < -46) outside++
      if (z > -6) near++
      if (life < 0.05) young++
    }
    return { n, nan, badLife, outside, nearPct: +(100 * near / n).toFixed(1), youngPct: +(100 * young / n).toFixed(1) }
  }
  seek(0)
  step(600) // 10 s idle in the hero
  const idle = sample()
  // Fly through the cards at a brisk scroll (~0.04 p/s, about 2 z units/s).
  for (let i = 0; i < 600; i++) { seek(0.36 + i * 0.0007); step(1) }
  const flying = sample()
  return { idle, flying }
})
for (const [k, v] of Object.entries(particleCheck)) {
  // nearPct (within 6 units of the camera) is informational: it depends on aspect and count.
  const ok = v.nan === 0 && v.badLife === 0 && v.outside === 0 && v.youngPct > 0
  console.log(`${ok ? "PASS" : "FAIL"}  particles ${k}  ${JSON.stringify(v)}`)
}

const shots = process.argv.slice(2).map(Number)
const points = shots.length ? shots : [0, 0.08, 0.15, 0.18, 0.2, 0.22, 0.25, 0.3, 0.37, 0.415, 0.48, 0.55, 0.8, 0.845, 0.87, 0.9, 1]
await page.evaluate(() => window.__demo.pause(true))
for (const p of points) {
  await page.evaluate(p => {
    window.__demo.seek(p)
    window.__demo.step(90) // 1.5 s of simulated time: particles, damping and fades settle
  }, p)
  await page.waitForTimeout(120)
  const name = `${prefix}p${String(Math.round(p * 1000)).padStart(4, "0")}.jpg`
  await page.screenshot({ path: out + name, type: "jpeg", quality: 82 })
  console.log("shot", name)
}

// Stir the liquid over a card with the real pointer, simulation running.
if (!shots.length && !mobile) {
  await page.evaluate(() => {
    window.__demo.seek(0.415)
    window.__demo.pause(false)
  })
  await page.mouse.move(500, 300)
  for (let i = 0; i <= 40; i++) {
    await page.mouse.move(500 + i * 15, 300 + Math.sin(i / 5) * 140)
    await page.waitForTimeout(16)
  }
  await page.waitForTimeout(100)
  await page.screenshot({ path: out + "stir-card.jpg", type: "jpeg", quality: 82 })
  console.log("shot stir-card.jpg")
}

const problems = logs.filter(l => /^(error|warning|pageerror)/.test(l))
console.log(problems.length ? "console problems:\n" + problems.join("\n") : "console: clean")
console.log(logs.filter(l => l.includes("timeline")).join("\n"))
await browser.close()
