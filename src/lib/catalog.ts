// ---------------------------------------------------------------------------
// Single source of truth for the hub.
// Add a new project = add an object to PROJECTS. Everything else is derived.
// ---------------------------------------------------------------------------

export type Category =
  | "AI"
  | "Image"
  | "Video"
  | "Music"
  | "Trading"
  | "Automation"
  | "Websites"
  | "Apps"
  | "Utilities";

export const CATEGORIES: Category[] = [
  "AI",
  "Image",
  "Video",
  "Music",
  "Trading",
  "Automation",
  "Websites",
  "Apps",
  "Utilities",
];

/** Visual style used for each animated icon. */
export type IconStyle = "aurora" | "orbit" | "rings" | "mesh" | "pulse" | "waves";

export interface CatalogProject {
  slug: string;
  title: string;
  tag?: string;
  category: Category;
  overview: string;
  status: "live" | "coming-soon";
  /** Internal route, e.g. `/apps/projects-timeline`. */
  appUrl?: string;
  /** External URL — when set, the detail page embeds it in an iframe. */
  externalUrl?: string;
  iconStyle: IconStyle;
  /** Two hues 0-360 used by the animated icon. */
  hue: [number, number];
}

export const PROJECTS: CatalogProject[] = [
  {
    slug: "projects-timeline",
    title: "Projects Timeline",
    tag: "Project intelligence",
    category: "AI",
    overview:
      "A project intelligence system that becomes the single source of truth for every one of your projects. " +
      "Capture features, versions, files and a Knowledge Inbox (notes, ideas, AI chats, PDFs and images), " +
      "then let the AI Project Analyst keep the documentation, summaries and feature lists current as the " +
      "project evolves. Built for makers who run a lot of projects in parallel and need them to stay organised.",
    status: "live",
    appUrl: "/apps/projects-timeline",
    iconStyle: "aurora",
    hue: [248, 280],
  },
  {
    slug: "image-lab",
    title: "Image Lab",
    tag: "AI image studio",
    category: "Image",
    overview:
      "A creative workspace for generating, editing and remixing images with AI. Combine prompts, " +
      "reference images and presets to produce on-brand visuals fast.",
    status: "coming-soon",
    iconStyle: "mesh",
    hue: [320, 20],
  },
  {
    slug: "video-forge",
    title: "Video Forge",
    tag: "AI video pipeline",
    category: "Video",
    overview:
      "Storyboard, generate and edit short-form video with AI. Script → scenes → cuts → captions in a single flow.",
    status: "coming-soon",
    iconStyle: "waves",
    hue: [200, 260],
  },
  {
    slug: "sonic",
    title: "Sonic",
    tag: "Music & sound",
    category: "Music",
    overview:
      "Generate stems, melodies and full tracks. Pair AI composition with simple arrangement tools for quick musical sketches.",
    status: "coming-soon",
    iconStyle: "rings",
    hue: [160, 200],
  },
  {
    slug: "goldea",
    title: "GoldEA Console",
    tag: "MT4 expert advisor",
    category: "Trading",
    overview:
      "Mission control for the GoldEA basket trading system. Monitor open baskets, lot sizes, pending orders " +
      "and risk in one view — and push parameter updates to the MT4 EA.",
    status: "coming-soon",
    iconStyle: "orbit",
    hue: [40, 22],
  },
  {
    slug: "flowmaker",
    title: "FlowMaker",
    tag: "Visual automation",
    category: "Automation",
    overview:
      "A lightweight visual builder for personal automations. Connect triggers, actions and AI steps without " +
      "wrestling with full IPaaS platforms.",
    status: "coming-soon",
    iconStyle: "pulse",
    hue: [140, 180],
  },
  {
    slug: "portfolio",
    title: "Portfolio",
    tag: "Personal site",
    category: "Websites",
    overview:
      "The public-facing portfolio: featured work, case studies and a contact path. Fast, mobile-first, " +
      "and built to look sharp on phones.",
    status: "coming-soon",
    iconStyle: "aurora",
    hue: [220, 200],
  },
  {
    slug: "snippetbox",
    title: "SnippetBox",
    tag: "Code & prompt vault",
    category: "Utilities",
    overview:
      "A tiny searchable vault for the code snippets, prompts and shell commands you keep forgetting. " +
      "Tag, pin and copy in one tap.",
    status: "coming-soon",
    iconStyle: "mesh",
    hue: [10, 340],
  },
  {
    slug: "scratchpad",
    title: "Scratchpad",
    tag: "Quick capture",
    category: "Apps",
    overview:
      "An instant-open note for the half-formed thought you want to come back to later — captured to your " +
      "Projects Timeline inbox of choice in one tap.",
    status: "coming-soon",
    iconStyle: "waves",
    hue: [280, 320],
  },
];

export function getProject(slug: string): CatalogProject | null {
  return PROJECTS.find((p) => p.slug === slug) ?? null;
}
