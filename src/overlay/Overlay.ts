import type { TimelineState } from "../core/timeline"
import { headMarkup, homeMarkup, projectMarkup, type Route } from "../markup"

// The HTML layer over the canvas. Its markup is pre-rendered (src/markup.ts); this class only
// animates it. Every frame it turns the TimelineState into a "look" per section (opacity, offset,
// blur). Visible HTML (buttons, links) applies the look through CSS; the WebGL text reads the same
// looks, so both stay in lockstep with the 3D scene.

export interface Look {
  opacity: number
  x: number // px
  y: number // px
  blur: number // 0..1
  dim: number // 0..1 darkening
}

const look = (): Look => ({ opacity: 0, x: 0, y: 0, blur: 0, dim: 0 })

// Writes a style only when it changed (avoids style recalcs on idle frames).
class Styler {
  private last = new Map<string, string>()
  constructor(readonly el: HTMLElement) {}
  set(prop: string, value: string) {
    if (this.last.get(prop) === value) return
    this.last.set(prop, value)
    this.el.style.setProperty(prop, value)
  }
  // Fully transparent sections leave the accessibility tree and the tab order.
  // CSS blur is only used while the HTML text is visible (no WebGL text): once WebGL draws the
  // text, the filter would only blur transparent glyphs, and it is costly on phones.
  static cssBlur = true
  apply(l: Look, maxBlurPx = 0) {
    this.set("opacity", l.opacity.toFixed(3))
    this.set("visibility", l.opacity < 0.01 ? "hidden" : "visible")
    this.set("transform", l.x || l.y ? `translate3d(${l.x.toFixed(1)}px, ${l.y.toFixed(1)}px, 0)` : "none")
    const blur = Styler.cssBlur ? l.blur * maxBlurPx : 0
    const dim = Styler.cssBlur ? l.dim : 0
    this.set("filter", blur < 0.05 && dim < 0.01 ? "none" : `blur(${blur.toFixed(1)}px) brightness(${(1 - 0.55 * dim).toFixed(2)})`)
  }
}

export interface OverlayActions {
  scrollTo(target: "cards" | "contact"): void
}

const pad = (n: number) => String(n).padStart(2, "0")

export class Overlay {
  // Section looks, read by the WebGL text as well.
  readonly looks = {
    hero: look(),
    statement: look(),
    cards: [] as Look[],
    contact: look(),
    project: look(),
    home: look(), // the whole home view (fades during the project transition)
    hint: look(),
    cardsUi: look(),
  }
  private home!: HTMLElement
  private project: HTMLElement | null = null
  private stylers = new Map<string, Styler>()
  private cardStylers: Styler[] = []
  private counter: HTMLElement | null = null
  private lastFocus = -1
  homeAlpha = 1 // set by the project transition
  projectAlpha = 0
  projectScroll = 0 // px, when the project page is taller than the screen

  constructor(
    private readonly root: HTMLElement,
    private readonly actions: OverlayActions,
    route: Route,
  ) {
    // A pre-rendered project page has no home view yet (and vice versa): add what is missing.
    if (!root.querySelector("[data-view=home]")) root.insertAdjacentHTML("beforeend", homeMarkup())
    this.bindHome()
    if (route.name === "project") this.showProject(route)

    root.addEventListener("click", e => {
      const el = (e.target as HTMLElement | null)?.closest<HTMLElement>("[data-go]")
      if (!el) return
      e.preventDefault()
      this.actions.scrollTo(el.dataset.go === "contact" ? "contact" : "cards")
    })
  }

