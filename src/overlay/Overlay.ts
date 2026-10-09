import type { TimelineState } from "../core/timeline"
import { cards, contact, hero, statement } from "../content"

// Thin HTML layer over the canvas: real, selectable, focusable text. Every frame it reads the same
// TimelineState as the WebGL scene, so opacity / position / blur stay in lockstep with the 3D.

// "*word*" -> <em>word</em> (serif italic), everything else escaped.
function rich(text: string) {
  const esc = text.replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!)
  return esc.replace(/\*([^*]+)\*/g, "<em>$1</em>")
}

const pad = (n: number) => String(n).padStart(2, "0")

// Writes a style only when it changed (avoids style recalcs on idle frames).
class Styler {
  private last = new Map<string, string>()
  constructor(private readonly el: HTMLElement) {}
  set(prop: string, value: string) {
    if (this.last.get(prop) === value) return
    this.last.set(prop, value)
    this.el.style.setProperty(prop, value)
  }
  // Fully transparent sections leave the accessibility tree and the tab order.
  visible(opacity: number) {
    this.set("opacity", opacity.toFixed(3))
    this.set("visibility", opacity < 0.01 ? "hidden" : "visible")
  }
}

export interface OverlayActions {
  scrollTo(p: number): void
}

export class Overlay {
  private readonly hero: Styler
  private readonly hint: Styler
  private readonly statement: Styler
  private readonly cardInfos: Styler[] = []
  private readonly cardsUi: Styler
  private readonly counter: HTMLElement
  private readonly contact: Styler
  private lastFocus = -1

  constructor(root: HTMLElement, actions: OverlayActions, cardsStart: number) {
    root.innerHTML = `
      <header class="bar">
        <span class="brand">Heiner<span class="brand-dot">.</span>Develops</span>
        <button class="pill pill-cyan" data-go="contact">Get in touch</button>
      </header>

      <section class="hero" aria-label="Intro">
        <h1 class="display">${rich(hero.title)}</h1>
        <p class="hero-sub">${rich(hero.sub)}</p>
      </section>
      <div class="scroll-hint" aria-hidden="true"><span class="scroll-dot"></span>Scroll</div>

      <section class="statement" aria-label="About">
        <h2 class="display">${rich(statement.title)}</h2>
        <div class="statement-side">
          <p>${rich(statement.body)}</p>
          <button class="pill pill-outline" data-go="cards">${statement.cta}<span class="pill-arrow" aria-hidden="true">›</span></button>
        </div>
      </section>

      <section class="cards" aria-label="Projects">
        ${cards
          .map(
            (c, i) => `
          <article class="card-info" data-index="${i}">
            <p class="kicker">${rich(c.kicker)}</p>
            <h3 class="card-title">${rich(c.title)}</h3>
            <ul class="tags">${c.tags.map(t => `<li>${rich(t)}</li>`).join("")}</ul>
            ${c.href ? `<a class="pill pill-light case" href="${c.href}">Open case study<span class="pill-arrow" aria-hidden="true">›</span></a>` : ""}
          </article>`,
          )
          .join("")}
      </section>
      <div class="cards-ui" aria-hidden="true"><span class="counter"></span><span class="counter-line"></span><span>${pad(cards.length)}</span></div>

      <section class="contact" aria-label="Contact">
        <h2 class="display">${rich(contact.title)}</h2>
        <p class="label">Email</p>
        <a class="contact-mail" href="mailto:${contact.email}">${contact.email}</a>
        <p class="label">Follow</p>
        <ul class="socials">${contact.socials.map(s => `<li><a href="${s.href}">${s.label}</a></li>`).join("")}</ul>
      </section>
    `
    const q = <T extends HTMLElement>(sel: string) => root.querySelector(sel) as T
    this.hero = new Styler(q(".hero"))
    this.hint = new Styler(q(".scroll-hint"))
    this.statement = new Styler(q(".statement"))
    root.querySelectorAll<HTMLElement>(".card-info").forEach(el => this.cardInfos.push(new Styler(el)))
    this.cardsUi = new Styler(q(".cards-ui"))
    this.counter = q(".counter")
    this.contact = new Styler(q(".contact"))

    root.querySelectorAll<HTMLElement>("[data-go]").forEach(el =>
      el.addEventListener("click", () => actions.scrollTo(el.dataset.go === "contact" ? 1 : cardsStart)),
    )
  }

  update(st: TimelineState) {
    this.hero.visible(st.heroText)
    this.hero.set("transform", `translate3d(0, ${st.heroTextY.toFixed(1)}px, 0)`)
    this.hero.set("filter", st.heroText > 0.99 ? "none" : `blur(${((1 - st.heroText) * 8).toFixed(1)}px)`)
    this.hint.visible(st.scrollHint)

    this.statement.visible(st.statementText)
    this.statement.set("transform", `translate3d(0, ${st.statementY.toFixed(1)}px, 0)`)
    const blur = st.statementBlur
    this.statement.set(
      "filter",
      blur < 0.05 && st.statementDim < 0.01 ? "none" : `blur(${blur.toFixed(1)}px) brightness(${(1 - 0.55 * st.statementDim).toFixed(2)})`,
    )

    for (let i = 0; i < this.cardInfos.length; i++) {
      const w = i === st.focusIndex ? st.focusWeight : 0
      this.cardInfos[i].visible(w)
      this.cardInfos[i].set("transform", `translate3d(0, ${((1 - w) * 18).toFixed(1)}px, 0)`)
    }
    this.cardsUi.visible(st.cardsUi)
    if (st.focusIndex !== this.lastFocus) {
      this.lastFocus = st.focusIndex
      this.counter.textContent = pad(st.focusIndex + 1)
    }

    this.contact.visible(st.contact)
    this.contact.set("transform", `translate3d(${((1 - st.contact) * 40).toFixed(1)}px, 0, 0)`)
  }
}
