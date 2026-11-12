// ---------------------------------------------------------------------------
// Site context — what the mockups know about a site beyond one screenshot.
//
// The Flux mockups used to start from a single picture of one page, so they
// knew nothing the picture didn't show: not the other pages, not the forms
// that must keep working, not the look already chosen for page 1 when page 2
// came round. This module is the cure, after Google's stitch-skills pattern
// (DESIGN.md + SITE.md + a baton between pages), done locally and for free:
//
//   1. tools/mockup-edit/scan.mjs drives headless Chrome over the LIVE site
//      and reads the rendered DOM of each page — computed colours, fonts,
//      sections top to bottom, nav, forms, buttons, embeds, links.
//   2. This file turns those scans into three things:
//        DESIGN.md  — the site's design system as it really renders
//        SITE.md    — the sitemap and every feature that must keep working
//        pageBrief  — one page, top to bottom, for whoever writes the three
//                     readings (Claude in chat, or the hub's vision model)
//   3. A pick can be LOCKED: the chosen direction is written into DESIGN.md
//      and its picture becomes the style reference for every later page, so
//      page 2 is painted in the look picked on page 1.
//
// No imports on purpose, like edit.ts: the chat command loads this file with
// Node's own TypeScript support.
// ---------------------------------------------------------------------------

/** One colour the page renders, and how much of the page it covers. */
export interface ScanColor {
  hex: string;
  /** Background pixels for "bg", characters for "text", button area for "accent". */
  weight: number;
  role: "bg" | "text" | "accent";
}

export interface ScanType {
  family: string;
  /** px */
  size: number;
  weight: number;
  /** px, or 0 when "normal" */
  lineHeight?: number;
  /** px */
  letterSpacing?: number;
}

export interface ScanSection {
  /** header | hero | content | form | footer — a guess from what is inside. */
  kind: string;
  /** The section's first heading, or its first line of text. */
  heading: string;
  /** px from the top of the page */
  top: number;
  height: number;
  /** Background as hex, after looking up through transparent parents. */
  bg?: string;
  /** Short inventory: "3 cards", "form", "image", "video", "logo strip"… */
  holds?: string[];
}

export interface ScanCta {
  text: string;
  href?: string;
  bg?: string;
  color?: string;
  /** px */
  radius?: number;
}

export interface ScanForm {
  /** The form's heading, aria-label or submit text. */
  name: string;
  fields: string[];
  submit: string;
  action?: string;
}

/** What scan.mjs reads from one rendered page. */
export interface PageScan {
  url: string;
  path: string;
  title: string;
  description?: string;
  /** Full scroll height, px. */
  height: number;
  width: number;
  colors: ScanColor[];
  type: { h1?: ScanType; h2?: ScanType; body?: ScanType; button?: ScanType };
  /** Corner radii seen on buttons and cards, px, most common first. */
  radii: number[];
  sections: ScanSection[];
  nav: string[];
  ctas: ScanCta[];
  forms: ScanForm[];
  /** "YouTube video", "Google map", "checkout", "search", "login"… */
  embeds: string[];
  /** Same-origin pages this page links to, as paths. */
  links: string[];
  /** Headings and lead text, top to bottom. */
  text: string;
}

/** A pick the owner locked as the direction for the whole site. */
export interface SiteLock {
  /** The page it was picked on. */
  page: string;
  edit: string;
  label: string;
  instruction: string;
  /**
   * The LOOK alone, in words that apply to any page ("deep navy #0e232d
   * panels, red pill buttons with a soft glow"). The instruction names the
   * page it was picked on (its hero, its headline), so it can't be pasted
   * onto page 2; this can. Measured 2026-11-12: the locked picture as Flux's
   * image 2 barely moved page 2 — words carried the direction.
   */
  style?: string;
  tweaks: string[];
  /** The picked picture, copied next to the context so it outlives the board. */
  image: string;
  /** ISO date */
  at: string;
}

export interface SiteContext {
  name: string;
  origin: string;
  /** ISO date */
  scannedAt: string;
  device: "desktop" | "phone";
  pages: PageScan[];
  lock?: SiteLock;
}

// ----- small helpers ----------------------------------------------------------

function one(text: unknown, max: number): string {
  const t = String(text ?? "")
    .replace(/\s+/g, " ")
    .trim();
  return t.length > max ? `${t.slice(0, max - 1).trim()}…` : t;
}

const HEX = /^#[0-9a-f]{6}$/;

/**
 * A font's real name. Build tools hash the family a page loads —
 * next/font's "__Inter_d65c78", "Degular Display-49792c92be2412d3" —
 * and a designer, or Flux, needs "Inter" and "Degular Display".
 */
