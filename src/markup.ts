import { contact, hero, projects, site, statement, type Project } from "./content"

// Semantic HTML for every route, as plain strings: no DOM, no three. The Vite plugin pre-renders
// it into the static HTML (what crawlers and link previews read), and the app reuses it when it
// navigates without a reload. Text that WebGL draws carries the class `gl`: it stays in the DOM
// and in the layout (the WebGL text copies its position and size) but is painted transparent once
// the WebGL text is up.

export type Route = { name: "home" } | { name: "project"; project: Project }

export function parseRoute(pathname: string): Route {
  const m = pathname.match(/^\/projects\/([^/]+)\/?$/)
  const project = m ? projects.find(p => p.slug === m[1]) : undefined
  return project ? { name: "project", project } : { name: "home" }
}

export const pathOf = (route: Route) => (route.name === "home" ? "/" : `/projects/${route.project.slug}`)

const esc = (s: string) => s.replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!)

// "*word*" -> <em>word</em> (serif italic), everything else escaped.
export const rich = (text: string) => esc(text).replace(/\*([^*]+)\*/g, "<em>$1</em>")
export const plain = (text: string) => text.replace(/\*/g, "")

const pad = (n: number) => String(n).padStart(2, "0")
const external = (l: { label: string; href: string }, cls: string) =>
  `<a class="${cls}" href="${esc(l.href)}" target="_blank" rel="noopener">${esc(l.label)}<span class="pill-arrow" aria-hidden="true">↗</span></a>`

// --- Head ---------------------------------------------------------------------------------------

export function headMarkup(route: Route) {
  const isHome = route.name === "home"
  const title = isHome ? `${site.owner} · Projects in liquid space` : `${route.project.name} · ${site.owner}`
  const description = isHome ? site.description : `${route.project.tagline} ${route.project.summary}`.trim()
  const url = site.url + pathOf(route)
  const image = `${site.url}/cards/${isHome ? projects[0].image : route.project.image}`
  const jsonLd = isHome
    ? {
        "@context": "https://schema.org",
        "@type": "WebSite",
        name: `${site.name} showcase`,
        url,
        author: { "@type": "Person", name: site.owner, url: site.portfolio },
        hasPart: projects.map(p => ({ "@type": "CreativeWork", name: p.name, url: site.url + `/projects/${p.slug}` })),
      }
    : {
        "@context": "https://schema.org",
        "@type": "CreativeWork",
        name: route.project.name,
        description: route.project.tagline,
        url,
        image,
        keywords: route.project.stack.join(", "),
        author: { "@type": "Person", name: site.owner, url: site.portfolio },
        sameAs: route.project.links.map(l => l.href),
      }
  return [
    `<title>${esc(title)}</title>`,
    `<meta name="description" content="${esc(description)}" />`,
    `<link rel="canonical" href="${url}" />`,
    `<meta property="og:type" content="${isHome ? "website" : "article"}" />`,
    `<meta property="og:site_name" content="${esc(site.name)}" />`,
    `<meta property="og:title" content="${esc(title)}" />`,
    `<meta property="og:description" content="${esc(description)}" />`,
    `<meta property="og:url" content="${url}" />`,
    `<meta property="og:image" content="${image}" />`,
    `<meta name="twitter:card" content="summary_large_image" />`,
    `<script type="application/ld+json">${JSON.stringify(jsonLd).replace(/</g, "\\u003c")}</script>`,
  ].join("\n    ")
}

// --- Body ---------------------------------------------------------------------------------------

export function headerMarkup() {
  return `
      <header class="bar">
        <a class="brand" href="/" data-route>Heiner<span class="brand-dot">.</span>Develops</a>
        <a class="pill pill-cyan" href="/#contact" data-go="contact">Get in touch</a>
      </header>`
}

