// All copy in one place. Titles use *asterisks* for the serif italic part.
// Kickers and tags describe what each project is; adjust them to the real stack / context.

export interface CardContent {
  image: string // file in public/cards
  kicker: string // small cyan line above the title
  title: string
  tags: string[]
  href?: string // "Open case study" shows only when set
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

export const cards: CardContent[] = [
  { image: "rag-chatbot.webp", kicker: "AI assistant", title: "*RAG* Chatbot", tags: ["Retrieval", "LLM", "Chat UI"] },
  { image: "image-studio.webp", kicker: "Creative tool", title: "Image Studio *Pro*", tags: ["Image generation", "Editor", "AI"] },
  { image: "agent-builder.webp", kicker: "AI workflows", title: "Agent *Builder*", tags: ["Agents", "Visual editor", "Automation"] },
  { image: "globe-kit.webp", kicker: "Data visualisation", title: "Globe *Kit*", tags: ["WebGL", "3D", "Maps"] },
  { image: "canva-clone.webp", kicker: "Design editor", title: "Canva *Clone*", tags: ["Canvas", "Editor", "Collaboration"] },
  { image: "interview-scheduler.webp", kicker: "Productivity", title: "Interview *Scheduler*", tags: ["Scheduling", "Calendar", "Web app"] },
  { image: "three-carousel.webp", kicker: "Motion study", title: "Three *Carousel*", tags: ["three.js", "Shaders", "Interaction"] },
]

export const contact = {
  title: "Let's build something *alive*.",
  email: "hello@example.com", // placeholder: fill in
  socials: [
    { label: "GitHub", href: "#" }, // placeholders: fill in
    { label: "LinkedIn", href: "#" },
  ],
}
