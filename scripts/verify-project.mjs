// Project pages on a real GPU: hover a card, click it, capture the transition, a direct visit
// to a project URL, Escape back home. Needs the dev server. Run: node scripts/verify-project.mjs
import { chromium } from "playwright-core"
import { mkdirSync } from "node:fs"
import { fileURLToPath } from "node:url"

const url = process.env.URL ?? "http://localhost:5180"
const out = fileURLToPath(new URL("../docs/verify/", import.meta.url))
mkdirSync(out, { recursive: true })
const mobile = process.env.MOBILE === "1"
const prefix = mobile ? "m-" : ""

const browser = await chromium.launch({ headless: true, args: ["--enable-gpu", "--ignore-gpu-blocklist", "--use-angle=d3d11"] })
const page = await browser.newPage({ viewport: mobile ? { width: 390, height: 844 } : { width: 1600, height: 900 }, deviceScaleFactor: mobile ? 2 : 1 })
const logs = []
page.on("console", m => logs.push(`${m.type()}: ${m.text()}`))
page.on("pageerror", e => logs.push(`pageerror: ${e}`))
const ready = async () => {
  await page.waitForFunction(() => window.__demo?.seek && document.body.classList.contains("gl-text"), null, { timeout: 30000 })
}
const shot = async name => {
  await page.waitForTimeout(80)
  await page.screenshot({ path: `${out}${prefix}${name}.jpg`, type: "jpeg", quality: 82 })
  console.log("shot", name)
}

// 1. Home at the first card, hover it.
await page.goto(url + "/")
await ready()
await page.evaluate(() => { window.__demo.pause(true); window.__demo.seek(0.415); window.__demo.step(90) })
const c = await page.evaluate(() => window.__demo.cardScreen(0))
await page.mouse.move(c.x - 40, c.y - 20)
await page.mouse.move(c.x, c.y, { steps: 5 })
await page.evaluate(() => window.__demo.step(45))
await shot("project-0-hover")

// 2. Click: the transition, frame by frame (DURATION 2.4 s = 144 steps).
await page.mouse.click(c.x, c.y)
const path = await page.evaluate(() => location.pathname)
console.log("after click:", path)
// Capture at these transition progress values (t advances 1/144 per 60 Hz step).
let tNow = 0
for (const t of [0.17, 0.3, 0.38, 0.46, 0.54, 0.62, 0.7, 0.82, 1]) {
  await page.evaluate(n => window.__demo.step(n), Math.round((t - tNow) * 144))
  tNow = t
  await shot(`project-1-t${String(Math.round(t * 100)).padStart(3, "0")}`)
}
const title = await page.title()
console.log("title:", title)

// 3. Escape back home.
await page.keyboard.press("Escape")
await page.evaluate(() => window.__demo.step(160))
console.log("after escape:", await page.evaluate(() => location.pathname), await page.title())
await shot("project-2-back")

// 4. Direct visit of a project URL.
await page.goto(url + "/projects/gif-creator")
await ready()
await page.evaluate(() => { window.__demo.pause(true); window.__demo.step(120) })
await shot("project-3-direct")

// 5. Next project from inside a project.
await page.evaluate(() => document.querySelector("a.next")?.click())
await page.evaluate(() => window.__demo.step(60))
await shot("project-4-switch-mid")
await page.evaluate(() => window.__demo.step(160))
console.log("after next:", await page.evaluate(() => location.pathname))
await shot("project-4-switch")

const problems = logs.filter(l => /^(error|warning|pageerror)/.test(l))
console.log(problems.length ? "console problems:\n" + problems.join("\n") : "console: clean")
await browser.close()
