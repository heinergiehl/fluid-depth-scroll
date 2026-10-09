// Recon of the reference (engaged.be): screenshots across the scroll into docs/reference (git-ignored).
// Needs a Playwright Chromium in %LOCALAPPDATA%\ms-playwright. Run: node scripts/recon-reference.mjs
import { chromium } from "playwright-core"
import { mkdirSync, writeFileSync } from "node:fs"
import { fileURLToPath } from "node:url"

const out = fileURLToPath(new URL("../docs/reference/", import.meta.url))
mkdirSync(out, { recursive: true })
const browser = await chromium.launch({ headless: true, args: ["--enable-gpu", "--ignore-gpu-blocklist", "--use-angle=d3d11"] })
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } })
const scripts = []
page.on("response", r => { const u = r.url(); if (/\.(js|mjs|glsl|frag|vert|wasm)(\?|$)/.test(u)) scripts.push(`${r.status()} ${u}`) })
await page.goto("https://engaged.be/", { waitUntil: "networkidle", timeout: 120000 })
await page.waitForTimeout(4000)
await page.mouse.move(800, 450)
const info = await page.evaluate(() => ({
  height: document.documentElement.scrollHeight,
  inner: innerHeight,
  canvases: [...document.querySelectorAll("canvas")].map(c => ({ w: c.width, h: c.height, cls: c.className, parent: c.parentElement?.className, ctx: c.getContext("webgl2") ? "webgl2?" : "?" })),
  bodyClass: document.body.className,
  scroller: [...document.querySelectorAll("[data-scroll-container], .smooth-wrapper, #smooth-wrapper, .lenis")].map(e => e.className),
  globals: Object.keys(window).filter(k => /three|gsap|lenis|scroll|pixi|ogl|webgl/i.test(k)),
}))
writeFileSync(out + "info.json", JSON.stringify({ info, scripts }, null, 2))
console.log(JSON.stringify(info, null, 2))
const steps = Number(process.env.STEPS ?? 28)
for (let i = 0; i <= steps; i++) {
  await page.mouse.wheel(0, i === 0 ? 0 : Number(process.env.DELTA ?? 400))
  await page.waitForTimeout(1400)
  await page.screenshot({ path: `${out}s${String(i).padStart(2, "0")}.jpg`, type: "jpeg", quality: 70 })
}
await browser.close()
