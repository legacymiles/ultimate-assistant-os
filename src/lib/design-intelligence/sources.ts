// ---------------------------------------------------------------------------
// Design Intelligence — where design ideas and real components come from.
//
// Every line here was checked against the source's own site, repo, npm entry
// or the live shadcn registry index on 2026-11-12. The rule that shaped it: no
// pretending. A site with no MCP or API says so, and is marked browse-only; a
// component whose licence forbids redistribution says so, because the agent is
// copying it into a CLIENT's repository.
//
// Pure data plus two small readers. The brief (`brief.ts`) turns this into the
// words a build receives; the `design-intelligence` skill carries the same
// table for a session that is not started from a Jarvis app.
// ---------------------------------------------------------------------------

/** How an agent can actually reach a source. */
export type Access =
  | "shadcn-registry" // npx shadcn@latest add @ns/<item>
  | "url-install" // npx shadcn@latest add "<url>"
  | "mcp"
  | "npm"
  | "skill"
  | "embed"
  | "browse"; // human-curated reference: read it, never scrape it, never copy it

/** What the source is for in a build. */
export type Role = "inspiration" | "components" | "effects" | "primitives" | "motion-craft";

export interface DesignSource {
  id: string;
  name: string;
  url: string;
  role: Role;
  access: Access[];
  /** The exact command or address an agent uses. */
  howTo: string;
  /** Licence in a few words, and anything that matters when it lands in a client's repo. */
  licence: string;
  /** False when it may only be read for ideas — nothing from it is copied into a site. */
  copyable: boolean;
  /** Anything that changes how it should be used. */
  caution?: string;
}

