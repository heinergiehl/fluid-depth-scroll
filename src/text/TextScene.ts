import * as THREE from "three"
import { preloadFont } from "troika-three-text"
import type { Look, Overlay } from "../overlay/Overlay"
import type { Hud } from "./Hud"
import { FONTS, type FontName } from "./fonts"
import { PlainText, RichText } from "./RichText"

// Draws the page's text in WebGL. The HTML stays the source of truth for content and layout:
// every element marked `.gl` is measured (position, size, font, line height, letter spacing,
// alignment) and a troika text is set in its place. The HTML is then painted transparent (it is
// still there for crawlers, screen readers, selection and find-in-page). Per frame the texts take
// the same section looks as the HTML (opacity, offset, blur), so both move together.

interface Style {
  color: number
  alpha?: number
  italicColors?: number[]
}

const INK = 0xf4f1ff
const LAVENDER = 0xc9bcff
const CYAN = 0x3ee6ff

const STYLES: Record<string, Style> = {
  "hero-title": { color: INK, alpha: 0.8 },
  "hero-sub": { color: INK, alpha: 0.72 },
  "statement-title": { color: INK, italicColors: [LAVENDER, CYAN] },
  "statement-body": { color: INK, alpha: 0.72 },
  "card-kicker": { color: CYAN },
  "card-title": { color: INK },
  "card-tags": { color: LAVENDER },
  "contact-title": { color: INK, italicColors: [CYAN] },
  label: { color: LAVENDER },
  "project-kicker": { color: CYAN },
  "project-title": { color: INK, italicColors: [CYAN] },
  "project-tagline": { color: INK, alpha: 0.92 },
  "project-summary": { color: INK, alpha: 0.68 },
  "project-highlight": { color: INK, alpha: 0.85 },
  "project-stack": { color: LAVENDER },
}

interface Item {
  el: HTMLElement
  text: RichText | PlainText
  look: () => Look
  alpha: number
  align: "left" | "center"
  left: number
  top: number
  hidden: boolean // display: none in the current layout
  dot: THREE.Mesh | null // list bullet drawn in WebGL (it must move with the liquid like the text)
  dotX: number
  dotY: number
}

// Glowing list bullet: a cyan core with a soft halo, like the CSS dot with its box-shadow.
const DOT_PX = 26 // quad size; the core is 6 px
const dotGeometry = new THREE.PlaneGeometry(1, 1)
const dotMaterial = new THREE.ShaderMaterial({
  uniforms: { uColor: { value: new THREE.Color(0x3ee6ff) }, uOpacity: { value: 1 } },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: /* glsl */ `
    uniform vec3 uColor;
    uniform float uOpacity;
    varying vec2 vUv;
    void main() {
      float r = length(vUv - 0.5) * ${DOT_PX.toFixed(1)}; // px from the centre
      float core = 1.0 - smoothstep(2.4, 3.4, r);
      float halo = exp(-r * r / 40.0) * 0.55;
      float a = max(core, halo) * uOpacity;
      if (a < 0.003) discard;
      gl_FragColor = vec4(uColor * (core * 1.3 + halo), a);
    }
  `,
  transparent: true,
  depthTest: false,
  depthWrite: false,
  toneMapped: false,
})

// Element content with <em> runs as *asterisks* (RichText's markup).
function source(el: HTMLElement) {
  if (el.tagName === "UL") return [...el.querySelectorAll("li")].map(li => li.textContent ?? "").join("  •  ")
  let s = ""
  el.childNodes.forEach(n => {
    if (n.nodeType === Node.TEXT_NODE) s += n.textContent
    else if ((n as HTMLElement).tagName === "EM") s += `*${n.textContent}*`
    else s += n.textContent
  })
  return s.replace(/\s+/g, " ").trim()
}

