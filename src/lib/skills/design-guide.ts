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
  {
    slug: "clone-site",
    name: "clone-site",
    kind: "recommended",
    bestFor: "Clone any website, pixel-accurate",
    paragraph:
      "Point it at a URL and it measures the live page in a real browser, writes a TEARDOWN.md explaining the stack and every effect with its exact settings, rebuilds it (DOM/CSS and WebGL/shader backgrounds on separate tracks), then proves the result with an automated pixel diff at desktop, tablet and phone widths. Use --analyze-only for just the teardown (\"how did they build this?\"). It calls dom-clone and shader-extract for you, and ends by offering remix-site.",
    url: "https://github.com/cth9191/site-clone",
  },
  {
    slug: "remix-site",
    name: "remix-site",
    kind: "recommended",
    bestFor: "Turn a clone into your own site",
    paragraph:
      "The step after clone-site: tokenizes the cloned design, re-skins it with your brand, copy and assets, renders three deliberately different directions side by side, then puts a live tweak panel on the one you pick. Use it when you want another site's structure and polish, but your own identity.",
    url: "https://github.com/cth9191/site-clone",
  },
  {
    slug: "shader-extract",
    name: "shader-extract",
    kind: "recommended",
    bestFor: "Rip one WebGL / shader effect",
    paragraph:
      "Captures a single WebGL, WebGPU, canvas, Three.js, Spline or Unicorn Studio effect from a live page and rebuilds it as a runnable local module. clone-site uses it for GPU backgrounds, and you can also call it on its own for one effect you like. (dom-clone is its DOM/CSS sibling and runs inside clone-site.)",
    url: "https://github.com/cth9191/site-clone",
  },
  {
    slug: "taste-skill",
    name: "taste-skill",
    kind: "recommended",
    bestFor: "Anti-slop landing pages (the 88k★ one)",
    paragraph:
      "Leon's taste-skill, the most-starred design skill on GitHub. It reads the brief, infers a real design direction, runs a strict pre-flight check and audits before redesigning, so pages stop looking templated. It overlaps with frontend-design and impeccable, so use whichever output you like best. The same pack's style presets are below.",
    url: "https://github.com/Leonxlnx/taste-skill",
  },
  {
    slug: "soft-skill",
    name: "soft-skill",
    kind: "recommended",
    bestFor: "\"Expensive agency\" look",
    paragraph:
      "Codifies the exact fonts, spacing, shadows, card structures and animations that make a site feel high-end, and blocks the cheap AI defaults. From the taste-skill pack.",
    url: "https://github.com/Leonxlnx/taste-skill",
  },
  {
    slug: "minimalist-skill",
    name: "minimalist-skill",
    kind: "recommended",
    bestFor: "Clean editorial minimalism",
    paragraph:
      "Warm monochrome palette, typographic contrast, flat bento grids and muted pastels, with no gradients or heavy shadows. From the taste-skill pack.",
    url: "https://github.com/Leonxlnx/taste-skill",
  },
  {
    slug: "brutalist-skill",
    name: "brutalist-skill",
    kind: "recommended",
    bestFor: "Swiss / terminal brutalism",
    paragraph:
      "Raw mechanical interfaces: rigid grids, extreme type-scale contrast, utilitarian colour and analog degradation effects, like a declassified blueprint. Good for data-heavy dashboards and editorial sites. From the taste-skill pack.",
    url: "https://github.com/Leonxlnx/taste-skill",
  },
  {
    slug: "gpt-tasteskill",
    name: "gpt-tasteskill",
    kind: "recommended",
    bestFor: "GSAP scroll-heavy layouts",
    paragraph:
      "Taste rules plus aggressive GSAP ScrollTrigger work (pinning, stacking, scrubbing), strict AIDA page structure, gapless bento grids and randomized layout variance so every build differs. From the taste-skill pack.",
    url: "https://github.com/Leonxlnx/taste-skill",
  },
  {
    slug: "redesign-skill",
    name: "redesign-skill",
    kind: "recommended",
    bestFor: "Upgrade an existing site",
    paragraph:
      "Audits a current site for generic AI patterns and lifts it to premium standards without breaking functionality. It works with any CSS setup. A lighter alternative to website-redesigner when you just want this site made better. From the taste-skill pack.",
    url: "https://github.com/Leonxlnx/taste-skill",
  },
  {
    slug: "imagegen-frontend-web",
    name: "imagegen-frontend-web",
    kind: "recommended",
    bestFor: "Design mockup images first",
    paragraph:
      "Generates one premium mockup image per page section, with varied compositions and one consistent palette, so you can approve the look before any code is written. Pair it with image-to-code-skill. From the taste-skill pack.",
    url: "https://github.com/Leonxlnx/taste-skill",
  },
  {
    slug: "image-to-code-skill",
    name: "image-to-code-skill",
    kind: "recommended",
    bestFor: "Mockup image → matching site",
    paragraph:
      "Generates the design images itself, analyzes them closely, then builds the site to match. It was written for Codex but reads fine for Claude. From the taste-skill pack.",
    url: "https://github.com/Leonxlnx/taste-skill",
  },
  {
    slug: "stitch-skill",
    name: "stitch-skill",
    kind: "recommended",
    bestFor: "DESIGN.md for Google Stitch",
    paragraph:
      "Writes agent-friendly DESIGN.md design-system files (typography, colour, asymmetric layout, micro-motion rules) for Google Stitch or any coding agent. From the taste-skill pack.",
    url: "https://github.com/Leonxlnx/taste-skill",
  },
];

export const GUIDE_KIND_LABEL: Record<GuideKind, string> = {
  yours: "Yours",
  anthropic: "Anthropic",
  recommended: "Added",
};