export function cleanFont(name: unknown): string {
  return String(name ?? "")
    .replace(/["']/g, "")
    .replace(/^__/, "")
    .replace(/(_Fallback)?_[0-9a-f]{5,}$/i, "")
    .replace(/[-_][0-9a-f]{8,}$/i, "")
    .replace(/_/g, " ")
    .trim();
}

/** "/about/" → "/about"; anything unparsable → "/". */
export function cleanPath(p: unknown): string {
  const s = String(p ?? "").split(/[?#]/)[0] || "/";
  const t = s.replace(/\/+$/, "");
  return t.startsWith("/") ? t || "/" : `/${t}`;
}

/** A file-safe name for a page: "/" → "home", "/blog/post-1" → "blog-post-1". */
export function pageSlug(p: string): string {
  const s = cleanPath(p).replace(/^\//, "").replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "").toLowerCase();
  return s || "home";
}

/** A folder-safe name for a site: "https://www.bloom-florist.co.uk" → "bloom-florist-co-uk". */
export function siteSlug(url: string): string {
  try {
    const u = new URL(url);
    const host = u.hostname.replace(/^www\./, "");
    const port = u.port ? `-${u.port}` : "";
    return `${host}${port}`.replace(/[^a-z0-9]+/gi, "-").toLowerCase();
  } catch {
    return "site";
  }
}

/** Perceived lightness 0–1. */
function lightness(hex: string): number {
  const n = parseInt(hex.slice(1), 16);
  const r = (n >> 16) & 255;
  const g = (n >> 8) & 255;
  const b = n & 255;
  return (0.299 * r + 0.587 * g + 0.114 * b) / 255;
}

/**
 * How much colour, 0–1: HSL saturation, so a dark forest green counts as a
 * colour, while near-black and near-white never do (their hue is noise).
 */
function chroma(hex: string): number {
  const n = parseInt(hex.slice(1), 16);
  const c = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => v / 255);
  const max = Math.max(...c);
  const min = Math.min(...c);
  const l = (max + min) / 2;
  if (l < 0.08 || l > 0.95 || max === min) return 0;
  return (max - min) / (1 - Math.abs(2 * l - 1));
}

/** Colours across pages, merged by role, heaviest first. */
export function palette(pages: PageScan[]): { bg: string[]; text: string[]; accent: string[] } {
  const sums: Record<ScanColor["role"], Map<string, number>> = { bg: new Map(), text: new Map(), accent: new Map() };
  for (const p of pages) {
    const total: Record<string, number> = { bg: 0, text: 0, accent: 0 };
    for (const c of p.colors) total[c.role] += c.weight;
    for (const c of p.colors) {
      const hex = String(c.hex).toLowerCase();
      if (!HEX.test(hex) || !sums[c.role]) continue;
      // Each page counts equally, whatever its length.
      const share = total[c.role] ? c.weight / total[c.role] : 0;
      sums[c.role].set(hex, (sums[c.role].get(hex) ?? 0) + share);
    }
  }
  const top = (m: Map<string, number>, n: number) =>
    [...m.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, n)
      .map(([h]) => h);
  // An accent is a colour, not a grey: a black button is a style, not a brand colour.
  const accent = top(sums.accent, 8).filter((h) => chroma(h) > 0.18);
  const bgColourful = top(sums.bg, 12).filter((h) => chroma(h) > 0.25);
  return {
    bg: top(sums.bg, 5),
    text: top(sums.text, 3),
    accent: [...new Set([...accent, ...bgColourful])].slice(0, 4),
  };
}

function fontsOf(pages: PageScan[]): { heading: string; body: string } {
  const first = (k: "h1" | "h2" | "body") => pages.map((p) => p.type[k]?.family).find(Boolean) ?? "";
  return { heading: first("h1") || first("h2"), body: first("body") };
}

function typeLine(t?: ScanType): string {
  if (!t) return "";
  const bits = [`${Math.round(t.size)}px`, `weight ${t.weight}`];
  if (t.lineHeight) bits.push(`line-height ${(t.lineHeight / t.size).toFixed(2)}`);
  if (t.letterSpacing) bits.push(`tracking ${t.letterSpacing.toFixed(1)}px`);
  return `${one(t.family, 40)} — ${bits.join(", ")}`;
}

function mostCommon(nums: number[]): number | undefined {
  const m = new Map<number, number>();
  for (const n of nums) m.set(n, (m.get(n) ?? 0) + 1);
  return [...m.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
}

/** The mood, in words a designer would use, read off the numbers. */
export function atmosphere(pages: PageScan[]): string {
  const pal = palette(pages);
  const bg = pal.bg[0];
  const words: string[] = [];
  if (bg) words.push(lightness(bg) < 0.35 ? "dark" : lightness(bg) > 0.9 ? "light" : "mid-tone");
  const h1 = pages.map((p) => p.type.h1).find(Boolean);
  if (h1) {
    if (h1.size >= 56) words.push("oversized display headlines");
    else if (h1.size <= 32) words.push("modest headlines");
    if (h1.weight >= 700) words.push("heavy type");
    else if (h1.weight <= 400) words.push("light, editorial type");
  }
  const r = mostCommon(pages.flatMap((p) => p.radii));
  if (r !== undefined) words.push(r === 0 ? "square corners" : r >= 999 || r >= 24 ? "pill / very round corners" : r <= 6 ? "tight corners" : "soft rounded corners");
  const avgSections = pages.length ? pages.reduce((s, p) => s + p.sections.length, 0) / pages.length : 0;
  if (avgSections >= 9) words.push("long, dense pages");
  else if (avgSections && avgSections <= 4) words.push("short, airy pages");
  if (pal.accent.length) words.push(`accent ${pal.accent[0]}`);
  return words.join(", ");
}

// ----- the three documents ------------------------------------------------------

/** The page a path names, or the first page scanned. */
export function pageOf(ctx: SiteContext, path?: string): PageScan | undefined {
  const want = cleanPath(path);
  return ctx.pages.find((p) => cleanPath(p.path) === want) ?? ctx.pages[0];
}

/** Everything on a page that an edit must not break, in plain words. */
export function pageFeatures(p: PageScan): string[] {
  const out: string[] = [];
  if (p.nav.length) out.push(`navigation: ${p.nav.slice(0, 10).join(", ")}`);
  for (const f of p.forms.slice(0, 4)) {
    const fields = f.fields.slice(0, 8).join(", ");
    out.push(`the "${one(f.name, 40)}" form (${fields || "no fields"} → ${one(f.submit, 30) || "submit"}${f.action ? `, posts to ${one(f.action, 60)}` : ""})`);
  }
  for (const c of p.ctas.slice(0, 5)) out.push(`the "${one(c.text, 40)}" button${c.href ? ` → ${one(c.href, 60)}` : ""}`);
  for (const e of p.embeds.slice(0, 5)) out.push(e);
  return out;
}

/** DESIGN.md — the design system as the site really renders it. */
export function designMd(ctx: SiteContext): string {
  const pal = palette(ctx.pages);
  const fonts = fontsOf(ctx.pages);
  const pick = <K extends keyof PageScan["type"]>(k: K) => ctx.pages.map((p) => p.type[k]).find(Boolean);
  const radii = [...new Set(ctx.pages.flatMap((p) => p.radii))].slice(0, 4);
  const ctas = ctx.pages
    .flatMap((p) => p.ctas)
    .filter((c) => c.bg && HEX.test(c.bg))
    .filter((c, i, a) => a.findIndex((x) => x.bg === c.bg && x.radius === c.radius) === i)
    .slice(0, 4);
  const lines = [
    `# DESIGN.md — ${ctx.name}`,
    "",
    `Read from the live site (${ctx.origin}) on ${ctx.scannedAt.slice(0, 10)}, ${ctx.pages.length} page${ctx.pages.length === 1 ? "" : "s"}, ${ctx.device}.`,
    "Every value below is what the browser rendered, not what a stylesheet hoped for.",
    "",
    "## 1. Atmosphere",
    atmosphere(ctx.pages) || "Not enough was read to say.",
    "",
    "## 2. Colour",
    `- Backgrounds: ${pal.bg.join(", ") || "—"}`,
    `- Text: ${pal.text.join(", ") || "—"}`,
    `- Accents (buttons, highlights): ${pal.accent.join(", ") || "none — the site is monochrome"}`,
    "",
    "## 3. Typography",
    `- Headings: ${fonts.heading || "—"}`,
    `- Body: ${fonts.body || "—"}`,
    pick("h1") ? `- H1: ${typeLine(pick("h1"))}` : "",
    pick("h2") ? `- H2: ${typeLine(pick("h2"))}` : "",
    pick("body") ? `- Body text: ${typeLine(pick("body"))}` : "",
    pick("button") ? `- Buttons: ${typeLine(pick("button"))}` : "",
    "",
    "## 4. Components",
    radii.length ? `- Corner radii in use: ${radii.map((r) => (r >= 999 ? "pill" : `${r}px`)).join(", ")}` : "",
    ...ctas.map((c) => `- Button "${one(c.text, 30)}": fill ${c.bg}${c.color ? `, text ${c.color}` : ""}${c.radius !== undefined ? `, radius ${c.radius >= 999 ? "pill" : `${c.radius}px`}` : ""}`),
    "",
    "## 5. Layout",
    ...ctx.pages.slice(0, 8).map((p) => `- ${p.path}: ${p.sections.map((s) => s.kind).join(" → ") || "—"}`),
  ];
  if (ctx.lock) {
    lines.push(
      "",
      "## 6. Locked direction",
      `Picked on ${ctx.lock.page} (${ctx.lock.at.slice(0, 10)}): "${one(ctx.lock.label, 40)}".`,
      ctx.lock.style ? `The look, for every page: ${one(ctx.lock.style, 400)}.` : "",
      `What it did on ${ctx.lock.page}: ${one(ctx.lock.instruction, 400)}.`,
      ...ctx.lock.tweaks.map((t) => `- then: ${one(t, 200)}`),
      `Picture: ${ctx.lock.image}`,
      "Every later page is painted and built in this direction. It overrides sections 1–4 where they disagree.",
    );
  }
  return lines.filter((l, i, a) => l !== "" || a[i - 1] !== "").join("\n").trim() + "\n";
}

/** SITE.md — the sitemap and what every page does. */
export function siteMd(ctx: SiteContext): string {
  const home = ctx.pages[0];
  const seen = new Set(ctx.pages.map((p) => cleanPath(p.path)));
  const unscanned = [...new Set(ctx.pages.flatMap((p) => p.links.map(cleanPath)))].filter((l) => !seen.has(l)).slice(0, 25);
  const lines = [
    `# SITE.md — ${ctx.name}`,
    "",
    "## Identity",
    `- Address: ${ctx.origin}`,
    home?.title ? `- Title: ${one(home.title, 120)}` : "",
    home?.description ? `- Says it is: ${one(home.description, 240)}` : "",
    "",
    "## Sitemap",
    ...ctx.pages.map((p) => `- [x] ${p.path} — ${one(p.title, 70)} (${p.sections.length} sections)`),
    ...unscanned.map((l) => `- [ ] ${l} — linked, not read yet`),
    "",
    "## Pages",
  ];
  for (const p of ctx.pages) {
    lines.push("", `### ${p.path}`);
    p.sections.forEach((s, i) => {
      const holds = s.holds?.length ? ` — ${s.holds.join(", ")}` : "";
      lines.push(`${i + 1}. ${s.kind}: "${one(s.heading, 80)}"${s.bg ? ` (bg ${s.bg})` : ""}${holds}`);
    });
    const feats = pageFeatures(p);
    if (feats.length) {
      lines.push("", "Must keep working:");
      for (const f of feats) lines.push(`- ${f}`);
    }
  }
  return lines.filter((l, i, a) => l !== "" || a[i - 1] !== "").join("\n").trim() + "\n";
}

/**
 * One page, top to bottom, plus the design system in two lines — what the
 * writer of the three readings needs to name real elements. Bounded, so it
 * fits beside a screenshot in a vision model's turn.
 */
export function pageBrief(ctx: SiteContext, path?: string, max = 2400): string {
  const p = pageOf(ctx, path);
  if (!p) return "";
  const pal = palette(ctx.pages);
  const fonts = fontsOf(ctx.pages);
  const lines = [
    `Page ${p.path} of ${ctx.name} (${ctx.pages.length} page${ctx.pages.length === 1 ? "" : "s"} read). Top to bottom:`,
    ...p.sections.map((s, i) => {
      const holds = s.holds?.length ? `; ${s.holds.join(", ")}` : "";
      return `${i + 1}. ${s.kind} "${one(s.heading, 70)}"${s.bg ? ` on ${s.bg}` : ""}${holds}`;
    }),
    `Colours: background ${pal.bg.slice(0, 2).join("/") || "?"}, text ${pal.text[0] ?? "?"}, accent ${pal.accent.slice(0, 2).join("/") || "none"}. Type: ${fonts.heading || "?"} headings, ${fonts.body || "?"} body.`,
  ];
  const feats = pageFeatures(p);
  if (feats.length) lines.push(`Must keep working: ${feats.join("; ")}.`);
  if (ctx.lock && cleanPath(ctx.lock.page) !== cleanPath(p.path)) {
    lines.push(
      `LOCKED DIRECTION for the whole site (picked on ${ctx.lock.page}): ${one(ctx.lock.style || ctx.lock.instruction, 300)}. Every reading must stay in this direction and say its colours in words.`,
    );
  }
  const text = lines.join("\n");
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

/** The facts edit.ts already understands, read from the scan instead of guessed from code. */
export function scanFacts(ctx: SiteContext, path?: string) {
  const p = pageOf(ctx, path);
  const pal = palette(ctx.pages);
  const fonts = fontsOf(ctx.pages);
  return {
    name: ctx.name,
    colors: [...pal.accent, ...pal.bg.slice(0, 2)].slice(0, 6),
    fonts: [fonts.heading, fonts.body].filter((f, i, a) => f && a.indexOf(f) === i),
    sections: (p?.sections ?? []).map((s) => one(s.heading, 60)).filter(Boolean),
    nav: p?.nav ?? [],
    features: p ? pageFeatures(p) : [],
    pages: ctx.pages.map((x) => x.path),
  };
}

/** Is there a lock that should steer THIS page? (Never the page it was picked on.) */
export function lockFor(ctx: SiteContext | null | undefined, path?: string): SiteLock | null {
  if (!ctx?.lock) return null;
  return cleanPath(ctx.lock.page) === cleanPath(path) ? null : ctx.lock;
}

/**
 * The words that carry a locked direction into the Flux prompt for another
 * page. The look in words does the work (Flux follows concrete visual
 * words); the picture rides along as image 2 for look, never layout — it is
 * a different page, so copying its sections would paint the wrong page.
 */
export function lockedStyleLine(lock: SiteLock, withImage = true): string {
  const look = one(lock.style || lock.instruction, 260);
  const img = withImage ? " Image 2 shows this look on another page: match its colours, type and finish, never its layout, sections or text." : "";
  return `The changed part must follow this site's chosen look: ${look}.${img}`;
}

/** A scan answer from the browser, checked (it crossed a process boundary). */
export function coerceScan(raw: unknown): PageScan | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  if (typeof o.url !== "string") return null;
  const arr = <T>(v: unknown, n: number): T[] => (Array.isArray(v) ? (v.slice(0, n) as T[]) : []);
  const str = (v: unknown, n: number) => (typeof v === "string" ? one(v, n) : "");
  const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : 0);
  const type: PageScan["type"] = {};
  const rawType = (o.type && typeof o.type === "object" ? o.type : {}) as Record<string, unknown>;
  for (const k of ["h1", "h2", "body", "button"] as const) {
    const t = rawType[k] as Record<string, unknown> | undefined;
    if (!t || typeof t !== "object" || !t.family) continue;
    type[k] = { family: cleanFont(t.family), size: num(t.size), weight: num(t.weight) || 400, lineHeight: num(t.lineHeight), letterSpacing: num(t.letterSpacing) };
  }
  return {
    url: o.url,
    path: cleanPath(o.path),
    title: str(o.title, 160),
    description: str(o.description, 300) || undefined,
    height: num(o.height),
    width: num(o.width),
    colors: arr<ScanColor>(o.colors, 60).filter((c) => c && HEX.test(String(c.hex)) && ["bg", "text", "accent"].includes(c.role)),
    type,
    radii: arr<number>(o.radii, 8).filter((n) => typeof n === "number"),
    sections: arr<ScanSection>(o.sections, 24).filter((s) => s && typeof s.kind === "string"),
    nav: arr<string>(o.nav, 16).map((s) => str(s, 40)).filter(Boolean),
    ctas: arr<ScanCta>(o.ctas, 12).filter((c) => c && typeof c.text === "string"),
    forms: arr<ScanForm>(o.forms, 6).filter((f) => f && Array.isArray(f.fields)),
    embeds: arr<string>(o.embeds, 10).map((s) => str(s, 60)).filter(Boolean),
    links: arr<string>(o.links, 120).map(cleanPath),
    text: str(o.text, 4000),
  };
}

/**
 * Which pages to read next. scan.mjs lists a page's links with the nav's
 * first (they are the site's own idea of what matters), so this keeps that
 * order, drops assets and legal/account pages, and stops at `max`.
 */
export function crawlOrder(start: PageScan, max: number): string[] {
  const skip = /\.(pdf|jpe?g|png|gif|webp|svg|zip|mp4|mp3|xml|txt|ico)$/i;
  const legal = /(privacy|terms|cookie|legal|sitemap|login|signin|sign-in|logout|cart|account|wp-admin|feed)/i;
  const all = start.links.map(cleanPath);
  const out: string[] = [];
  for (const l of all) {
    if (out.length >= max) break;
    if (l === cleanPath(start.path) || out.includes(l) || skip.test(l) || legal.test(l)) continue;
    out.push(l);
  }
  return out;
}
