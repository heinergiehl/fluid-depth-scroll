// All copy in one place. Titles use *asterisks* for the serif italic part.
// Project data follows heinerdevelops.tech (latest-portfolio/app/data/projects.ts); the detail
// pages here are condensed and link to the full pages there.

export interface ProjectLink {
  label: string
  href: string
}

export interface Project {
  slug: string // URL: /projects/<slug>; same slug as on heinerdevelops.tech
  image: string // file in public/cards
  name: string // plain name, for <title> and alt text
  title: string // display title with *italic* part
  kicker: string // small cyan line above the title
  tagline: string // one-sentence description
  summary: string // the key outcome (from the source; empty when there is none)
  highlights: string[] // up to three
  stack: string[]
  links: ProjectLink[]
  accent: number // tint of the project's cosmos (sRGB hex)
}

export const site = {
  name: "Heiner Develops",
  owner: "Heiner Giehl",
  url: "https://fluid-depth-scroll-v2.vercel.app", // this version's deployment (canonical, OG, sitemap)
  portfolio: "https://heinerdevelops.tech",
  description:
    "A scroll-driven flight through liquid space: interactive WebGL showcase of projects by Heiner Giehl, full-stack and AI developer.",
}

export const hero = {
  title: "Interfaces that feel *alive*.",
  sub: "Built by Heiner Develops.",
}

export const statement = {
  title: "Where *design* meets *engineering*.",
  body:
    "I build interfaces that move with intent: real-time graphics, fluid interaction and AI tools " +
    "that feel natural to use. Every detail is engineered, every motion has a reason.",
  cta: "Explore projects",
}

const caseStudy = (slug: string): ProjectLink => ({ label: "Full case study", href: `https://heinerdevelops.tech/${slug}` })

