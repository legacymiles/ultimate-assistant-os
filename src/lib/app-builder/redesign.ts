// ---------------------------------------------------------------------------
// App Builder — a redesign of a live site.
//
// Website Redesigner used to stop at three text directions and a "Copy prompt"
// button: nothing was built, nothing reached Client Review. Now a redesign IS
// an App Builder project, so it walks the same road every build does — Felix
// questions, a feature list, mockups, plain / commercial / commercial 2x,
// software-factory cards, the coding harness on the PC, and the Client Review
// link it posts itself to.
//
// The fit is natural because App Builder already knows how to rebuild a thing
// it took apart (a recording's "teardown", mode "change": keep what it does,
// change it to the owner's request). A read of a live page is the same shape:
// its screens, what it does, and the one change asked for — a new look.
//
// Pure: no fetch, no storage. The Redesigner reads the site; this turns the
// read into a project; the engine turns the project into a brief.
// ---------------------------------------------------------------------------

import { coerceFeatures, newProject } from "./engine";
import type { BuilderProject, Feature, Question, RedesignSource, Teardown, Understanding } from "./types";

/** What /api/redesign/scrape answers. */
export interface SiteRead {
  title?: string;
  summary?: string;
  navItems?: string[];
  ctas?: string[];
  headings?: string[];
  colors?: string[];
  functionality?: { kind?: string; label?: string; detail?: string }[];
  confidence?: "high" | "low";
}

/** What the owner typed into the Redesigner. */
export interface RedesignInput {
  url: string;
  note?: string;
  ownSite?: boolean;
  sourcePath?: string;
  skills?: string[];
}

const list = (v: unknown, max: number, len = 120): string[] =>
  Array.isArray(v)
    ? v
        .filter((x): x is string => typeof x === "string")
        .map((x) => x.replace(/\s+/g, " ").trim().slice(0, len))
        // A page repeats its nav in the header, the menu and the footer.
        .filter((x, i, all) => x && all.findIndex((y) => y.toLowerCase() === x.toLowerCase()) === i)
        .slice(0, max)
    : [];

/** A URL the owner typed, made fetchable. Empty when it can't be one. */
export function normalizeSiteUrl(raw: string): string {
  const t = (raw || "").trim();
  if (!t) return "";
  const withScheme = /^https?:\/\//i.test(t) ? t : `https://${t}`;
  try {
    const u = new URL(withScheme);
    return u.hostname.includes(".") ? u.toString() : "";
  } catch {
    return "";
  }
}

/** A short, human host for names and footers. */
export function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

/** The read and the owner's words, as the project keeps them. */
export function redesignSource(read: SiteRead | null, input: RedesignInput): RedesignSource {
  const url = normalizeSiteUrl(input.url) || input.url;
  const functionality = (Array.isArray(read?.functionality) ? read!.functionality : [])
    .map((f) => ({
      kind: String(f?.kind || "other").slice(0, 24),
      label: String(f?.label || "").replace(/\s+/g, " ").trim().slice(0, 80),
      detail: String(f?.detail || "").replace(/\s+/g, " ").trim().slice(0, 200),
    }))
    .filter((f) => f.label)
    .slice(0, 14);
  return {
    url,
    title: String(read?.title || "").trim().slice(0, 120) || hostOf(url),
    summary: String(read?.summary || "").trim().slice(0, 400),
    nav: list(read?.navItems, 8, 30),
    ctas: list(read?.ctas, 6, 30),
    headings: list(read?.headings, 10, 90),
    colors: list(read?.colors, 8, 12),
    functionality: plainFunctions(functionality),
    ownSite: Boolean(input.ownSite),
    ...(input.ownSite && input.sourcePath?.trim() ? { sourcePath: input.sourcePath.trim().slice(0, 300) } : {}),
    ...(input.note?.trim() ? { note: input.note.trim().slice(0, 1500) } : {}),
    ...(input.skills?.length ? { skills: input.skills.slice(0, 4) } : {}),
    confidence: read?.confidence === "low" || !read ? "low" : "high",
  };
}

/** The idea line App Builder starts from — what the owner would have typed. */
export function redesignIdea(r: RedesignSource): string {
  return [
    `Redesign ${r.title} (${r.url}) — give it a fresh, premium look and keep everything it does working exactly as it does now.`,
    r.ownSite ? `It's my own site${r.sourcePath ? `; the source is ${r.sourcePath}` : ""}.` : "",
    r.note ? `What I want from it: ${r.note}` : "",
  ]
    .filter(Boolean)
    .join(" ");
}

