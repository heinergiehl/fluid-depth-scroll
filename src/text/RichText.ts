import * as THREE from "three"
import { Text } from "troika-three-text"
import { FONTS, type FontName } from "./fonts"

// Multi-font text for WebGL. troika renders one font per Text object, so headlines that mix the
// sans with the serif italic ("Interfaces that feel *alive*.") are set word by word: every run is
// its own Text, measured after troika has laid it out, then placed on shared baselines with
// greedy line breaking. Plain paragraphs use a single Text (troika wraps those itself).
//
// Units: everything is in the group's local units; the HUD scales the group so 1 unit = 1 CSS px.

export interface RichTextOptions {
  size: number // font size (px)
  maxWidth: number // line length (px)
  lineHeight?: number // in em
  align?: "left" | "center"
  font?: FontName // for plain runs
  italicFont?: FontName // for *runs*
  italicScale?: number // serif italic is set a little larger, like the CSS (1.08em)
  color?: THREE.ColorRepresentation
  italicColors?: THREE.ColorRepresentation[] // per italic run, in order (falls back to color)
  letterSpacing?: number // em
  lines?: number[] | null // line index per word, taken from the HTML (otherwise greedy wrapping)
}

interface Run {
  text: Text
  italic: boolean
  width: number
}

// A word: one or more runs set without spaces between them ("*alive*." = 2 runs).
type Word = Run[]

const SPACE_EM = 0.26
// Inter Tight vertical metrics (em): the CSS line box centres ascent + descent in the line height.
const ASCENT = 0.969
const DESCENT = 0.242

// Shared base material: no depth (text always reads on top), not tone mapped here (the
// composite tone maps the whole frame).
const baseMaterial = new THREE.MeshBasicMaterial({ transparent: true, depthTest: false, depthWrite: false, toneMapped: false })

export class RichText extends THREE.Group {
  private readonly words: Word[] = []
  private readonly runs: Run[] = []
  private readonly options: Required<Omit<RichTextOptions, "italicColors" | "lines">> & {
    italicColors: THREE.ColorRepresentation[]
    lines: number[] | null
  }
  private pending = 0
  private ready = false
  private onReady: (() => void) | null = null
  // Bounds of the laid-out block (px), y down from the top line's cap height.
  width = 0
  height = 0
  private opacity = 1
  private blur = 0

  constructor(source: string, options: RichTextOptions) {
    super()
    this.options = {
      lineHeight: 1,
      align: "left",
      font: "sansMedium",
      italicFont: "serifItalic",
      italicScale: 1.08,
      color: 0xf4f1ff,
      letterSpacing: -0.03,
      ...options,
      italicColors: options.italicColors ?? [],
      lines: options.lines ?? null,
    }
    let italicIndex = 0
    for (const token of source.split(/\s+/).filter(Boolean)) {
      const word: Word = []
      // Split "*alive*." into ["alive" (italic), "."].
      for (const part of token.split(/(\*[^*]+\*)/).filter(Boolean)) {
        const italic = part.startsWith("*") && part.endsWith("*")
        const t = new Text()
        t.text = italic ? part.slice(1, -1) : part
        t.font = FONTS[italic ? this.options.italicFont : this.options.font]
        t.anchorX = "left"
        t.anchorY = "bottom-baseline"
        t.material = baseMaterial
        t.renderOrder = 30
        t.frustumCulled = false
        const color = italic ? (this.options.italicColors[italicIndex++] ?? this.options.color) : this.options.color
        t.color = new THREE.Color(color)
        const run: Run = { text: t, italic, width: 0 }
        word.push(run)
        this.runs.push(run)
        this.add(t)
      }
      this.words.push(word)
    }
    this.setSize(options.size, options.maxWidth)
  }

  // Calls back once every run has been laid out by troika (immediately if already).
  whenReady(callback: () => void) {
    if (this.ready) callback()
    else this.onReady = callback
  }

  configure(options: Partial<Pick<RichTextOptions, "lineHeight" | "letterSpacing" | "italicScale" | "lines">>) {
    Object.assign(this.options, options)
  }

  setSize(size: number, maxWidth: number) {
    this.options.size = size
    this.options.maxWidth = maxWidth
    this.ready = false
    this.pending = this.runs.length
    for (const run of this.runs) {
      run.text.fontSize = size * (run.italic ? this.options.italicScale : 1)
      run.text.letterSpacing = run.italic ? 0 : this.options.letterSpacing
      run.text.sync(() => {
        const b = run.text.textRenderInfo?.blockBounds
        run.width = b ? b[2] - b[0] : 0
        if (--this.pending === 0) this.layout()
      })
    }
  }

