import { defineConfig, type Plugin } from "vite"
import { mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { resolve } from "node:path"
import { projects, site } from "./src/content"
import { bodyMarkup, headMarkup, parseRoute, pathOf, type Route } from "./src/markup"

// Pre-renders the semantic HTML (head tags + text) for every route, so crawlers and link previews
// get real content without running JavaScript:
// - dev: index.html is filled for whatever URL is requested (/, /projects/<slug>).
// - build: dist/index.html for /, dist/projects/<slug>/index.html per project, sitemap, robots.
const HEAD = "<!--app-head-->"
const BODY = "<!--app-body-->"

function fill(html: string, route: Route) {
  return html.replace(HEAD, headMarkup(route)).replace(BODY, bodyMarkup(route))
}

function prerender(): Plugin {
  let template = ""
  let outDir = "dist"
  return {
    name: "prerender-routes",
    configResolved(config) {
      outDir = resolve(config.root, config.build.outDir)
    },
    transformIndexHtml: {
      order: "post",
      handler(html, ctx) {
        template = html // the final template, with the built asset tags
        const url = ctx.originalUrl ?? "/"
        return fill(html, parseRoute(new URL(url, "http://x").pathname))
      },
    },
    closeBundle() {
      if (!template.includes(BODY)) return // dev server or nothing built
      for (const project of projects) {
        const route: Route = { name: "project", project }
        // Both /projects/<slug>.html and /projects/<slug>/index.html: static hosts differ in
        // which one they serve for /projects/<slug> (without a trailing slash).
        const dir = resolve(outDir, pathOf(route).slice(1))
        const html = fill(template, route)
        mkdirSync(dir, { recursive: true })
        writeFileSync(resolve(dir, "index.html"), html)
        writeFileSync(`${dir}.html`, html)
      }
      const urls = ["/", ...projects.map(p => `/projects/${p.slug}`)]
      writeFileSync(
        resolve(outDir, "sitemap.xml"),
        `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls
          .map(u => `  <url><loc>${site.url}${u}</loc></url>`)
          .join("\n")}\n</urlset>\n`,
      )
      writeFileSync(resolve(outDir, "robots.txt"), `User-agent: *\nAllow: /\n\nSitemap: ${site.url}/sitemap.xml\n`)
      // Sanity check: every page carries its own title.
      for (const u of urls) {
        const file = resolve(outDir, u === "/" ? "index.html" : `${u.slice(1)}/index.html`)
        if (!/<title>[^<]+<\/title>/.test(readFileSync(file, "utf8"))) throw new Error(`prerender: no <title> in ${file}`)
      }
    },
  }
}

export default defineConfig({
  server: { port: 5180 },
  build: { target: "es2022", assetsInlineLimit: 0, chunkSizeWarningLimit: 800 }, // three.js is most of the bundle
  plugins: [prerender()],
})