// Line index of every word of an element as the browser laid it out (words in DOM order, the
// same order RichText splits its source into).
function wordLines(el: HTMLElement) {
  const tops: number[] = []
  const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT)
  const range = document.createRange()
  let prevSpace = true
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    const t = n.textContent ?? ""
    for (let i = 0; i < t.length; i++) {
      const space = /\s/.test(t[i])
      if (!space && prevSpace) {
        range.setStart(n, i)
        range.setEnd(n, i + 1)
        tops.push(range.getBoundingClientRect().top)
      }
      prevSpace = space
    }
  }
  // Glyph boxes of mixed fonts / sizes start at different heights on the same line, so a new
  // line needs a jump of half the font size.
  const step = parseFloat(getComputedStyle(el).fontSize) * 0.5
  const lines: number[] = []
  let line = 0
  let lineTop = tops[0] ?? 0
  for (const top of tops) {
    if (top > lineTop + step) {
      line++
      lineTop = top
    }
    lines.push(line)
  }
  return lines
}

function fontFor(weight: number): FontName {
  return weight >= 600 ? "sansSemibold" : weight >= 500 ? "sansMedium" : "sans"
}

export class TextScene {
  private items: Item[] = []
  private ready = false
  private built = false // init() has created the texts; before that the HTML text stays visible
  private layoutQueued = false

  constructor(
    private readonly hud: Hud,
    private readonly overlay: Overlay,
  ) {}

  // Fonts first (HTML metrics and troika glyphs), then build.
  async init() {
    await document.fonts.ready
    await Promise.all(
      (Object.keys(FONTS) as FontName[]).map(f => new Promise<void>(resolve => preloadFont({ font: FONTS[f], characters: "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789.,-*•'’" }, resolve))),
    )
    this.rebuild()
  }

  // Recreate the texts for the views currently in the DOM (after navigation).
  rebuild() {
    for (const item of this.items) {
      this.hud.remove(item.text)
      item.text.dispose()
      if (item.dot) {
        this.hud.remove(item.dot)
        ;(item.dot.material as THREE.Material).dispose()
      }
    }
    this.items = []
    const roots = [this.overlay.homeElement, this.overlay.projectElement].filter(Boolean) as HTMLElement[]
    for (const root of roots) {
      for (const el of root.querySelectorAll<HTMLElement>(".gl")) this.items.push(this.create(el))
    }
    this.built = true
    this.layout()
  }

  private create(el: HTMLElement): Item {
    const key = el.dataset.gl ?? ""
    const style = STYLES[key] ?? { color: INK }
    const cs = getComputedStyle(el)
    const size = parseFloat(cs.fontSize)
    const weight = parseInt(cs.fontWeight, 10) || 400
    const upper = cs.textTransform === "uppercase"
    const align = cs.textAlign === "center" ? "center" : "left"
    const text = source(el)
    const rich = /\*/.test(text) || el.classList.contains("display") || key.endsWith("title")
    let obj: RichText | PlainText
    if (rich) {
      obj = new RichText(text, {
        size,
        maxWidth: 1e4,
        align,
        font: fontFor(weight),
        color: style.color,
        italicColors: style.italicColors,
      })
    } else {
      obj = new PlainText(text, { size, maxWidth: 1e4, font: fontFor(weight), color: style.color, align, uppercase: upper })
      if (el.tagName === "UL") {
        // Cyan separator dots, like the HTML list.
        const ranges: Record<number, number> = { 0: style.color }
        const s = obj.text.text
        for (let i = s.indexOf("•"); i >= 0; i = s.indexOf("•", i + 1)) {
          ranges[i] = CYAN
          ranges[i + 1] = style.color
        }
        obj.text.colorRanges = ranges
      }
    }
    this.hud.add(obj)
    let dot: THREE.Mesh | null = null
    if (el.matches(".project-highlights li")) {
      dot = new THREE.Mesh(dotGeometry, dotMaterial.clone()) // own opacity per bullet
      dot.scale.setScalar(DOT_PX)
      dot.renderOrder = 30
      dot.frustumCulled = false
      this.hud.add(dot)
    }
    return { el, text: obj, look: this.lookFor(el), alpha: style.alpha ?? 1, align, left: 0, top: 0, hidden: false, dot, dotX: 0, dotY: 0 }
  }

