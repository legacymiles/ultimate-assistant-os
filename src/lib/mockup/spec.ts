// ---------------------------------------------------------------------------
// Mockups — turning an approved spec into something drawable.
//
// The one rule here: EVERY WORD ON A MOCKUP COMES FROM THE OWNER'S OWN SPEC.
// No "Item 1", no lorem, no invented product names. The app's nav is its real
// sections, the rows are its accepted features, the audience is the audience
// they typed. A mockup full of placeholder text is the exact thing that makes
// a finished app read as a demo, so it is banned at the source rather than
// cleaned up afterwards.
//
// The numbers are the one exception — the app does not exist, so it has no
// data. They are seeded from the app's NAME, which makes them:
//   • identical in all three directions, so the bake-off compares design and
//     not noise. Three lanes showing different numbers is a broken experiment.
//   • identical across reloads, so the owner is not re-reading a changed page.
// The panel says they are illustrative, because quietly implying a brand-new
// app has 1,284 users is a lie the mockup does not need to tell.
// ---------------------------------------------------------------------------

import { KIND_LABEL, type AppType, type BuilderProject, type Feature } from "@/lib/app-builder/types";
import type { MockupRow, MockupSite, MockupSpec, MockupStat, Shape } from "./types";

/**
 * A small deterministic hash. Same name in, same numbers out, forever.
 * FNV-1a — not for security, only for "stop the page changing under me".
 */