export const SOURCES: DesignSource[] = [
  // ----- the install path: one CLI, many registries ---------------------------------
  {
    id: "shadcn",
    name: "shadcn/ui",
    url: "https://ui.shadcn.com",
    role: "components",
    access: ["shadcn-registry", "mcp", "skill"],
    howTo: "`npx shadcn@latest init` (CLI v4; Base UI is the default base, `-b radix` keeps Radix), then `npx shadcn@latest add <item>`. MCP: `npx shadcn@latest mcp` — searches and installs from every registry in components.json.",
    licence: "MIT.",
    copyable: true,
  },
  {
    id: "magicui",
    name: "Magic UI",
    url: "https://magicui.design",
    role: "effects",
    access: ["shadcn-registry", "mcp"],
    howTo: "`npx shadcn@latest add @magicui/<item>` (registry `@magicui` → https://magicui.design/r/{name}.json). MCP: `@magicuidesign/mcp` (list/search/get registry items, no key).",
    licence: "MIT for the free library. Magic UI Pro is a separate paid product — never pull Pro items without a licence.",
    copyable: true,
  },
  {
    id: "aceternity",
    name: "Aceternity UI",
    url: "https://ui.aceternity.com",
    role: "effects",
    access: ["shadcn-registry"],
    howTo: "`npx shadcn@latest add @aceternity/<item>` (registry `@aceternity` → https://ui.aceternity.com/registry/{name}.json). Built on `motion/react`, Tailwind v4.",
    licence: "Aceternity licence, NOT MIT: unlimited end products for yourself or clients; never redistribute the source or sell it as a template or kit.",
    copyable: true,
    caution: "Fine inside a client's site; never inside something sold or published as a template.",
  },
  {
    id: "21st",
    name: "21st.dev",
    url: "https://21st.dev",
    role: "components",
    access: ["url-install", "mcp", "skill"],
    howTo: "Find a component on 21st.dev, then `npx shadcn@latest add \"https://21st.dev/r/<author>/<slug>\"`. MCP: `https://21st.dev/api/mcp` with an `x-api-key` from https://21st.dev/mcp (setup: `npx @21st-dev/cli@latest init --client claude --write`).",
    licence: "Per author — read the listing's licence before using it in a client site.",
    copyable: true,
    caution: "Search is free; code retrieval through the MCP is 2 a day on the free plan (unlimited on Builder, ~$6–8/mo). The MCP needs a key the owner adds — without one, browse the site and use the URL install.",
  },
  {
    id: "rareui",
    name: "RareUI",
    url: "https://rareui.in",
    role: "effects",
    access: ["npm"],
    howTo: "`npx rareui add <name>` (React 19, Tailwind 4, Framer Motion 12).",
    licence: "MIT.",
    copyable: true,
    caution: "Small single-author library (≈40 stars). Read the component before using it; prefer Magic UI or Aceternity for the same effect.",
  },
  {
    id: "beautifului",
    name: "Beautiful UI",
    url: "https://www.beautifului.dev",
    role: "components",
    access: ["browse"],
    howTo: "Copy-paste reference for AI-chat interfaces (streaming text, approval cards, diff tables). No registry or CLI.",
    licence: "Footer links an MIT page — read it before copying anything.",
    copyable: true,
    caution: "Only relevant when the build has an AI/chat surface. Not the same project as ShadwUI or beUI.",
  },

  // ----- primitives and the small, sharp libraries -----------------------------------
  {
    id: "base-ui",
    name: "Base UI",
    url: "https://base-ui.com",
    role: "primitives",
    access: ["npm"],
    howTo: "Comes in through `shadcn init` (the default base). Directly: `npm i @base-ui/react` — the old `@base-ui-components/react` name is deprecated.",
    licence: "MIT.",
    copyable: true,
  },
  {
    id: "radix",
    name: "Radix UI",
    url: "https://www.radix-ui.com",
    role: "primitives",
    access: ["npm"],
    howTo: "`npx shadcn@latest init -b radix`, or `npm i radix-ui` and `import { Popover } from \"radix-ui\"`.",
    licence: "MIT.",
    copyable: true,
  },
  {
    id: "sonner",
    name: "Sonner",
    url: "https://sonner.emilkowal.ski",
    role: "primitives",
    access: ["npm", "shadcn-registry"],
    howTo: "`npx shadcn@latest add sonner` — the toast. Never hand-roll one.",
    licence: "MIT.",
    copyable: true,
  },
  {
    id: "cmdk",
    name: "cmdk",
    url: "https://cmdk.paco.me",
    role: "primitives",
    access: ["npm", "shadcn-registry"],
    howTo: "`npx shadcn@latest add command` — the command palette (⌘K) for any app with search or many actions.",
    licence: "MIT.",
    copyable: true,
  },
  {
    id: "vaul",
    name: "Vaul",
    url: "https://github.com/emilkowalski/vaul",
    role: "primitives",
    access: ["npm", "shadcn-registry"],
    howTo: "`npx shadcn@latest add drawer` — the phone bottom sheet.",
    licence: "MIT.",
    copyable: true,
    caution: "Its README says the repo is unmaintained (last release 1.1.2, Dec 2024). It still works; use it through shadcn's drawer and do not build anything that depends on new Vaul features.",
  },
  {
    id: "number-flow",
    name: "NumberFlow",
    url: "https://number-flow.barvian.me",
    role: "primitives",
    access: ["npm"],
    howTo: "`npm i @number-flow/react` — animated numbers for prices, counters, stats and KPIs.",
    licence: "MIT.",
    copyable: true,
  },

  // ----- craft: how motion and detail should feel ------------------------------------
  {
    id: "emil",
    name: "Emil Kowalski's skills",
    url: "https://github.com/emilkowalski/skills",
    role: "motion-craft",
    access: ["skill"],
    howTo: "Installed in ~/.claude/skills (emil-design-eng, animate, review-animations, improve-animations, animation-performance, gestures, pick-ui-library…). Invoke `review-animations` on every build with motion.",
    licence: "MIT (the public skills repo). The animations.dev course skills are paid and not installed.",
    copyable: true,
  },

  // ----- effects that live outside the codebase --------------------------------------
  {
    id: "unicorn",
    name: "Unicorn Studio",
    url: "https://www.unicorn.studio",
    role: "effects",
    access: ["embed", "mcp"],
    howTo: "Embed a published scene: the `unicornStudio.umd.js` script (jsDelivr) with `data-us-project=\"<id>\"`. MCP (OAuth, needs \"Allow agents\" on in an open editor tab): `claude mcp add --transport http unicorn-studio https://agentmcp-qbght5huyq-uc.a.run.app/mcp`. For a hand-built WebGL reveal use the `webgl-trail-reveal` skill instead.",
    licence: "Proprietary SDK: only with genuine Unicorn Studio projects; never remove the watermark. Code/JSON export needs the paid Legend plan.",
    copyable: false,
    caution: "Only when the owner or client has a Unicorn Studio account and a scene. Never fake its look with its SDK.",
  },

  // ----- inspiration: read, never copy, never scrape ---------------------------------
  {
    id: "awwwards",
    name: "Awwwards",
    url: "https://www.awwwards.com",
    role: "inspiration",
    access: ["browse"],
    howTo: "Open the collections for the project's category and read 3–5 winners for ideas: what the hero does, how the type is set, the one interaction people remember.",
    licence: "Terms forbid reproduction and commercial use of its content. Ideas only.",
    copyable: false,
    caution: "No API. Do not scrape it, and never copy a site's design — take the principle, not the page.",
  },
  {
    id: "recent",
    name: "Recent (formerly Godly)",
    url: "https://recent.design",
    role: "inspiration",
    access: ["browse"],
    howTo: "godly.website now redirects here. Browse the feed for current web design for ideas.",
    licence: "No published terms or API. Ideas only.",
    copyable: false,
  },
  {
    id: "aura",
    name: "Aura",
    url: "https://aura.build",
    role: "inspiration",
    access: ["browse"],
    howTo: "An AI landing-page builder (Meng To). Browse its gallery for layout and type ideas; a person can export HTML from it.",
    licence: "Terms not verified. Ideas only — nothing from it is copied into a site.",
    copyable: false,
    caution: "No MCP, API or CLI exists. Do not claim to have used it programmatically.",
  },
];

/** The registries a new project's components.json should carry. */
export const REGISTRIES: Record<string, string> = {
  "@magicui": "https://magicui.design/r/{name}.json",
  "@aceternity": "https://ui.aceternity.com/registry/{name}.json",
};

/** The `registries` block, ready to merge into a components.json. */
export function registriesJson(): string {
  return JSON.stringify({ registries: REGISTRIES }, null, 2);
}

export function sourcesFor(role: Role): DesignSource[] {
  return SOURCES.filter((s) => s.role === role);
}

export function source(id: string): DesignSource | undefined {
  return SOURCES.find((s) => s.id === id);
}