  private lookFor(el: HTMLElement): () => Look {
    const L = this.overlay.looks
    if (el.closest("[data-view=project]")) return () => L.project
    const card = el.closest<HTMLElement>(".card-info")
    if (card) {
      const i = Number(card.dataset.index)
      return () => L.cards[i]
    }
    if (el.closest(".hero")) return () => L.hero
    if (el.closest(".statement")) return () => L.statement
    if (el.closest(".contact")) return () => L.contact
    return () => L.home
  }

  // Measure the HTML (with section transforms neutralised) and size / place the WebGL texts.
  layout() {
    this.layoutQueued = false
    const sections = [...document.querySelectorAll<HTMLElement>("#overlay section, #overlay .card-info, #overlay [data-view]")]
    const saved = sections.map(s => s.style.transform)
    sections.forEach(s => (s.style.transform = "none"))
    const measures = this.items.map(item => {
      const r = item.el.getBoundingClientRect()
      const cs = getComputedStyle(item.el)
      // Text starts at the content box (an <li> is indented for its bullet).
      const padL = parseFloat(cs.paddingLeft) || 0
      const padR = parseFloat(cs.paddingRight) || 0
      const padT = parseFloat(cs.paddingTop) || 0
      const size = parseFloat(cs.fontSize)
      const lh = cs.lineHeight === "normal" ? 1.2 : parseFloat(cs.lineHeight) / size
      const ls = cs.letterSpacing === "normal" ? 0 : parseFloat(cs.letterSpacing) / size
      const em = item.el.querySelector("em")
      const italicScale = em ? parseFloat(getComputedStyle(em).fontSize) / size : 1.08
      const lines = item.text instanceof RichText ? wordLines(item.el) : null
      // Bullet centre, from the ::before box (left 2px, top 0.55em, 6 x 6 px).
      const dotX = r.left + 5
      const dotY = r.top + 0.55 * parseFloat(cs.fontSize) + 3
      return { r, size, lh, ls, italicScale, lines, padL, padR, padT, dotX, dotY }
    })
    sections.forEach((s, i) => (s.style.transform = saved[i]))

    let pending = this.items.length
    const done = () => {
      if (--pending > 0 || !this.built) return
      if (!this.ready) {
        this.ready = true
        document.body.classList.add("gl-text")
      }
    }
    if (!pending) done()
    this.items.forEach((item, i) => {
      const m = measures[i]
      item.hidden = m.r.width === 0 && m.r.height === 0
      const contentLeft = m.r.left + m.padL
      const contentWidth = m.r.width - m.padL - m.padR
      item.left = item.align === "center" ? contentLeft + contentWidth / 2 : contentLeft
      item.top = m.r.top + m.padT
      item.dotX = m.dotX
      item.dotY = m.dotY
      const width = Math.max(contentWidth, 1) * 1.02 + 1 // plain text: a hair of slack against early wraps
      if (item.text instanceof RichText) {
        item.text.configure({ lineHeight: m.lh, letterSpacing: m.ls, italicScale: m.italicScale, lines: m.lines })
        item.text.setSize(m.size, width)
        item.text.whenReady(done)
      } else {
        item.text.text.lineHeight = m.lh
        item.text.text.letterSpacing = m.ls
        item.text.setSize(m.size, width)
        item.text.whenReady(done)
      }
    })
  }

  // Layout after the browser has applied pending style changes (resize, route change).
  queueLayout() {
    if (this.layoutQueued) return
    this.layoutQueued = true
    requestAnimationFrame(() => this.layout())
  }

  update() {
    for (const item of this.items) {
      const l = item.look()
      const opacity = item.hidden ? 0 : l.opacity * item.alpha
      this.hud.place(item.text, item.left + l.x, item.top + l.y)
      if (item.dot) {
        this.hud.place(item.dot, item.dotX + l.x, item.dotY + l.y)
        ;(item.dot.material as THREE.ShaderMaterial).uniforms.uOpacity.value = opacity
        item.dot.visible = opacity > 0.003
      }
      if (item.text instanceof RichText) item.text.setLook(opacity, l.blur)
      else item.text.setLook(opacity)
    }
  }
}
