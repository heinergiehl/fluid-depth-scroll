# Fluid Depth Scroll: implementation plan

A scroll-driven flight through liquid space, inspired by engaged.be: an iridescent glass sphere, a
dive into it through a vortex, case cards that drift towards the camera through depth and react to a
real fluid simulation, and a closing sphere that follows the mouse. Bubbles and glowing particles
come out of the depth the whole time.

Showcase demo, independent of the portfolio repo. Content is our own: the cards show Heiner's
projects (`public/cards/*.webp`); nothing from engaged.be (their images and copy belong to them and
their clients) is shipped. `docs/reference/` holds screenshots of the reference for local study
only and is git-ignored.

**Stack:** Vite, TypeScript (7, native `tsc`), three.js 0.186 on WebGL2, raw GLSL 3 shaders
(`RawShaderMaterial`, `glslVersion: THREE.GLSL3`). No UI framework: one canvas plus a thin HTML
overlay. `npm run build` gives a static `dist/` for Vercel / Netlify.

**Why WebGL2 + GLSL and not WebGPU + TSL:** WebGL2 runs everywhere today. three's WebGPU renderer
falls back to WebGL2 where WebGPU is missing, and that fallback loses compute shaders, which is
exactly what we need. FBO ping-pong in fragment shaders gives the same GPU-only data flow (fluid and
particle state never touch the CPU) on every browser.

## Reference analysis (engaged.be, 1600x900, see docs/reference/s00..s28.jpg)

The page itself does not scroll (`scrollHeight == innerHeight`); wheel / touch drive a virtual
timeline. One full-screen WebGL2 canvas (three.js, `window.__THREE__`), HTML text and buttons on top.