/**
 * The site, taken apart — App Builder's teardown, mode "change".
 *
 * One screen per page area the read found, the site's behaviours as the
 * things to keep, and the change asked for: a new look, same function.
 */
export function redesignTeardown(r: RedesignSource): Teardown {
  const home = {
    name: "Home page",
    purpose: r.summary || `The front page of ${r.title}.`,
    elements: [...r.headings.slice(0, 4), ...r.ctas.slice(0, 3).map((c) => `button "${c}"`)].slice(0, 8),
  };
  const pages = r.nav
    .filter((n) => !/^home$/i.test(n))
    .slice(0, 5)
    .map((n) => ({ name: n, purpose: `The "${n}" page in the site's navigation.`, elements: [] as string[] }));
  return {
    mode: "change",
    summary: `${r.title} at ${r.url}. ${r.summary || "A live website."} The owner wants a new look with every function kept.`.slice(0, 500),
    screens: [home, ...pages],
    flow: r.nav.length ? [`Visitors move between ${r.nav.slice(0, 6).join(", ")}`, ...r.ctas.slice(0, 3).map((c) => `Visitors press "${c}"`)] : [],
    behaviours: r.functionality.map((f) => `${f.label}${f.detail ? ` — ${f.detail}` : ""}`).slice(0, 10),
    dataModel: [],
    stackGuess: "",
    changes: ["A completely new look — layout, type, colour, motion — with every function and piece of content kept", ...(r.note ? [r.note] : [])],
    unknowns:
      r.confidence === "low"
        ? ["The page is drawn by JavaScript, so the read was thin: open the live site and list every page, form and flow before restyling."]
        : [],
  };
}

/** The first read of a redesign, before the agent has answered. */
export function redesignUnderstanding(r: RedesignSource): Understanding {
  // "Plumbing & Drain Cleaning You Can Trust | Mr. Rooter Plumbing": the brand
  // is the short part, wherever it sits.
  const parts = r.title
    .split(/\s[|–—-]\s|\|/)
    .map((x) => x.trim())
    .filter(Boolean);
  const name = (parts.sort((a, b) => a.length - b.length)[0] ?? "").slice(0, 40) || hostOf(r.url);
  const skill = r.skills?.[0] || "interactive-web-studio";
  return {
    name,
    oneLiner: r.summary.slice(0, 140) || `A new look for ${hostOf(r.url)}`,
    appType: "website",
    purpose: `A redesign of ${r.url} that looks premium and keeps everything it does.`,
    audience: "The site's visitors",
    endGoal: `Visitors to ${hostOf(r.url)} trust it on sight and do what they came to do faster.`,
    beyond: "The new site keeps converting better without anyone touching it.",
    model: "The site's own business",
    designSkill: skill,
    designWhy: r.skills?.length ? "the owner pinned it in the Redesigner" : "the hub default for anything user-facing",
    judge: [],
  };
}

/** A keep-check's name, from the thing it keeps: "The enquiry form still works". */
function keepName(label: string): string {
  const l = label.replace(/^the\s+/i, "").trim();
  return `${l.charAt(0).toUpperCase()}${l.slice(1)} still works`.slice(0, 70);
}

/**
 * The features every redesign starts with: each thing the site does today,
 * already accepted, because "keep it working" is the deal, not a suggestion.
 * The agent's own ideas for the new look come after these, for the owner to
 * accept or deny.
 */