export function seed(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

/** A stable pseudo-random stream from one seed. */
function stream(s: number): () => number {
  let x = s || 1;
  return () => {
    x ^= x << 13;
    x >>>= 0;
    x ^= x >> 17;
    x ^= x << 5;
    x >>>= 0;
    return x / 0xffffffff;
  };
}

/** What the main surface of this kind of app is full of. */
const SHAPE_BY_TYPE: Record<AppType, Shape> = {
  webapp: "list",
  website: "canvas",
  mobile: "feed",
  saas: "table",
  marketplace: "grid",
  tool: "table",
  game: "canvas",
};

/** What one of the things in it is called. */
const ENTITY_BY_TYPE: Record<AppType, string> = {
  webapp: "Items",
  website: "Sections",
  mobile: "Updates",
  saas: "Records",
  marketplace: "Listings",
  tool: "Entries",
  game: "Runs",
};

/**
 * Words in a feature list that mean the surface is really a board.
 *
 * Plurals are spelt out rather than left to `\b…\b`, because "move a job
 * through three stages" is the single most board-shaped sentence a feature
 * list can contain and `\bstage\b` does not match it.
 */
const BOARD_WORDS = /\b(stages?|status|statuses|pipelines?|kanban|boards?|columns?|track|tracks|tracking|tracker|workflows?|progress|queues?)\b/i;

/**
 * The longest a nav label may be before it stops reading as a destination.
 * "Export a tax year" (17) is a place; "Photograph a receipt" (20) is an act.
 */
const NAV_MAX = 18;

/** Words that mean it is really a feed. */
const FEED_WORDS = /\b(feeds?|timelines?|activity|logs?|history|streams?|chat|messages?)\b/i;

/**
 * The shape the app earns.
 *
 * The app type gets the first say, then the accepted features override it,
 * because "a tool for tracking submissions through three stages" is a board
 * whatever the dropdown said.
 */
export function shapeOf(appType: AppType, features: Feature[]): Shape {
  const text = features.map((f) => `${f.title} ${f.detail}`).join(" ");
  if (BOARD_WORDS.test(text)) return "board";
  if (appType === "tool" || appType === "saas") return SHAPE_BY_TYPE[appType];
  if (FEED_WORDS.test(text)) return "feed";
  return SHAPE_BY_TYPE[appType];
}

/** Trim a sentence to something that fits a row without cutting mid-word. */
export function clip(text: string, max: number): string {
  const t = (text || "").trim().replace(/\s+/g, " ");
  if (t.length <= max) return t;
  const cut = t.slice(0, max);
  const sp = cut.lastIndexOf(" ");
  const kept = sp > max * 0.6 ? cut.slice(0, sp) : cut;
  return `${kept.replace(/[,;:.–-]$/, "")}…`;
}

/** Title-case a noun for a nav item or a column heading. */
function title(text: string): string {
  const t = clip(text, 24);
  return t.charAt(0).toUpperCase() + t.slice(1);
}

function initials(name: string): string {
  const parts = (name || "").trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return "JS";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

/** A plausible count that is the same every time for this app. */
function count(rng: () => number, low: number, high: number): string {
  const n = Math.floor(low + rng() * (high - low));
  return n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n);
}

function unique(list: string[]): string[] {
  const seen = new Set<string>();
  return list.filter((x) => {
    const k = x.toLowerCase();
    if (!x || seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

/** One word for the people who use it, for a stat label. */
function audienceWord(audience: string | undefined): string {
  const a = (audience || "").trim();
  if (!a) return "People";
  const word = a.split(/[\s,]+/)[0].replace(/[^A-Za-z]/g, "");
  if (word.length < 3) return "People";
  const cap = word.charAt(0).toUpperCase() + word.slice(1);
  return /s$/i.test(cap) ? cap : `${cap}s`;
}

function columnsFor(shape: Shape, feats: Feature[]): string[] {
  if (shape === "board") return ["To do", "In progress", "Done"];
  if (shape === "table") return ["Name", "Kind", "Impact", "State"];
  return feats.slice(0, 3).map((f) => title(f.title));
}

function actionFor(appType: AppType, entity: string): string {
  const one = entity.replace(/s$/, "");
  if (appType === "marketplace") return `List a ${one.toLowerCase()}`;
  if (appType === "game") return "Play";
  if (appType === "website") return "Get started";
  return `New ${one.toLowerCase()}`;
}

/**
 * The spec, drawn from an App Builder project.
 *
 * Accepted features become the rows, in the order the owner ranked them, so
 * the mockup's main surface is literally the app they approved.
 */
export function specFromProject(p: BuilderProject): MockupSpec {
  const u = p.understanding;
  const name = (u?.name || p.idea || "New app").trim();
  const appType: AppType = u?.appType ?? "webapp";
  const accepted = p.features.filter((f) => f.status === "accepted");
  const feats = accepted.length ? accepted : p.features.filter((f) => f.status !== "denied");
  const rng = stream(seed(name));
  const shape = shapeOf(appType, feats);

  // Nav: the app's own sections. The screens a recording was taken apart into
  // are better than anything derivable from a feature list, so they win.
  //
  // Feature titles are the fallback, but most of them are VERB PHRASES —
  // "Photograph a receipt" is a thing you do, not a place you go — and a nav
  // bar full of sentences is the clearest sign a mockup was generated rather
  // than designed. So only titles short enough to read as a destination are
  // used, and the rest of the bar is filled with the two sections every app
  // of this kind has. Those are structure, not invented content.
  const fromTeardown = (p.teardown?.screens ?? []).map((s) => title(s.name)).filter(Boolean);
  const fromFeatures = feats
    .map((f) => f.title.split(/[,:–-]/)[0].trim())
    .filter((t) => t.length > 0 && t.length <= NAV_MAX)
    .map(title);
  const nav = unique([
    ENTITY_BY_TYPE[appType],
    ...(fromTeardown.length ? fromTeardown : fromFeatures),
    "Search",
    "Settings",
  ]).slice(0, 5);

  // 64, not 86: at a phone's measure an 86-character line wrapped to four
  // rows and made every card twice as tall as the thing it describes.
  const rows: MockupRow[] = feats.slice(0, 9).map((f) => ({
    title: clip(f.title, 52),
    meta: clip(f.detail || f.why, 64),
    tag: KIND_LABEL[f.kind],
    level: f.impact / 3,
  }));

  const stats: MockupStat[] = [
    { label: ENTITY_BY_TYPE[appType], value: count(rng, 18, 240) },
    { label: audienceWord(u?.audience), value: count(rng, 4, 90) },
    { label: "This week", value: count(rng, 3, 48), delta: `+${Math.floor(4 + rng() * 22)}%` },
  ];

  return {
    name,
    oneLiner: clip(u?.oneLiner || u?.purpose || p.idea, 120),
    audience: clip(u?.audience || "everyone", 48),
    shape,
    nav,
    entity: ENTITY_BY_TYPE[appType],
    stats,
    rows,
    columns: columnsFor(shape, feats),
    action: actionFor(appType, ENTITY_BY_TYPE[appType]),
    tools: ["Search", "Filter", "Sort"],
    detail: [
      { label: "For", value: clip(u?.audience || "everyone", 40) },
      { label: "Goal", value: clip(u?.endGoal || u?.purpose || "", 60) },
      { label: "Status", value: "Live" },
    ].filter((d) => d.value),
    who: initials(u?.name || "Jarvis Studio"),
    ...(isWebsite(p) ? { site: siteFromProject(p, feats), nav: siteNav(p, feats) } : {}),
  };
}

/** Is this project a website (drawn as a page), rather than an app? */
export function isWebsite(p: BuilderProject): boolean {
  return Boolean(p.redesign) || p.understanding?.appType === "website";
}

/** A short, human domain for a footer: "joesplumbing.com". */
export function domainOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

/** A website's nav: the live site's own, when it is a redesign. */
function siteNav(p: BuilderProject, feats: Feature[]): string[] {
  const own = (p.redesign?.nav ?? []).map((n) => title(n)).filter((n) => n.length <= NAV_MAX);
  if (own.length >= 2) return unique(own).slice(0, 5);
  const fromFeatures = feats
    .map((f) => f.title.split(/[,:–-]/)[0].trim())
    .filter((t) => t.length > 0 && t.length <= 14)
    .map(title);
  return unique(["Home", ...fromFeatures.slice(0, 3), "Contact"]).slice(0, 5);
}

/**
 * What the page says, top to bottom.
 *
 * For a redesign this is the live site's OWN words — its headings, its calls
 * to action, what it does — because the owner is judging "is this my site,
 * better", and a mockup full of feature-list jargon answers a different
 * question. New sites use the accepted features as the sections.
 */
export function siteFromProject(p: BuilderProject, feats: Feature[]): MockupSite {
  const u = p.understanding;
  const r = p.redesign;
  const keep = (r?.functionality ?? []).filter((f) => f.label);
  const headings = (r?.headings ?? []).map((h) => clip(h, 60)).filter(Boolean);
  const fromSite = headings.slice(1, 7).map((h, i) => ({
    title: clip(h, 40),
    body: clip(keep[i]?.detail || keep[i]?.label || r?.summary || "", 90),
  }));
  const fromFeatures = feats.slice(0, 6).map((f) => ({ title: clip(f.title, 40), body: clip(f.detail || f.why, 90) }));
  const sections = (fromSite.length >= 3 ? fromSite : [...fromSite, ...fromFeatures]).slice(0, 6);
  const ctas = unique([...(r?.ctas ?? []).map((c) => clip(c, 22)), "Get in touch"]).filter(Boolean).slice(0, 2);
  return {
    headline: clip(headings[0] || u?.oneLiner || r?.title || u?.name || p.idea, 70),
    sub: clip(r?.summary || u?.purpose || u?.oneLiner || p.idea, 150),
    ctas: ctas.length ? ctas : ["Get started"],
    sections,
    proof: u?.judge?.[0] ? clip(u.judge[0], 70) : undefined,
    footer: r ? domainOf(r.url) : clip(u?.audience || "", 40),
    oldColors: r?.colors?.slice(0, 6),
  };
}

/**
 * The spec for a version that has only its summary to go on.
 *
 * App Builder writes that summary as the app's one-liner followed by a bullet
 * per accepted feature (see app-builder/review.ts), so for a FIRST build —
 * where there are no edits yet and nothing deployed — those bullets are the
 * truest content available, and far better than drawing an empty app.
 */
export function specFromSummary(args: {
  siteName: string;
  clientName: string;
  version: string;
  summary: string;
}): MockupSpec {
  const lines = (args.summary || "")
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  const bullets = lines
    .filter((l) => /^[•\-*]\s*/.test(l))
    .map((l) => l.replace(/^[•\-*]\s*/, "").trim())
    .filter(Boolean);
  const head = lines.find((l) => !/^[•\-*]\s*/.test(l)) ?? args.siteName;
  const oneLiner = head.includes("—") ? head.split("—").slice(1).join("—").trim() : head;
  const rng = stream(seed(args.siteName));

  const rows: MockupRow[] = bullets.slice(0, 9).map((b) => ({
    title: clip(b, 52),
    meta: "In this version",
    level: 1,
  }));

  return {
    name: args.siteName,
    oneLiner: clip(oneLiner || args.siteName, 120),
    audience: args.clientName || "everyone",
    shape: rows.length > 5 ? "grid" : "list",
    nav: unique(["Home", ...bullets.slice(0, 4).map((b) => title(b.split(/[,:–-]/)[0]))]).slice(0, 5),
    entity: "Sections",
    stats: [
      { label: "Sections", value: String(Math.max(rows.length, 1)) },
      { label: "Pages", value: count(rng, 3, 9) },
      { label: "Version", value: args.version },
    ],
    rows,
    columns: bullets.slice(0, 3).map((b) => title(b)),
    action: "Get started",
    tools: ["Menu"],
    detail: [
      { label: "Site", value: clip(args.siteName, 40) },
      { label: "For", value: clip(args.clientName || "everyone", 40) },
      { label: "Version", value: args.version },
    ],
    who: initials(args.clientName || args.siteName),
    // A client's site is a website: draw the page, its sections the bullets.
    site: {
      headline: clip(oneLiner || args.siteName, 70),
      sub: clip(bullets.slice(0, 2).join(" · ") || `Built for ${args.clientName || "you"}`, 150),
      ctas: ["Get started", "Learn more"],
      sections: bullets.slice(0, 6).map((b) => ({ title: clip(b.split(/[,:–-]/)[0], 40), body: clip(b, 90) })),
      footer: args.version,
    },
  };
}

/**
 * The spec for a client's site, drawn from the edits they approved.
 *
 * Here the rows are the client's OWN REQUESTS, in their words — which makes
 * the mockup the clearest possible answer to "did you understand what I asked
 * for", before a build spends an hour finding out that it did not.
 */
export function specFromEdits(args: {
  siteName: string;
  clientName: string;
  version: string;
  edits: { text: string; pin?: { x: number; y: number } }[];
}): MockupSpec {
  const rng = stream(seed(args.siteName));
  const rows: MockupRow[] = args.edits.slice(0, 9).map((e, i) => ({
    title: clip(e.text, 52),
    meta: e.pin
      ? `Pointed at ${Math.round(e.pin.x * 100)}% across, ${Math.round(e.pin.y * 100)}% down`
      : "Asked for in writing",
    tag: `Edit ${i + 1}`,
    level: 1,
  }));
  const n = args.edits.length;
  return {
    name: args.siteName,
    oneLiner: `${args.version} — ${n} change${n === 1 ? "" : "s"} ${args.clientName || "the client"} asked for`,
    audience: args.clientName || "the client",
    shape: "list",
    nav: ["Changes", "Pages", "Before", "After"],
    entity: "Changes",
    stats: [
      { label: "Changes", value: String(n) },
      { label: "Pages", value: count(rng, 2, 9) },
      { label: "Version", value: args.version },
    ],
    rows,
    columns: ["Change", "Where", "State"],
    action: "Approve the look",
    tools: ["Before", "After"],
    detail: [
      { label: "Site", value: clip(args.siteName, 40) },
      { label: "For", value: clip(args.clientName || "the client", 40) },
      { label: "Version", value: args.version },
    ],
    who: initials(args.clientName || args.siteName),
    // The client's site with each change they asked for marked where it lands,
    // so "did you understand what I asked" is answered on the page itself.
    site: {
      headline: args.siteName,
      sub: `${args.version} — ${n} change${n === 1 ? "" : "s"} ${args.clientName || "you"} asked for, drawn in place.`,
      ctas: ["Approve the look", "See before"],
      sections: args.edits.slice(0, 6).map((e, i) => ({
        title: clip(e.text, 40),
        body: e.pin
          ? `Where you pointed: ${Math.round(e.pin.x * 100)}% across, ${Math.round(e.pin.y * 100)}% down the page.`
          : "Asked for in writing.",
        tag: `Change ${i + 1}`,
      })),
      footer: args.version,
    },
  };
}