1. **Hero (s00-s01).** Deep indigo backdrop (#1b1446 -> #0b0a2a at the edges) with a soft nebula:
   large, very blurred violet / blue clouds. Big translucent bubbles in the background: dark
   interiors, thin bright fresnel rims, out of focus, slowly drifting. Small glowing dots
   (white, cyan, violet), some twinkling. In the centre a large glass sphere (~45% of the height):
   pearlescent gradient, lavender / pale violet at the top-left, blue in the middle, a cyan-green
   glow at the bottom (like light caught inside), soft bright rim, no hard specular. The headline
   (HTML, large, white, partly serif italic) sits over the sphere at ~70% opacity, so the sphere shows
   through.
2. **Dive (s02-s07).** Scrolling pushes the camera into the sphere: it grows until its edge leaves
   the screen. Inside, the view becomes a bright iridescent ring (white / lavender at the top-left,
   cyan on the right, violet below) around a dark, smoky, slightly swirling hole in the middle. The
   hole's edge is soft and turbulent (fluid-like, not a clean circle). The hole widens and the ring
   darkens and dissolves into the nebula, revealing the next section. The next headline fades in
   while still blurred and darkened, then sharpens.
3. **Statement (s08-s19).** Big two-line headline + paragraph + button, left-centre, over the
   nebula. On further scroll it rises, fades and blurs out while the first cards appear far away.
4. **Cards (s20-s28).** Rounded rectangles (~16:10, radius ~2.5% of width), image-filled, tinted
   towards indigo (they never show raw colours: multiply ~0.75 + violet tint), a faint glow / shadow
   around them. Arranged in depth: the focused card centre-left, larger; the next one smaller,
   right and higher; a third one barely visible further back. Each card is tilted a few degrees
   (rotated in x and y, as if floating). Scrolling brings the next card forward: they move towards
   the camera along z and drift sideways. Under the focused card: client (cyan, small, bold), title
   (big, mixed serif italic + sans), tags row (small caps, cyan dots), "Open case study" button
   bottom-right, "View all our work" bottom-left.
   The cursor stirs the liquid: cards warp and their colours smear where the fluid moves.
5. **Contact (user screenshot 4).** A big glass sphere on the left, partly cut off by the screen
   edge, same pearlescent material, and the contact info on the right. The sphere follows the
   pointer with lag.

Everywhere: the scene leans with the pointer (parallax: near layers move more, ~1-3% of the
viewport), and particles / bubbles keep coming out of the depth.

## Rendering pipeline (one frame)

1. **Input** (`src/core/input.ts`): virtual scroll (wheel, touch, keys; damped, clamped) giving
   progress `p` 0..1 and its velocity; pointer position (NDC and uv), velocity, damped "lean".
2. **Fluid** (`src/fluid/FluidSim.ts`, done): screen-space stable fluids on half-float FBO
   ping-pong. Splats from the pointer (velocity + a little dye), and while scrolling a radial `push`
   from the centre, as if flying forward through liquid. Outputs `velocity` (uv/s) and `dye`.
3. **Particles** (`src/scene/Particles.ts`): GPGPU. Texture A = position.xyz + life, texture B =
   velocity.xyz + seed (two ping-pongs, or one RGBA pair with velocity derived analytically).
   Each step: life += dt / lifetime; drift towards the camera (+z), faster with scroll velocity;
   curl noise; push by the fluid velocity sampled at the particle's projected screen position
   (pass the view-projection matrix). Respawn deep (z far) when life >= 1 or the particle passes the
   camera. Render as points: size by depth, glow halo + hot core, alpha = fade-in (first 15% of
   life) * fade-out (last 40%), colour from the palette (white / cyan / violet), twinkle.
   ~16k particles desktop, 4k mobile.
4. **Scene** into an HDR target (HalfFloat, MSAA 4 if supported), camera at z = cameraZ(p):
   - `Nebula.ts`: full-screen backdrop (rendered first, no depth): indigo gradient + 2-3 octaves of
     fbm clouds in violet / blue, drifting slowly, parallax with the pointer; brightness per phase.
   - `Bubbles.ts`: ~40 instanced spheres in a tunnel around the camera path; shader: dark interior
     (alpha ~0.15), thin-film iridescent fresnel rim, soft (fake depth of field: rim width grows with
     distance from the focus plane). They drift towards the camera and respawn behind.
   - `Cards.ts`: planes (24x16 segments) with rounded-corner SDF alpha; vertex shader bends the
     plane by the fluid velocity sampled at the vertex's screen position (z and xy offset) plus a
     slow idle wave; fragment shader offsets the image uv by the fluid velocity (refraction),
     splits RGB slightly with velocity (chromatic smear), adds dye, tints to indigo, edge glow.
     Card i sits at z = -i * spacing, alternating left / right, each with its own tilt.
   - `Sphere.ts`: one material for the hero and the contact sphere: view-dependent pearlescent
     gradient (palette by normal and view), fresnel rim, inner cyan-green glow at the bottom, slow
     internal swirl (noise), refraction of the backdrop optional. Hero at the start of the path,
     contact at the end.
5. **Composite** (`src/scene/Composite.ts`) to the canvas: sample the scene with uv offset by the
   fluid velocity (screen refraction), add dye as glow, the vortex transition (see below), slight
   chromatic aberration towards the edges, vignette, film grain, ACES-ish tone map, output sRGB.
   **Vortex transition** (`uVortex` 0..1 from the timeline): polar coordinates around the centre,
   twist angle by (1 - r) * k * vortex, a ring of the palette (bright) at r = ring(vortex) whose
   inner edge is broken up with noise + fluid dye, darkness inside the ring (the "hole") that
   expands; at vortex 1 the hole covers the screen and the next phase shows through it.

## Scroll timeline (`src/core/timeline.ts`, pure functions of p)

| p           | Scene                                                                 |
|-------------|-----------------------------------------------------------------------|
| 0.00 - 0.12 | Hero sphere with headline; camera eases towards it                     |
| 0.12 - 0.24 | Dive: sphere fills the view, vortex transition opens the next section |
| 0.24 - 0.34 | Statement text over the nebula                                         |
| 0.34 - 0.82 | Cards: camera travels through z; each card's title shows in focus     |
| 0.82 - 0.90 | Second vortex transition                                               |
| 0.90 - 1.00 | Finale sphere (follows the mouse) with contact                         |

Total virtual scroll length: ~9 viewport heights. Each phase exposes its local 0..1 progress; HTML
sections read their opacity / transform / blur from the same functions, so text and WebGL never drift
apart.

## Content (our own)

- Hero: "Interfaces that feel *alive*." / "Built by Heiner Develops."
- Statement: "Where *design* meets *engineering*." + one paragraph, button "Explore projects".
- Cards (title, client line, tags) from Heiner's projects: RAG Chatbot, Image Studio Pro, Agent
  Builder, Globe Kit, Canva Clone, Interview Scheduler, Three Carousel (`public/cards/`).
- Contact: email / socials placeholders to fill in.

## Modules and order of work

1. [x] `src/gl/targets.ts`: render targets, ping-pong, fullscreen pass
2. [x] `src/fluid/FluidSim.ts`: fluid simulation (API in its header)
3. [x] `index.html` + `src/style.css` + `src/main.ts`: canvas, renderer (DPR cap 1.75), resize,
       frame loop, a debug view that draws the fluid dye full screen -> verify the fluid first
       (`?debug=dye|velocity`, `node scripts/verify-fluid.mjs`: 17 GPU checks, all pass)
4. [x] `src/core/input.ts`, `src/core/timeline.ts` (+ a few unit-style asserts in dev)
5. [x] `Nebula.ts`, `Composite.ts` (refraction + grain + vignette, vortex stub)
6. [x] `Particles.ts` (GPGPU) -> verify lifetime glow / fade
7. [x] `Bubbles.ts`
8. [x] `Sphere.ts` (hero), then the dive + vortex
9. [x] `Cards.ts` + overlay titles
10. [x] Finale sphere + contact overlay, pointer follow
11. [x] Overlay polish (fonts: a sans like "Inter Tight" + a serif italic like "Instrument Serif"
        from Google Fonts), reduced motion, mobile (touch scroll, lower counts), a11y (real text,
        focusable buttons), performance pass (no per-frame allocations, adaptive DPR on slow frames)
12. [ ] README (done), Vercel deploy (open)

## Fluid integration notes (from FluidSim.ts)

Verified on a GPU (RTX 4070 SUPER, ANGLE D3D11) with `scripts/verify-fluid.mjs`: splat position,
shape and amplitude, axis directions, push, dye decay rate, dt clamp, render state, 600-frame stress
(no NaN), portrait grids; ~0.15 ms per update at 1600x900.

- Fixed during verification: unthresholded vorticity confinement kept grid-scale noise alive forever
  (~0.1 uv/s after 60 s without input). Confinement now acts only on curl above `curlThreshold`
  (default 0.03): the field returns to exactly 0 within ~10 s, strokes keep ~90% of their swirl.
- A push is divergent; the projection only partly removes it per frame, so repeated pushes
  accumulate (30 frames of `push(.., 1, 0.25)` give ~3 heights/s at r = 0.25). Keep s small.

- `fluid.velocity` / `fluid.dye` return the same texture objects every frame (the result is copied
  back after the ping-pong), so bind them to uniforms once. Call `resize(w, h)` before the first
  `update()`; resize is free when the grid size is unchanged, a real change clears the fluid.
- Velocity `rg` is in uv/s per axis (y up). Refraction: `uv += vel * k`, k ~ 0.01-0.03. A visible mouse
  stroke is |vel| ~ 0.5-3 uv/s.
- Mouse splat: `dx = movementX / width / dt`, `dy = -movementY / height / dt`; splat with 1-1.5x
  that, clamped to +-4 uv/s; radius 0.03-0.05; dye 0.1-0.3 per channel per splat (scale by dt*60).
  Hex colours go through colour management; `[r, g, b]` arrays are raw linear.
- Scroll: `push(0.5, 0.5, s, 0.25)` per update with s ~ 0.3-1.5 scaled by scroll speed; start ~0.5,
  it accumulates quickly.
- Edges are clamped and reflect normal velocity; velocity clamped to +-8 heights/s per axis
  (physical units, so 4.5 uv/s in x at 16:9); dt clamped to
  1/30; at most 32 splats + pushes per frame; `update()` restores render target and autoClear.

## Verification

The in-app browser pane may be hidden (then `document.hidden` is true and nothing animates). Use
headless Chromium via `playwright-core` (installed browsers in `%LOCALAPPDATA%\ms-playwright`) with
`--enable-gpu --ignore-gpu-blocklist --use-angle=d3d11`: load the dev server, drive the wheel in
steps, move the mouse, screenshot each phase in light of the reference frames in docs/reference.
Expose a dev hook `window.__demo = { seek(p) }` to jump to a timeline position deterministically.

## Implementation notes (steps 4-12)

- **Dive.** The hole lives in the sphere shader (screen space, radius as a fraction of the
  projected sphere radius), not in the composite: inside it the sphere is transparent, so the
  next section shows through. The camera rushes in until the sphere covers the screen (z 2.05),
  then creeps to 1.7 while the hole opens. The second vortex reuses this in reverse: the finale
  sphere's hole closes around the view, then the sphere pulls back to the lower left.
- **Camera path.** After the dive the camera follows a path parameterised by the card coordinate
  `s` (card i in focus at s = i, with a dwell around integers). It drifts right and up, so the next
  card always waits to the right and higher. `timeline.selfTest()` (dev) checks continuity,
  monotonic travel, ranges and that every card reaches full focus.
- **Particles.** Float state is required (half floats cannot resolve per-frame drift at z ~ 40).
  They start in the steady state (a uniform fill put far too many big particles on the first
  screen) and hash texel ids, not the continuous seed (that lined particles up in rows).
- **Reduced motion:** faster scroll damping, no pointer lean, no scroll push, weaker vortex.
- **Adaptive DPR:** steps the pixel ratio down by 0.25 (to 1) after two seconds of slow frames.
