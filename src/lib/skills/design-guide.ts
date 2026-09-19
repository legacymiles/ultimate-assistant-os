// ---------------------------------------------------------------------------
// Skills Library — the Web Design guide.
//
// One short paragraph per web design skill, shown in the "Web design guide"
// dropdown. Entries are matched to library rows by slug; a skill that isn't
// in the library yet (a recommendation) shows its install link instead.
// ---------------------------------------------------------------------------

export type GuideKind = "yours" | "anthropic" | "recommended";

export interface DesignGuideEntry {
  /** Library slug (folder name, or "plugin:name" for plugin skills). */
  slug: string;
  name: string;
  kind: GuideKind;
  /** What it's best for, in a few words. */
  bestFor: string;
  paragraph: string;
  /** Where to get it (shown when it isn't in the library). */
  url?: string;
  /** Install command for recommended skills. */
  install?: string;
}

export const DESIGN_GUIDE: DesignGuideEntry[] = [
  {
    slug: "frontend-design:frontend-design",
    name: "frontend-design",
    kind: "anthropic",
    bestFor: "Default choice for any page or component",
    paragraph:
      "Anthropic's own design skill, the one Claude uses to avoid generic \"AI slop\". Before writing code it commits to one clear aesthetic direction (brutalist, editorial, luxury, retro-futuristic…), then picks distinctive typography, a committed colour palette, deliberate motion and unexpected layouts. Use it as the baseline for anything that doesn't need a specialist.",
    url: "https://github.com/anthropics/claude-plugins-official/tree/main/plugins/frontend-design",
    install: "claude plugin install frontend-design@claude-plugins-official",
  },
  {
    slug: "interactive-web-studio",
    name: "interactive-web-studio",
    kind: "yours",
    bestFor: "Awwwards-level, playful, experimental sites",
    paragraph:
      "Your flagship for premium, cinematic sites: WebGL/Three.js scenes, custom shaders, smooth scroll, magnetic cursors and original interactive \"toys\". Reach for it when the brief says wow, immersive or \"nothing anyone has seen before\". The specialist skills below plug into it.",
  },
  {
    slug: "scroll-craft",
    name: "scroll-craft",
    kind: "yours",
    bestFor: "Service, product, food and drink brands",
    paragraph:
      "Premium scroll-driven landing pages with layered depth heroes, scroll-as-timeline storytelling and one engineered emotional peak, plus a separate mobile composition. It can generate photoreal assets through kie.ai. Use it when a brand needs to feel like an experience rather than a template.",
  },
  {
    slug: "github:scroll-world",
    name: "scroll-world",
    kind: "yours",
    bestFor: "\"Fly through the world\" diorama heroes",
    paragraph:
      "Builds a continuous, cut-free camera flight through an isometric diorama world with Higgsfield-rendered clips scrubbed by scroll. Best for turning a whole business or industry into one scrollable 3D journey.",
  },
  {
    slug: "h3-scroll-world",
    name: "h3-scroll-world",
    kind: "yours",
    bestFor: "Seedance-style cinematic sites, rendered with H3",
    paragraph:
      "The scroll-world fly-through (oso95's 9k★ version) ported to MiniMax H3. OpenRouter paints the scene stills, and H3 renders each camera leg starting from the previous leg's last frame, so the whole page is one uncut shot scrubbed by scroll. It renders on your own RunPod H3 by default. Continuous walkthroughs work on any backend; diorama fly-overs with end frames need a MINIMAX_API_KEY.",
    url: "https://github.com/oso95/scroll-world",
  },
  {
    slug: "cinematic-ui",
    name: "cinematic-ui",
    kind: "recommended",
    bestFor: "Film-directed art direction for the page itself",
    paragraph:
      "Art-directs a website like a film: pick a director or genre (noir, sci-fi, Wes Anderson, Villeneuve…) and it builds the page from a storyboard with matching colour grades, typography, composition and motion, drawing on libraries of 200 directors and 50 camera shots. It uses no API, so pair it with h3-scroll-world. H3 makes the footage, and cinematic-ui makes the site around it feel like the same film.",
    url: "https://github.com/akseolabs-seo/cinematic-ui",
  },
  {
    slug: "blender-to-web",
    name: "blender-to-web",
    kind: "yours",
    bestFor: "Real 3D centerpieces / igloo.inc-level worlds",
    paragraph:
      "Models the hero object or world in Blender (reproducible Python, GLB export) and brings it to life with Three.js. It starts with three mockup directions and ends with a gauntlet gate. Use it when the 3D asset needs to be authored rather than code-only.",
  },
  {
    slug: "exploded-showcase",
    name: "exploded-showcase",
    kind: "yours",
    bestFor: "Physical products, devices and vehicles",
    paragraph:
      "A single hero object on an orbiting stage that separates into labeled, inspectable parts, with leader-line callouts, HUD chrome, fog and bloom, then a scroll dive into first person. It's the teardown mechanic behind the Kart Showcase.",
  },
  {
    slug: "webgl-trail-reveal",
    name: "webgl-trail-reveal",
    kind: "yours",
    bestFor: "Before/after or hidden-layer heroes",
    paragraph:
      "The Unicorn Studio-style mouse-trail reveal. Two aligned images share one shader, and the cursor paints a fading trail that uncovers the hidden layer with chromatic distortion. A single-mechanic add-on, so pair it with a page-level skill.",
  },
  {
    slug: "real-estate-reveal",
    name: "real-estate-reveal",
    kind: "yours",
    bestFor: "Listings, villas, venues, hotels",
    paragraph:
      "Turns listing photos into one scroll-scrubbed camera journey through a real property, from drone approach through the rooms to the finale, with confirmed facts only and a private-showing form. It works without keys by falling back to stills.",
  },
  {
    slug: "capcut-design",
    name: "capcut-design",
    kind: "yours",
    bestFor: "Clean, restrained product UI",
    paragraph:
      "An exact design-token system (colour, type scale, spacing grid, component patterns) for polished, consistent app interfaces. Use it for dashboards and tools where restraint beats spectacle.",
  },
  {
    slug: "impeccable",
    name: "impeccable",
    kind: "recommended",
    bestFor: "Fixing \"AI-looking\" design, polish passes",
    paragraph:
      "Paul Bakaus's design language for AI harnesses (~69k★). It extends Anthropic's frontend-design with deeper typography, colour, spatial and motion guidance, plus commands like audit, critique, polish, distill and bolder that grade and upgrade an existing UI. It fills the biggest gap in your kit: critiquing and refining what's already built. Try \"/impeccable audit\" on a finished page.",
    url: "https://github.com/pbakaus/impeccable",
  },
  {
    slug: "ui-ux-pro-max",
    name: "ui-ux-pro-max",
    kind: "recommended",
    bestFor: "Picking a style, palette and fonts fast",
    paragraph:
      "A searchable design-intelligence database (~129k★) with dozens of UI styles, colour palettes, font pairings, chart types and UX rules, which a reasoning step turns into a full design system for your product type. Useful for business apps and SaaS, where your cinematic skills are overkill.",
    url: "https://github.com/nextlevelbuilder/ui-ux-pro-max-skill",
  },
  {
    slug: "web-design-guidelines",
    name: "web-design-guidelines",
    kind: "recommended",
    bestFor: "Pre-ship UI / accessibility review",
    paragraph:
      "Vercel's official review skill. It audits your code against their Web Interface Guidelines (accessibility, focus states, forms, animation, typography, performance, dark mode) and reports file:line issues. Run it before a deploy. It pairs with the vercel plugin you already have.",
    url: "https://github.com/vercel-labs/agent-skills",
  },
  {
    slug: "theme-factory",
    name: "theme-factory",
    kind: "anthropic",
    bestFor: "Instant, consistent themes",
    paragraph:
      "From Anthropic's public skills repo: ten preset themes (curated colour + font pairs), plus on-the-fly theme generation, applied consistently across a page, slides or a doc. It's a quick way to give a plain build a coherent look.",
    url: "https://github.com/anthropics/skills/tree/main/skills/theme-factory",
  },
  {
    slug: "web-artifacts-builder",
    name: "web-artifacts-builder",
    kind: "anthropic",
    bestFor: "Multi-component React prototypes",
    paragraph:
      "Also from Anthropic's skills repo: scaffolds React + Tailwind + shadcn/ui projects and bundles them into a single HTML file. Good for quick, rich, self-contained prototypes and mockups.",
    url: "https://github.com/anthropics/skills/tree/main/skills/web-artifacts-builder",
  },
];

export const GUIDE_KIND_LABEL: Record<GuideKind, string> = {
  yours: "Yours",
  anthropic: "Anthropic",
  recommended: "Added",
};