  private bindHome() {
    this.home = this.root.querySelector<HTMLElement>("[data-view=home]")!
    const q = (sel: string) => this.home.querySelector<HTMLElement>(sel)!
    this.stylers.set("hero", new Styler(q(".hero")))
    this.stylers.set("hint", new Styler(q(".scroll-hint")))
    this.stylers.set("statement", new Styler(q(".statement")))
    this.stylers.set("cardsUi", new Styler(q(".cards-ui")))
    this.stylers.set("contact", new Styler(q(".contact")))
    this.stylers.set("home", new Styler(this.home))
    this.cardStylers = [...this.home.querySelectorAll<HTMLElement>(".card-info")].map(el => new Styler(el))
    this.looks.cards = this.cardStylers.map(() => look())
    this.counter = q(".counter")
  }

  // Puts the project view for this route in place (replacing another project's view).
  showProject(route: Extract<Route, { name: "project" }>) {
    const slug = route.project.slug
    if (this.project?.dataset.slug !== slug) {
      this.project?.remove()
      let el = this.root.querySelector<HTMLElement>(`[data-view=project][data-slug="${slug}"]`)
      if (!el) {
        this.root.querySelector("[data-view=project]")?.remove()
        this.root.insertAdjacentHTML("beforeend", projectMarkup(route.project))
        el = this.root.querySelector<HTMLElement>("[data-view=project]")!
      }
      this.project = el
      this.stylers.set("project", new Styler(el))
    }
    this.updateHead(route)
  }

  get projectElement() {
    return this.project
  }

  get homeElement() {
    return this.home
  }

  updateHead(route: Route) {
    // Keep the document head in sync for the browser UI (title, share); crawlers get the static pages.
    const tmp = document.createElement("template")
    tmp.innerHTML = headMarkup(route)
    const title = tmp.content.querySelector("title")?.textContent
    if (title) document.title = title
    for (const sel of ['meta[name="description"]', 'link[rel="canonical"]', 'meta[property="og:title"]', 'meta[property="og:description"]', 'meta[property="og:url"]', 'meta[property="og:image"]']) {
      const next = tmp.content.querySelector(sel)
      const current = document.head.querySelector(sel)
      if (next && current) current.replaceWith(next)
    }
  }

  update(st: TimelineState) {
    Styler.cssBlur = !document.body.classList.contains("gl-text")
    const L = this.looks
    const h = this.homeAlpha

    set(L.hero, st.heroText * h, 0, st.heroTextY, 1 - st.heroText, 0)
    set(L.hint, st.scrollHint * h, 0, 0, 0, 0)
    set(L.statement, st.statementText * h, 0, st.statementY, Math.min(st.statementBlur / 14, 1), st.statementDim)
    for (let i = 0; i < L.cards.length; i++) {
      const w = i === st.focusIndex ? st.focusWeight : 0
      set(L.cards[i], w * h, 0, (1 - w) * 18, 0, 0)
    }
    set(L.cardsUi, st.cardsUi * h, 0, 0, 0, 0)
    set(L.contact, st.contact * h, (1 - st.contact) * 40, 0, 0, 0)
    set(L.home, h, 0, 0, 0, 0)
    set(L.project, this.projectAlpha, 0, (1 - this.projectAlpha) * 24 - this.projectScroll, 1 - this.projectAlpha, 0)

    this.stylers.get("hero")!.apply(L.hero, 8)
    this.stylers.get("hint")!.apply(L.hint)
    this.stylers.get("statement")!.apply(L.statement, 14)
    this.cardStylers.forEach((s, i) => s.apply(L.cards[i]))
    this.stylers.get("cardsUi")!.apply(L.cardsUi)
    this.stylers.get("contact")!.apply(L.contact)
    this.stylers.get("home")!.set("visibility", h < 0.01 ? "hidden" : "visible")
    this.stylers.get("project")?.apply(L.project, 10)

    if (st.focusIndex !== this.lastFocus && this.counter) {
      this.lastFocus = st.focusIndex
      this.counter.textContent = pad(st.focusIndex + 1)
    }
  }
}

function set(l: Look, opacity: number, x: number, y: number, blur: number, dim: number) {
  l.opacity = opacity
  l.x = x
  l.y = y
  l.blur = blur
  l.dim = dim
}
