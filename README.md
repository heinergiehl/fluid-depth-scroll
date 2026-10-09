# Fluid Depth Scroll

A scroll-driven flight through liquid space: an iridescent glass sphere, a dive into it through a
vortex, project cards drifting towards the camera and reacting to a real fluid simulation, and a
closing sphere that follows the pointer. Vite + TypeScript + three.js (WebGL2, raw GLSL 3).

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
| `src/overlay/Overlay.ts` | HTML text, driven by the same timeline state |

Copy and card data live in `src/content.ts` (contact email and social links are placeholders).

## Dev tools

- `?debug=dye` / `?debug=velocity`: the fluid alone, full screen.
- `?p=0.42`: start at a scroll position.
- `window.__demo` (dev only): `seek(p)`, `pause()`, `step(n)`, `probe` (reads GPU textures back).
- `node scripts/verify-fluid.mjs`: numeric GPU checks of the fluid (needs the dev server).
- `node scripts/verify-scene.mjs`: particle state checks + screenshots of every phase into
  `docs/verify/` (`MOBILE=1` for a phone viewport).

The scripts use `playwright-core` with an installed Playwright Chromium and a real GPU
(`--use-angle=d3d11`).

## Deploy

`npm run build` produces a static `dist/`. On Vercel or Netlify: build command `npm run build`,
output directory `dist`.
