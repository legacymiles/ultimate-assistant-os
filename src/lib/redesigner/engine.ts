// ---------------------------------------------------------------------------
// Website Redesigner — engine (server-side).
//
// Fetches + analyzes a real page and produces 3 redesign directions, each with
// a paste-ready, functionality-preserving build prompt. Ported from the
// pod-play-connect `redesign` Supabase edge function into the OS. The AI path
// lives in the route; this module holds the scrape, the offline heuristic, the
// prompt template and shared types (same split as lib/blueprint).
// ---------------------------------------------------------------------------

export interface DesignSkill {
  name: string;
  description: string;
}

export interface FunctionalityItem {
  kind: string;
  label: string;
  detail: string;
}

export interface Direction {
  id: string;
  name: string;
  pitch: string;
  drivingSkill: string;
  palette: string[];
  typography: { heading: string; body: string };
  layout: string;
  motion: string;
  referenceBar: string;
  buildPrompt: string;
}

export interface RedesignResult {
  analysis: {
    url: string;
    title: string;
    summary: string;
    functionality: FunctionalityItem[];
    confidence: "high" | "low";
  };
  directions: Direction[];
  engine: "ai" | "heuristic";
}

export interface ReqBody {
  url?: string;
  description?: string;
  ownSite?: boolean;
  sourcePath?: string;
  skills?: DesignSkill[];
}

export interface Scrape {
  title: string;
  description: string;
  headings: string[];
  ctas: string[];
  navItems: string[];
  functionality: FunctionalityItem[];
  colors: string[];
  confidence: "high" | "low";
}

// The roster of design skills the redesign directions can be driven by. Mirrors
// the website-redesigner skill's roster.
export const DEFAULT_SKILLS: DesignSkill[] = [
  {
    name: "interactive-web-studio",
    description:
      "Premium, cinematic, highly interactive sites — immersive motion, WebGL/Three.js, custom shaders, smooth scroll, scroll-driven storytelling. Best for expressive/experimental directions.",
  },
  {
    name: "capcut-design",
    description:
      "Clean, modern product UI with an exact token system (color, type, spacing). Best for polished, consistent, restrained directions.",
  },
  {
    name: "webgl-trail-reveal",
    description:
      "A mouse-trail image-reveal mechanic (calm ↔ dramatic). Best when the site has a strong hero image or a before/after story.",
  },
  {
    name: "exploded-showcase",
    description:
      "Cinematic 3D product teardown / exploded hero with labeled parts. Best when the site sells a physical product, device or machine.",
  },
];

// ----- Scrape ----------------------------------------------------------------