  private layout() {
    const { size, maxWidth, lineHeight, align } = this.options
    const space = size * SPACE_EM
    const lines: { words: Word[]; width: number }[] = [{ words: [], width: 0 }]
    // Same breaks as the HTML when known (font metrics differ by a hair, enough to wrap a
    // different word in a narrow headline); greedy wrapping otherwise.
    const given = this.options.lines && this.options.lines.length === this.words.length ? this.options.lines : null
    this.words.forEach((word, k) => {
      const w = word.reduce((sum, r) => sum + r.width, 0)
      const line = lines[lines.length - 1]
      const next = line.words.length ? line.width + space + w : w
      const breakHere = given ? k > 0 && given[k] !== given[k - 1] : next > maxWidth && line.words.length > 0
      if (breakHere) lines.push({ words: [word], width: w })
      else {
        line.words.push(word)
        line.width = next
      }
    })
    const step = size * lineHeight
    this.width = Math.max(...lines.map(l => l.width))
    this.height = step * lines.length
    lines.forEach((line, i) => {
      let x = align === "center" ? -line.width / 2 : 0
      const y = -((step - (ASCENT + DESCENT) * size) / 2 + ASCENT * size + i * step) // baseline of line i, like CSS
      for (const word of line.words) {
        for (const run of word) {
          run.text.position.set(x, y, 0)
          x += run.width
        }
        x += space
      }
    })
    this.ready = true
    this.applyLook()
    const cb = this.onReady
    this.onReady = null
    cb?.()
  }

  // opacity 0..1; blur 0..1 (0 = sharp). Blur is drawn as a soft halo that replaces the fill.
  setLook(opacity: number, blur = 0) {
    if (opacity === this.opacity && blur === this.blur) return
    this.opacity = opacity
    this.blur = blur
    this.applyLook()
  }

  private applyLook() {
    const visible = this.ready && this.opacity > 0.003
    this.visible = visible
    if (!visible) return
    for (const run of this.runs) {
      const t = run.text
      if (this.blur > 0.01) {
        t.outlineBlur = `${(this.blur * 22).toFixed(1)}%`
        t.outlineWidth = `${(this.blur * 6).toFixed(1)}%`
        t.outlineColor = t.color as THREE.Color
        t.outlineOpacity = this.opacity * (0.35 + 0.25 * (1 - this.blur))
        t.fillOpacity = this.opacity * (1 - this.blur) ** 2
      } else {
        t.outlineWidth = 0
        t.outlineBlur = 0
        t.fillOpacity = this.opacity
      }
    }
  }

  dispose() {
    for (const run of this.runs) run.text.dispose()
  }
}

// A plain block of one font: troika wraps it. Same look controls as RichText.
export class PlainText extends THREE.Group {
  readonly text = new Text()
  private opacity = 1
  private ready = false
  private onReady: (() => void) | null = null

  constructor(source: string, options: { size: number; maxWidth: number; font?: FontName; color?: THREE.ColorRepresentation; lineHeight?: number; letterSpacing?: number; align?: "left" | "center"; uppercase?: boolean }) {
    super()
    const t = this.text
    t.text = options.uppercase ? source.toUpperCase() : source
    t.font = FONTS[options.font ?? "sans"]
    t.anchorX = options.align === "center" ? "center" : "left"
    t.anchorY = "top"
    t.textAlign = options.align ?? "left"
    t.lineHeight = options.lineHeight ?? 1.5
    t.letterSpacing = options.letterSpacing ?? 0
    t.color = new THREE.Color(options.color ?? 0xf4f1ff)
    t.material = baseMaterial
    t.renderOrder = 30
    t.frustumCulled = false
    this.add(t)
    this.setSize(options.size, options.maxWidth)
  }

  setSize(size: number, maxWidth: number) {
    this.text.fontSize = size
    this.text.maxWidth = maxWidth
    this.ready = false
    this.text.sync(() => {
      this.ready = true
      this.setLook(this.opacity)
      const cb = this.onReady
      this.onReady = null
      cb?.()
    })
  }

  whenReady(callback: () => void) {
    if (this.ready) callback()
    else this.onReady = callback
  }

  get height() {
    const b = this.text.textRenderInfo?.blockBounds
    return b ? b[3] - b[1] : 0
  }

  setLook(opacity: number) {
    this.opacity = opacity
    this.visible = this.ready && opacity > 0.003
    this.text.fillOpacity = opacity
  }

  dispose() {
    this.text.dispose()
  }
}