export function keepFeatures(r: RedesignSource, startAt = 1): Feature[] {
  const raw = [
    {
      title: "Every page and its content kept",
      detail: `All the content of ${r.title}${r.nav.length ? ` — ${r.nav.slice(0, 6).join(", ")}` : ""} — carried over, in the site's own words. Nothing quietly dropped.`,
      why: "A redesign changes the look; what visitors came for stays.",
      kind: "core",
      impact: 3,
      effort: "M",
      // Each must-keep carries its own check, so "keeps everything it does" is
      // a test on the new site rather than a promise in a brief. This is the
      // regression suite for the whole redesign.
      scenarios: [
        ...(r.nav.length
          ? [
              {
                name: "Every page still there",
                when: `a visitor opens each page in the navigation (${r.nav.slice(0, 6).join(", ")})`,
                then: "each one loads on the new site with the same content it has today, and none 404s",
                proof: "browser" as const,
              },
            ]
          : []),
        {
          name: "No content dropped",
          when: "the new site's pages are compared with the live site's",
          then: `every heading and block of copy on the live site is present${r.headings.length ? `, including “${r.headings[0]}”` : ""}`,
          proof: "browser" as const,
        },
      ],
    },
    ...plainFunctions(r.functionality).slice(0, 7).map((f) => ({
      title: `Keep: ${f.label}`.slice(0, 60),
      detail: f.detail || `${f.label} works exactly as it does on the live site.`,
      why: "The live site does this today — the redesign must too.",
      kind: "core",
      impact: 3,
      effort: "S",
      scenarios: [
        {
          name: keepName(f.label),
          when: `a visitor uses ${f.label.toLowerCase()} on the redesigned site`,
          then: `it does what it does on the live site today${f.detail ? ` — ${f.detail.replace(/\.$/, "")}` : ""}, with the same result`,
          proof: "browser" as const,
        },
      ],
    })),
    ...(r.ctas.length
      ? [
          {
            title: "Same calls to action, clearer",
            detail: `${r.ctas.slice(0, 4).map((c) => `"${c}"`).join(", ")} keep their destinations and become the most obvious thing on each screen.`,
            why: "These are where the site earns; a redesign that hides them loses money.",
            kind: "growth",
            impact: 3,
            effort: "S",
            scenarios: [
              {
                name: "The buttons still go where they went",
                when: `a visitor presses ${r.ctas.slice(0, 3).map((c) => `"${c}"`).join(", ")} on the new site`,
                then: "each one arrives at the same destination it does on the live site",
                proof: "browser" as const,
              },
              {
                name: "Still the obvious thing to press",
                when: "any page is opened at 390 px wide",
                then: `“${r.ctas[0]}” is visible without scrolling and is the highest-contrast control on screen`,
                proof: "browser" as const,
              },
            ],
          },
        ]
      : []),
  ];
  return coerceFeatures(raw, startAt).map((f) => ({ ...f, status: "accepted" as const, source: "you" as const }));
}

/**
 * The page read's functions, in words the owner reads.
 *
 * The scraper names forms by number ("Form 3 — fields: text, text, email…")
 * and repeats a nav list as often as the page does. A must-keep list that says
 * "Keep: Form 5" twice is noise; "Keep: the enquiry form (asks for an email)"
 * once is a promise.
 */
export function plainFunctions(list: RedesignSource["functionality"]): RedesignSource["functionality"] {
  const out: RedesignSource["functionality"] = [];
  const seen = new Set<string>();
  for (const f of list) {
    let label = f.label;
    let detail = f.detail;
    const items = detail
      .replace(/^fields:\s*/i, "")
      .split(/,\s*/)
      .map((x) => x.trim())
      .filter(Boolean);
    if (/^form\s*\d+$/i.test(label)) {
      const named = items.find((x) => !/^(text|email|checkbox|radio|tel|number|select|textarea|submit|hidden|password)$/i.test(x));
      const hasEmail = items.some((x) => /email/i.test(x));
      label = named && items.length <= 2 ? `the "${named}" box` : hasEmail ? "the enquiry form" : items.length > 2 ? "the sign-up form" : "the search box";
      detail = `${items.length} field${items.length === 1 ? "" : "s"}${hasEmail ? ", including an email" : ""} — it still sends to the same place and validates the same way.`;
    } else if (items.length > 1) {
      // "Book Online, Call Us, Book Online, Call Us" → once each.
      detail = items.filter((x, i) => items.findIndex((y) => y.toLowerCase() === x.toLowerCase()) === i).join(", ");
    }
    const key = `${label}|${detail}`.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ ...f, label, detail });
  }
  return out;
}

/**
 * The whole project, ready for App Builder to start (`pending`): it opens,
 * the agent asks Felix's questions about the redesign, and the owner carries
 * on exactly as with any new app.
 */
export function redesignProject(r: RedesignSource, now = new Date()): BuilderProject {
  const p = newProject(redesignIdea(r), now);
  return {
    ...p,
    origin: "redesign",
    pending: true,
    redesign: r,
    teardown: redesignTeardown(r),
    understanding: redesignUnderstanding(r),
  };
}