export const projects: Project[] = [
  {
    slug: "rag-chatbot",
    image: "rag-chatbot.webp",
    name: "RAG Chatbot",
    title: "*RAG* Chatbot",
    kicker: "Filament plugin",
    tagline:
      "Production-ready AI chatbot management for Laravel + Filament with multi-bot support, knowledge ingestion, and embeddable widgets.",
    summary: "Answer customer questions using your real docs, not generic model hallucinations.",
    highlights: [
      "Filament chatbot management without bespoke CRUD",
      "Laravel knowledge base ingestion for RAG",
      "Embeddable AI chatbot widgets for Laravel apps",
    ],
    stack: ["Filament", "Laravel", "PHP", "Livewire", "AI"],
    links: [
      { label: "Live demo", href: "https://filament-rag.heinerdevelops.tech/" },
      { label: "Docs", href: "https://filament-rag.heinerdevelops.tech/docs" },
      { label: "Filament listing", href: "https://filamentphp.com/plugins/heiner-giehl-rag-chatbot" },
      caseStudy("rag-chatbot"),
    ],
    accent: 0x3ee6ff,
  },
  {
    slug: "image-studio-pro",
    image: "image-studio.webp",
    name: "Image Studio Pro",
    title: "Image Studio *Pro*",
    kicker: "Filament plugin",
    tagline: "A full in-panel image editor for Filament with canvas tools, templates, brand presets, and advanced editing capabilities.",
    summary: "Stop the download-edit-reupload loop for social, blog, and ad creatives.",
    highlights: [
      "Laravel admin image editor with canvas tools",
      "Filament Media Library and form integration",
      "Approval workflows for marketing and ops teams",
    ],
    stack: ["Filament", "Laravel", "PHP", "Livewire"],
    links: [
      { label: "Live demo", href: "https://filament-image-studio-pro.heinerdevelops.tech/" },
      { label: "Docs", href: "https://github.com/heinergiehl/filament-image-studio-pro-docs/blob/main/docs/getting-started.md" },
      { label: "Filament listing", href: "https://filamentphp.com/plugins/heiner-giehl-image-studio-pro" },
      caseStudy("image-studio-pro"),
    ],
    accent: 0xe05cff,
  },
  {
    slug: "agentic-chatbot",
    image: "agent-builder.webp",
    name: "Agentic Chatbot",
    title: "*Agentic* Chatbot",
    kicker: "Filament plugin",
    tagline:
      "Premium Filament plugin for grounded RAG chat, visual agentic workflows, API and data integrations, channel bots, and production-ready operations.",
    summary: "Ship a real AI assistant product surface without building the admin, runtime, and workflow layer from scratch.",
    highlights: ["Filament assistant control plane", "Laravel AI workflow builder", "Channels, API, and quality operations"],
    stack: ["Filament", "Laravel", "PHP", "Livewire", "AI"],
    links: [
      { label: "Live demo", href: "https://filament-agentic-chatbot.heinerdevelops.tech/" },
      { label: "Docs", href: "https://github.com/heinergiehl/agentic-chatbot-filament-docs/blob/main/PRODUCT_OVERVIEW.md" },
      { label: "Filament listing", href: "https://filamentphp.com/plugins/heiner-giehl-agentic-chatbot" },
      caseStudy("agentic-chatbot"),
    ],
    accent: 0x8a6bff,
  },
  {
    slug: "gif-creator",
    image: "gif-creator.webp",
    name: "GIF-Creator",
    title: "GIF-*Creator*",
    kicker: "Browser tool",
    tagline: "A private GIF workflow for video, images, and existing animations with local browser processing.",
    summary: "One continuous workflow for creating and editing animated GIFs.",
    highlights: [
      "Video, image-sequence, and existing-GIF import workflows",
      "Frame timing, reordering, cropping, resizing, text, callouts, and privacy redaction",
      "GIF, WebP, APNG, and MP4-oriented export and optimization workflows",
    ],
    stack: ["Next.js", "TypeScript", "FFmpeg.wasm", "Fabric.js"],
    links: [{ label: "Open the free GIF editor", href: "https://gif-creator.heinerdevelops.tech/edit-gifs" }, caseStudy("gif-creator")],
    accent: 0xff7ab8,
  },
  {
    slug: "canva-clone",
    image: "canva-clone.webp",
    name: "Canva Clone",
    title: "Canva *Clone*",
    kicker: "Fullstack app",
    tagline: "Trying to build a fullstack app, which feels like canva.com.",
    summary: "",
    highlights: [],
    stack: ["Next.js", "TypeScript", "Fabric.js", "Tailwind CSS"],
    links: [{ label: "Live demo", href: "https://canva-clone.heinerdevelops.tech" }, caseStudy("canva-clone")],
    accent: 0x5fd6c4,
  },
  {
    slug: "interview-scheduler",
    image: "interview-scheduler.webp",
    name: "Interview Scheduler",
    title: "Interview *Scheduler*",
    kicker: "Fullstack app",
    tagline: "Allows the employer to schedule interviews with candidates.",
    summary: "",
    highlights: [],
    stack: ["Laravel", "Vue.js", "Laravel Echo", "ShadCN-Vue", "Tailwind CSS"],
    links: [{ label: "Live demo", href: "https://interview-scheduler.heinerdevelops.tech" }, caseStudy("interview-scheduler")],
    accent: 0x6f8cff,
  },
  {
    slug: "threejs-carousel",
    image: "three-carousel.webp",
    name: "ThreeJS Carousel",
    title: "ThreeJS *Carousel*",
    kicker: "Frontend experiment",
    tagline: "A fun experiment to learn more about ThreeJS and Shaders by building an interactive carousel.",
    summary: "",
    highlights: [],
    stack: ["Three.js", "GSAP", "GLSL", "Vite"],
    links: [{ label: "Live demo", href: "https://react-three-carousel.vercel.app/" }, caseStudy("threejs-carousel")],
    accent: 0xb88cff,
  },
]

export const contact = {
  title: "Let's build something *alive*.",
  email: "webdevislife2021@gmail.com",
  socials: [
    { label: "GitHub", href: "https://github.com/heinergiehl" },
    { label: "YouTube", href: "https://www.youtube.com/@codingislove3707" },
    { label: "Upwork", href: "https://www.upwork.com/freelancers/~01e359856bc8297a0f" },
    { label: "Portfolio", href: "https://heinerdevelops.tech" },
  ],
}