export function homeMarkup() {
  return `
      <div class="view view-home" data-view="home">
        <section class="hero" aria-label="Intro">
          <h1 class="display gl" data-gl="hero-title">${rich(hero.title)}</h1>
          <p class="hero-sub gl" data-gl="hero-sub">${rich(hero.sub)}</p>
        </section>
        <div class="scroll-hint" aria-hidden="true"><span class="scroll-dot"></span>Scroll</div>

        <section class="statement" aria-label="About">
          <h2 class="display gl" data-gl="statement-title">${rich(statement.title)}</h2>
          <div class="statement-side">
            <p class="gl" data-gl="statement-body">${rich(statement.body)}</p>
            <a class="pill pill-outline" href="/#projects" data-go="cards">${esc(statement.cta)}<span class="pill-arrow" aria-hidden="true">›</span></a>
          </div>
        </section>

        <section class="cards" id="projects" aria-label="Projects">
          <h2 class="sr-only">Projects</h2>
          ${projects
            .map(
              (p, i) => `
          <article class="card-info" data-index="${i}">
            <p class="kicker gl" data-gl="card-kicker">${rich(p.kicker)}</p>
            <h3 class="card-title gl" data-gl="card-title">${rich(p.title)}</h3>
            <p class="sr-only">${esc(p.tagline)}</p>
            <ul class="tags gl" data-gl="card-tags">${p.stack
              .slice(0, 4)
              .map(t => `<li>${esc(t)}</li>`)
              .join("")}</ul>
            <a class="pill pill-light case" href="/projects/${p.slug}" data-route>Open project<span class="pill-arrow" aria-hidden="true">›</span></a>
          </article>`,
            )
            .join("")}
        </section>
        <div class="cards-ui" aria-hidden="true"><span class="counter">01</span><span class="counter-line"></span><span>${pad(projects.length)}</span></div>

        <section class="contact" id="contact" aria-label="Contact">
          <h2 class="display gl" data-gl="contact-title">${rich(contact.title)}</h2>
          <p class="label gl" data-gl="label">Email</p>
          <a class="contact-mail" href="mailto:${esc(contact.email)}">${esc(contact.email)}</a>
          <p class="label gl" data-gl="label">Follow</p>
          <ul class="socials">${contact.socials.map(s => `<li><a href="${esc(s.href)}" target="_blank" rel="noopener">${esc(s.label)}</a></li>`).join("")}</ul>
        </section>
      </div>`
}

export function projectMarkup(p: Project) {
  const i = projects.indexOf(p)
  const next = projects[(i + 1) % projects.length]
  return `
      <div class="view view-project" data-view="project" data-slug="${p.slug}">
        <a class="pill pill-outline back" href="/" data-route data-back><span class="pill-arrow back-arrow" aria-hidden="true">‹</span>All projects</a>
        <figure class="project-media"><img src="/cards/${p.image}" alt="${esc(p.name)} screenshot" width="1024" height="640" /></figure>
        <article class="project">
          <p class="kicker gl" data-gl="project-kicker">${rich(p.kicker)}</p>
          <h1 class="project-title display gl" data-gl="project-title">${rich(p.title)}</h1>
          <p class="project-tagline gl" data-gl="project-tagline">${esc(p.tagline)}</p>
          ${p.summary ? `<p class="project-summary gl" data-gl="project-summary">${esc(p.summary)}</p>` : ""}
          ${
            p.highlights.length
              ? `<h2 class="label label-highlights gl" data-gl="label">Highlights</h2>
          <ul class="project-highlights">${p.highlights.map(h => `<li class="gl" data-gl="project-highlight">${esc(h)}</li>`).join("")}</ul>`
              : ""
          }
          <h2 class="label gl" data-gl="label">Stack</h2>
          <p class="project-stack gl" data-gl="project-stack">${p.stack.map(esc).join(" · ")}</p>
          <div class="project-links">${p.links.map((l, k) => external(l, k === 0 ? "pill pill-cyan" : "pill pill-outline")).join("")}</div>
          <a class="pill next" href="/projects/${next.slug}" data-route>Next: ${esc(next.name)}<span class="pill-arrow" aria-hidden="true">›</span></a>
        </article>
      </div>`
}

export function bodyMarkup(route: Route) {
  return headerMarkup() + (route.name === "home" ? homeMarkup() : projectMarkup(route.project))
}