/**
 * The understanding a redesign keeps, whatever the agent answered.
 *
 * Three things are fixed by the site rather than guessed from the idea line:
 * it is a website; it is called what the site is called (unless the owner
 * renamed it); and its look comes from a real UI design skill. The offline
 * guesser reads the word "redesign" in the idea and picks `website-redesigner`
 * — but in this flow that skill is already step one of the pipeline, and a
 * mockup lane cannot be drawn "in the website-redesigner direction".
 */
export function settleRedesign(next: Understanding, prev: Understanding | undefined, r: RedesignSource): Understanding {
  const pinned = r.skills?.[0];
  const candidate = next.designSkill && next.designSkill !== "website-redesigner" ? next.designSkill : prev?.designSkill;
  const skill = pinned || (candidate && candidate !== "website-redesigner" ? candidate : "interactive-web-studio");
  return {
    ...next,
    name: prev?.name || next.name,
    appType: "website",
    designSkill: skill,
    designWhy: pinned ? "the owner pinned it in the Redesigner" : skill === next.designSkill ? next.designWhy : "the hub default for anything user-facing",
  };
}

/** Felix's questions for a redesign, when the agent can't be reached. First option = recommended. */
export function redesignQuestions(): Question[] {
  return [
    {
      id: "purpose",
      label: "What should the redesign do?",
      hint: "What should be true once the new look is live — more calls, more trust, looks as good as the work is.",
      options: ["More enquiries and bookings", "Look as premium as the work", "Work properly on phones", "Feel modern without losing who we are"],
      free: true,
    },
    { id: "audience", label: "Who visits it?", options: ["Local customers", "Businesses", "Clients I already have", "The public"], free: true },
    {
      id: "keep",
      label: "What must never change?",
      options: ["Logo and brand colours", "All the wording", "The page structure", "Nothing — start fresh"],
      multi: true,
      free: true,
    },
    {
      id: "success",
      label: "How will we know it worked?",
      options: ["More calls, forms or bookings", "Never crashes, fast on phones", "People finish the main task without help", "Looks better than the competition"],
      multi: true,
      free: true,
    },
    { id: "look", label: "Look & feel", options: ["Clean & professional", "Futuristic & cinematic", "Bold & playful", "Minimal & calm"], free: true },
  ];
}

/** The upgrades a top agency would propose for any redesign, for the owner to accept or deny. */
export function redesignUpgrades(r: RedesignSource, startAt = 1): Feature[] {
  const cta = r.ctas[0] ? `"${r.ctas[0]}"` : "the main call to action";
  return coerceFeatures(
    [
      { title: "A hero that sells in five seconds", detail: `What ${r.title} does, for whom, and ${cta} — readable before the first scroll on a phone.`, why: "Visitors decide in seconds; the old page makes them hunt.", kind: "experience", impact: 3, effort: "M" },
      { title: "Phone-first layout", detail: "Every page designed at 390px first, thumb-reach buttons, no sideways scroll.", why: "Most visitors arrive on a phone.", kind: "experience", impact: 3, effort: "M", checklist: ["U1"] },
      { title: "Trust strip", detail: "Reviews, guarantees, years in business and accreditations, close to every call to action.", why: "Trust is what turns a visit into a call.", kind: "trust", impact: 3, effort: "S" },
      { title: "Contact from anywhere", detail: `${cta} and the phone number stay in reach on every page, including a sticky bar on phones.`, why: "The site earns when people get in touch.", kind: "growth", impact: 3, effort: "S" },
      { title: "Fast on a phone", detail: "Images sized and lazy-loaded, fonts preloaded; LCP under 1.5 s on a mid-range phone.", why: "A slow page loses the visitor before the new look is seen.", kind: "experience", impact: 2, effort: "S", checklist: ["P1", "P2"] },
      { title: "Found in search", detail: "Real titles and descriptions per page, local business schema, a sitemap, social preview cards.", why: "A redesign that drops out of Google is a step back.", kind: "growth", impact: 2, effort: "S", checklist: ["P3"] },
      { title: "Accessible to everyone", detail: "Contrast that passes, visible focus, keyboard navigation, alt text, reduced-motion respected.", why: "More people can use it, and it reads as quality.", kind: "trust", impact: 2, effort: "S" },
      { title: "Purposeful motion", detail: "Section reveals and hover feedback that guide the eye to the next step — never decoration.", why: "Motion is what makes a site feel premium rather than templated.", kind: "experience", impact: 2, effort: "M" },
    ],
    startAt,
  );
}

export { redesignBrief, redesignText } from "./redesignBrief";
