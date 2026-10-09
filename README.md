# Fluid Depth Scroll

A scroll-driven flight through liquid space: an iridescent glass sphere, a dive into it through a
vortex, project cards drifting towards the camera and reacting to a real fluid simulation, and a
closing sphere that follows the pointer. Click a card and it bursts into a vortex that lands you in
the project's own cosmos (`/projects/<slug>`). All text is drawn in WebGL, so the liquid bends it
too, while the same text stays in the HTML for search engines and screen readers.
Vite + TypeScript + three.js (WebGL2, raw GLSL 3), troika-three-text.

```bash
npm install
npm run dev      # http://localhost:5180
npm run build    # static site in dist/
```

## How it works

One frame: input -> timeline -> fluid -> particles -> scene into an HDR target -> composite.

| Module | Role |
| --- | --- |
| `src/core/input.ts` | Virtual scroll (wheel, touch with inertia, keys), pointer, damped lean |
| `src/core/timeline.ts` | The whole page as pure functions of scroll progress `p` |
| `src/fluid/FluidSim.ts` | Screen-space stable fluids (velocity + dye), pointer splats, scroll push |
| `src/scene/Particles.ts` | GPGPU particles (MRT float ping-pong), carried by the fluid |
| `src/scene/Bubbles.ts` | Instanced iridescent bubbles with fake depth of field |
| `src/scene/Sphere.ts` | Pearlescent sphere + screen-space vortex hole (hero and finale) |
| `src/scene/Cards.ts` | Project cards, bent and refracted by the fluid |
| `src/scene/Nebula.ts`, `Composite.ts` | Backdrop; refraction, vortex twist, grain, tone map |
| `src/scene/Transition.ts` | The dive into a project as pure functions of its progress |
| `src/markup.ts` | Semantic HTML + head tags per route (pre-rendered and reused at runtime) |
| `src/overlay/Overlay.ts` | Animates the HTML layer; computes the per-section looks |
| `src/text/TextScene.ts` | WebGL text placed exactly where the (transparent) HTML text is laid out |
| `src/core/router.ts` | History API routing between the flight and the project pages |

Copy and project data live in `src/content.ts` (from heinerdevelops.tech).

## SEO

`vite.config.ts` pre-renders every route at build time: `dist/index.html` and
`dist/projects/<slug>.html` (+ `/index.html`) with their own title, description, canonical,
Open Graph tags and JSON-LD, plus `sitemap.xml` and `robots.txt`. The text that WebGL draws stays in
the HTML (painted transparent once the WebGL text is up), so crawlers, screen readers, selection and
find-in-page all work. Set `site.url` in `src/content.ts` when the domain changes.

## Dev tools

- `?debug=dye` / `?debug=velocity`: the fluid alone, full screen.
- `?p=0.42`: start at a scroll position.
- `window.__demo` (dev only): `seek(p)`, `pause()`, `step(n)`, `transition(t)`, `cardScreen(i)`,
  `probe` (reads GPU textures back).
- `node scripts/verify-fluid.mjs`: numeric GPU checks of the fluid (needs the dev server).
- `node scripts/verify-scene.mjs`: particle state checks + screenshots of every phase into
  `docs/verify/` (`MOBILE=1` for a phone viewport).
- `node scripts/verify-project.mjs`: hover, click, the transition frame by frame, Escape, a direct
  project URL and "next project" (`MOBILE=1` too).

The scripts use `playwright-core` with an installed Playwright Chromium and a real GPU
(`--use-angle=d3d11`).

## Deploy

`npm run build` produces a static `dist/`. On Vercel or Netlify: build command `npm run build`,
output directory `dist`. `vercel.json` turns on clean URLs, so `/projects/<slug>` serves the
pre-rendered page. Pushes to `main` deploy automatically.