export async function scrapeUrl(url: string): Promise<Scrape> {
  const res = await fetch(url, {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (compatible; RedesignerBot/1.0; +https://ultimate-assistant-os)",
      Accept: "text/html,application/xhtml+xml",
    },
    redirect: "follow",
    signal: AbortSignal.timeout(12_000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const html = await res.text();

  const title =
    firstMatch(html, /<title[^>]*>([\s\S]*?)<\/title>/i) ||
    firstMatch(html, /<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i) ||
    hostname(url);

  const description =
    firstMatch(html, /<meta[^>]+name=["']description["'][^>]+content=["']([^"']+)["']/i) ||
    firstMatch(html, /<meta[^>]+property=["']og:description["'][^>]+content=["']([^"']+)["']/i) ||
    "";

  const headings = allMatches(html, /<h[12][^>]*>([\s\S]*?)<\/h[12]>/gi)
    .map(stripTags).filter(Boolean).slice(0, 12);

  const ctas = allMatches(
    html,
    /<(?:button|a)[^>]*class=["'][^"']*(?:btn|button|cta)[^"']*["'][^>]*>([\s\S]*?)<\/(?:button|a)>/gi,
  ).map(stripTags).filter(Boolean).slice(0, 10);

  const navItems = allMatches(html, /<nav[\s\S]*?<\/nav>/gi)
    .flatMap((nav) => allMatches(nav, /<a[^>]*>([\s\S]*?)<\/a>/gi))
    .map(stripTags).filter(Boolean).slice(0, 12);

  const functionality: FunctionalityItem[] = [];
  const forms = allMatches(html, /<form[\s\S]*?<\/form>/gi);
  forms.slice(0, 6).forEach((form, i) => {
    const inputs = allMatches(form, /<(?:input|select|textarea)[^>]*>/gi)
      .map((el) => firstMatch(el, /(?:name|placeholder|type)=["']([^"']+)["']/i))
      .filter(Boolean);
    functionality.push({
      kind: /search/i.test(form) ? "search" : "form",
      label: `Form ${i + 1}`,
      detail: inputs.length ? `fields: ${inputs.join(", ")}` : "submits data",
    });
  });
  if (navItems.length) {
    functionality.push({ kind: "nav", label: "Primary navigation", detail: navItems.join(", ") });
  }
  if (/type=["']password["']/i.test(html) || /(sign\s?in|log\s?in|account)/i.test(html)) {
    functionality.push({ kind: "auth", label: "Authentication", detail: "sign in / account access" });
  }
  if (/(add to cart|checkout|basket|\$\d)/i.test(html)) {
    functionality.push({ kind: "cart", label: "Commerce", detail: "cart / checkout / pricing" });
  }
  if (/<video|<iframe[^>]+(youtube|vimeo)/i.test(html)) {
    functionality.push({ kind: "media", label: "Media", detail: "embedded video/player" });
  }
  ctas.slice(0, 4).forEach((c) =>
    functionality.push({ kind: "cta", label: `CTA: ${c}`.slice(0, 60), detail: "primary action button" }),
  );

  const colors = Array.from(
    new Set(allMatches(html, /#[0-9a-fA-F]{6}\b/g).map((c) => c.toLowerCase())),
  ).slice(0, 8);

  const textLen = stripTags(html).replace(/\s+/g, " ").trim().length;
  const confidence: "high" | "low" = textLen < 400 || headings.length === 0 ? "low" : "high";

  return { title, description, headings, ctas, navItems, functionality, colors, confidence };
}

// ----- Heuristic fallback ----------------------------------------------------

const PRESETS = [
  {
    name: "Editorial Calm",
    tone: "restrained, content-first and trustworthy",
    skill: "capcut-design",
    palette: ["#111111", "#FAF8F4", "#C8A24B"],
    typography: { heading: "Fraunces / Playfair-style serif display", body: "Inter-style grotesque" },
    layout: "Generous whitespace, a strong type scale, single-column reading measure, clear sections.",
    motion: "Subtle fade/rise on scroll; nothing flashy.",
    bar: "stripe.com/blog",
  },
  {
    name: "Kinetic Dark",
    tone: "expressive, branded and confident",
    skill: "interactive-web-studio",
    palette: ["#0B0F1A", "#E6E9F2", "#6C5CE7", "#00E0C6"],
    typography: { heading: "Bold modern grotesque", body: "Neutral grotesque" },
    layout: "Dark canvas, high-contrast hero, sticky section transitions, bento feature grid.",
    motion: "Smooth scroll, magnetic buttons, scroll-driven reveals.",
    bar: "linear.app",
  },
  {
    name: "Experimental WebGL",
    tone: "experimental and high-wow",
    skill: "interactive-web-studio",
    palette: ["#050505", "#F5F5F5", "#FF4D2E"],
    typography: { heading: "Oversized display", body: "Mono-tinged grotesque" },
    layout: "Full-bleed WebGL hero, unconventional grid, cursor-reactive elements.",
    motion: "Shader background, custom cursor, playful physics on hover.",
    bar: "a current Awwwards Site of the Day",
  },
];

export function heuristicRedesign(
  url: string,
  scrape: Scrape,
  skills: DesignSkill[],
  body: ReqBody,
): RedesignResult {
  const skillNames = new Set(skills.map((s) => s.name));
  const directions: Direction[] = PRESETS.map((p, i) => {
    const drivingSkill = skillNames.has(p.skill) ? p.skill : skills[0]?.name ?? p.skill;
    return {
      id: `dir-${i}`,
      name: p.name,
      pitch: `A ${p.tone} take on ${scrape.title}.`,
      drivingSkill,
      palette: p.palette,
      typography: p.typography,
      layout: p.layout,
      motion: p.motion,
      referenceBar: p.bar,
      buildPrompt: templatePrompt(url, scrape, p, drivingSkill, body),
    };
  });

  return {
    analysis: {
      url,
      title: scrape.title,
      summary: scrape.description || `Redesign of ${scrape.title}.`,
      functionality: scrape.functionality,
      confidence: scrape.confidence,
    },
    directions,
    engine: "heuristic",
  };
}

export function templatePrompt(
  url: string,
  scrape: Scrape,
  p: (typeof PRESETS)[number],
  drivingSkill: string,
  body: ReqBody,
): string {
  const inventory = scrape.functionality.length
    ? scrape.functionality.map((f) => `- [${f.kind}] ${f.label} — ${f.detail}`).join("\n")
    : "- Preserve every interactive element, form, link and flow currently on the page.";

  const ownLine = body.ownSite
    ? `This is my own site${body.sourcePath ? ` (source at \`${body.sourcePath}\`)` : ""}. EDIT the existing source — keep all logic, event handlers, API calls and routes intact. Change the design layer only.`
    : `This is an external site — recreate the front-end and every behavior listed below under the new design. (Its backend can't be reproduced; wire the front-end to equivalent placeholders where needed.)`;

  return [
    `# Redesign ${scrape.title} — "${p.name}" direction`,
    ``,
    `Goal: redesign ${url} with a fresh visual design while keeping its functionality identical.`,
    ``,
    `${ownLine}`,
    ``,
    `## Functionality to preserve — exactly`,
    inventory,
    ``,
    `## Design direction: ${p.name}`,
    `- Feel: ${p.tone}.`,
    `- Palette: ${p.palette.join(", ")}.`,
    `- Typography: ${p.typography.heading} for headings, ${p.typography.body} for body.`,
    `- Layout: ${p.layout}`,
    `- Motion: ${p.motion}`,
    ``,
    `## How to build it`,
    `- Use the \`${drivingSkill}\` skill to drive the design and motion work.`,
    `- Use the site's REAL content (headings, copy, CTAs) — no lorem ipsum.`,
    `- Quality bar: make it beat ${p.bar}. Fetch that reference and hold your work to it.`,
    `- Optionally wrap the build in a gauntlet-loop (Builder vs blind Critic) until it beats the bar.`,
    ``,
    `Real content extracted from the page:`,
    `- Headings: ${scrape.headings.slice(0, 8).join(" | ") || "(fetch from the URL)"}`,
    `- CTAs: ${scrape.ctas.slice(0, 6).join(", ") || "(fetch from the URL)"}`,
  ].join("\n");
}

// ----- Helpers ---------------------------------------------------------------

export function normalizeUrl(raw?: string): string | null {
  if (!raw || typeof raw !== "string") return null;
  let s = raw.trim();
  if (!/^https?:\/\//i.test(s)) s = `https://${s}`;
  try {
    const u = new URL(s);
    if (u.protocol !== "http:" && u.protocol !== "https:") return null;
    return u.toString();
  } catch {
    return null;
  }
}

function hostname(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return url;
  }
}

function firstMatch(s: string, re: RegExp): string {
  const m = s.match(re);
  return m ? stripTags(m[1]).trim() : "";
}

function allMatches(s: string, re: RegExp): string[] {
  const out: string[] = [];
  let m: RegExpExecArray | null;
  const g = new RegExp(re.source, re.flags.includes("g") ? re.flags : re.flags + "g");
  while ((m = g.exec(s)) !== null) {
    out.push(m[1] ?? m[0]);
    if (out.length > 200) break;
  }
  return out;
}

function stripTags(s: string): string {
  return (s || "")
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&#\d+;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function str(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}

export function toStrArr(v: unknown, max: number): string[] {
  if (!Array.isArray(v)) return [];
  return v.map((x) => String(x).trim()).filter(Boolean).slice(0, max);
}
