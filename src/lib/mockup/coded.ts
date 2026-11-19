// ---------------------------------------------------------------------------
// Mockups — written by Claude as real HTML and CSS.
//
// Replaces the Flux 2 pictures (owner's call, 18 Nov 2026: "it looks better,
// more accurate and faster"). Each lane is ONE self-contained HTML document
// that Claude writes from the page as it is (its markup, its screenshot, its
// colours and fonts) or from the spec and a design direction. The bake-off
// shows it in a sandboxed iframe, so the owner judges a real page: real text,
// real type, real spacing, at a real device width — not a painting of one.
//
// Why this beats a picture model:
//   - words come out exactly right (Flux garbled any text it had to move);
//   - a lane takes seconds, not 1–3 GPU minutes, and all three are written at
//     once instead of queueing for one GPU;
//   - the mockup IS markup, so the builder can read what it is matching.
//
// Pure: it builds prompts and cleans answers, never fetches. No runtime
// imports, so Node can run it straight from the chat command as well.
// ---------------------------------------------------------------------------

import type { CustomLane, EditLaneId, SiteFacts } from "./edit";

export type CodedDevice = "desktop" | "phone";

/** The width each lane is written for. Same frames the iframes are drawn at. */
export const CODED_WIDTH: Record<CodedDevice, number> = { desktop: 1280, phone: 390 };

/** A written mockup can be at most this big. Bigger is a model running away. */
export const CODED_MAX = 160_000;

/** How much of the live page's markup the writer reads. */
export const PAGE_MARKUP_MAX = 40_000;

/** A design direction, as plain data (the hook resolves the skin). */
export interface CodedLook {
  skill: string;
  note: string;
  /** Surface, text and accent colours as hex. */
  surface: string;
  ink: string;
  accent: string;
  light: boolean;
  /** How headlines read: "elegant high-contrast serif", "monospace technical"… */
  type: string;
  radius: number;
  /** "sidebar console", "printed sheet", "centred editorial column"… */
  arrangement: string;
}

/** What the app or site is, in its own words (from the approved spec). */
export interface CodedSpec {
  name: string;
  oneLiner: string;
  audience?: string;
  nav: string[];
  /** Website: what the page says top to bottom. */
  site?: { headline: string; sub: string; ctas: string[]; sections: { title: string; body: string }[]; proof?: string; footer?: string };
  /** App: what the main surface is full of. */
  app?: { entity: string; action: string; columns: string[]; rows: { title: string; meta: string; tag?: string }[]; stats: { label: string; value: string }[] };
}

export type CodedRequest =
  | {
      kind: "edit";
      /** The change, in the asker's words. */
      edit: string;
      lane: EditLaneId;
      /** A reading someone already wrote for this lane (Claude in chat), else the lane's role decides. */
      reading?: CustomLane;
      siteName: string;
      url?: string;
      device: CodedDevice;
      facts?: SiteFacts;
      /** The live page's markup, already trimmed (trimMarkup). */
      markup?: string;
      /** The page's outline and what must keep working (site-context pageBrief), when the site was read. */
      outline?: string;
    }
  | {
      kind: "look";
      spec: CodedSpec;
      look: CodedLook;
      role: "recommended" | "contrast";
      device: CodedDevice;
    }
  | {
      kind: "tweak";
      /** The lane's current document — the tweak changes this, not the original. */
      html: string;
      change: string;
      siteName: string;
      device: CodedDevice;
    };

const ROLE: Record<EditLaneId, { label: string; brief: string }> = {
  faithful: {
    label: "As asked",
    brief: "Do exactly what was asked, in the site's existing style, as if the site's own designer made the change. Change nothing else.",
  },
  polished: {
    label: "Polished",
    brief:
      "Do what was asked, then bring the section it touches up to a premium finish: two or three specific refinements (spacing, type scale, a refined button, one tasteful detail). The rest of the page stays as it is.",
  },
  bold: {
    label: "Bold",
    brief:
      "Do what was asked as a clearly different, braver composition of that section — a new layout for it, stronger contrast, a clear focal point. Keep the site recognisably itself: same brand, nav, words and colours.",
  },
};

export const CODED_SYSTEM = `You are a senior product designer who mocks up web pages directly in HTML and CSS. Your mockup is shown to the owner in a sandboxed iframe at a real device width so they can pick a version before anything is built — it must look like a finished, real page, not a wireframe.

Write ONE complete, self-contained HTML document:
- Start with <!doctype html>. All CSS in one <style> in the <head>. Google Fonts <link> tags are allowed; nothing else external except images the page already uses (absolute https URLs).
- NO <script>, no event-handler attributes, no forms that submit anywhere, no iframes. Scripts will not run.
- Real content only: use the page's own words, names and numbers. Never "Lorem ipsum", "Item 1" or "Your headline here".
- Pictures: reuse the page's own image URLs when given; otherwise draw with CSS (gradients, shapes) or small inline SVG. Never a grey box with "image" in it.
- Show at least the first screen and the sections the change touches, top to bottom, at the width given. Lay it out for that width (a phone is not a squeezed desktop).
- Polish like a top studio: a clear type scale, consistent spacing, real hover and focus styles, accessible contrast.
- Put two tags in the <head>: <meta name="mockup-label" content="1-3 words naming this version's idea"> and <meta name="mockup-reading" content="one concrete sentence, at most 60 words, saying exactly what this version changes — real elements, layout, sizes, colours as hex">.

Reply with the HTML document only.`;

const one = (s: unknown, max = 400) => {
  const t = String(s ?? "").replace(/\s+/g, " ").trim();
  return t.length > max ? `${t.slice(0, max - 1).trim()}…` : t;
};

function factsBlock(facts?: SiteFacts): string {
  if (!facts) return "";
  const lines: string[] = [];
  const colors = (facts.colors ?? []).filter((c) => /^#[0-9a-f]{3,8}$/i.test(c)).slice(0, 6);
  if (colors.length) lines.push(`Brand colours (most used first): ${colors.join(", ")}`);
  if (facts.fonts?.length) lines.push(`Fonts: ${facts.fonts.slice(0, 3).map((f) => one(f, 40)).join(", ")}`);
  if (facts.nav?.length) lines.push(`Navigation: ${facts.nav.slice(0, 8).map((n) => one(n, 30)).join(" · ")}`);
  if (facts.sections?.length) lines.push(`Sections, top to bottom: ${facts.sections.slice(0, 12).map((n) => one(n, 50)).join(" · ")}`);
  if (facts.features?.length) lines.push(`Must keep working (show them, unchanged unless the change is about them): ${facts.features.slice(0, 10).map((n) => one(n, 80)).join("; ")}`);
  return lines.join("\n");
}

/** The user turn for one lane. */
export function codedUser(req: CodedRequest): string {
  const width = `${CODED_WIDTH[req.device]}px wide (${req.device === "phone" ? "a phone" : "a desktop browser"})`;
  if (req.kind === "tweak") {
    return [
      `Here is a mockup of ${one(req.siteName, 60) || "a website"}, ${width}.`,
      `Change it like this: ${one(req.change, 1500)}`,
      "Keep everything else exactly as it is — layout, words, colours, fonts. Update the mockup-label and mockup-reading tags so they describe the version as it is now.",
      "Return the whole updated document.",
      "",
      "<current_mockup>",
      req.html.slice(0, CODED_MAX),
      "</current_mockup>",
    ].join("\n");
  }
  if (req.kind === "look") {
    const { spec, look } = req;
    const content = spec.site
      ? [
          `Headline: ${one(spec.site.headline, 120)}`,
          `Under it: ${one(spec.site.sub, 240)}`,
          spec.site.ctas.length ? `Calls to action: ${spec.site.ctas.map((c) => one(c, 40)).join(" · ")}` : "",
          spec.site.sections.length ? `Sections:\n${spec.site.sections.slice(0, 8).map((s) => `- ${one(s.title, 60)}: ${one(s.body, 200)}`).join("\n")}` : "",
          spec.site.proof ? `Proof: ${one(spec.site.proof, 160)}` : "",
          spec.site.footer ? `Footer: ${one(spec.site.footer, 80)}` : "",
        ]
      : spec.app
        ? [
            `The main screen is full of ${one(spec.app.entity, 40)}. Primary action: ${one(spec.app.action, 40)}.`,
            spec.app.stats.length ? `Numbers at the top: ${spec.app.stats.slice(0, 4).map((s) => `${one(s.label, 30)} ${one(s.value, 16)}`).join(" · ")}` : "",
            spec.app.columns.length ? `Columns: ${spec.app.columns.slice(0, 6).map((c) => one(c, 24)).join(" · ")}` : "",
            spec.app.rows.length ? `Rows:\n${spec.app.rows.slice(0, 8).map((r) => `- ${one(r.title, 60)} — ${one(r.meta, 80)}${r.tag ? ` [${one(r.tag, 16)}]` : ""}`).join("\n")}` : "",
          ]
        : [];
    return [
      `Mock up ${spec.site ? "the home page of a website" : "the main screen of a web app"}, ${width}.`,
      `Name: ${one(spec.name, 60)} — ${one(spec.oneLiner, 240)}`,
      spec.audience ? `For: ${one(spec.audience, 160)}` : "",
      spec.nav.length ? `Navigation: ${spec.nav.slice(0, 7).map((n) => one(n, 24)).join(" · ")}` : "",
      ...content,
      "",
      `Design direction — ${look.skill}${req.role === "recommended" ? " (the recommended one)" : " (a contrasting alternative)"}: ${one(look.note, 240)}`,
      `- ${look.light ? "Light" : "Dark"} surface ${look.surface}, text ${look.ink}, accent ${look.accent}.`,
      `- Headlines: ${look.type}. Corner radius around ${look.radius}px.`,
      `- Arrangement: ${look.arrangement}.`,
      "Commit to this direction fully — it is being compared side by side with two others, so it must look like its own design, not a palette swap.",
    ]
      .filter(Boolean)
      .join("\n");
  }
  const role = ROLE[req.lane];
  const reading = req.reading?.instruction?.trim();
  return [
    `Mock up ${one(req.siteName, 60) || "this website"}${req.url ? ` (${req.url})` : ""} as it is now, ${width}, with ONE change made to it.`,
    `The change asked for: ${one(req.edit, 6000)}`,
    reading
      ? `This version (${one(req.reading?.label || role.label, 32)}) does exactly this: ${one(reading, 1200)}`
      : `This version is "${role.label}": ${role.brief}`,
    "Recreate the page faithfully — same logo text, navigation, headings, words, colours, fonts, spacing and section order as the real page — so the only visible difference is the change. When a screenshot is attached, match it closely.",
    factsBlock(req.facts),
    req.outline ? `Page outline, read from the rendered page:\n${String(req.outline).slice(0, 3000)}` : "",
    req.markup ? `The live page's markup (trimmed — scripts and long attributes removed):\n<page_markup>\n${req.markup.slice(0, PAGE_MARKUP_MAX)}\n</page_markup>` : "",
  ]
    .filter(Boolean)
    .join("\n\n");
}

/** The default label for a lane, before Claude names it. */
export function roleLabel(lane: EditLaneId): string {
  return ROLE[lane].label;
}

// ----- reading the page ------------------------------------------------------

/**
 * The live page's markup, cut down to what a designer needs to recreate it.
 *
 * Scripts, styles, SVG path data, comments, data-/aria- attributes and
 * framework noise go; class names stay (they say a lot about the styling);
 * relative image and link addresses become absolute so the mockup can reuse
 * the page's own pictures.
 */
export function trimMarkup(html: string, base?: string): string {
  let s = String(html || "");
  const body = /<body[^>]*>([\s\S]*)<\/body>/i.exec(s);
  const head = /<head[^>]*>([\s\S]*?)<\/head>/i.exec(s);
  const title = head ? /<title[^>]*>([\s\S]*?)<\/title>/i.exec(head[1])?.[1]?.trim() : "";
  const fonts = head
    ? [...head[1].matchAll(/<link[^>]+href="?(https:\/\/fonts\.googleapis\.com[^"\s>]+)"?/gi)].map((m) => m[1]).slice(0, 3)
    : [];
  // The page's own inline CSS is the most exact statement of its look there
  // is; kept (capped) so the mockup matches it. Linked stylesheets are not
  // fetched — the screenshot and class names carry those.
  const css = head
    ? [...head[1].matchAll(/<style[^>]*>([\s\S]*?)<\/style>/gi)]
        .map((m) => m[1].replace(/\/\*[\s\S]*?\*\//g, "").replace(/\s+/g, " ").trim())
        .join(" ")
        .slice(0, 8000)
    : "";
  s = body ? body[1] : s;
  s = s
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<(script|style|noscript|template|iframe|object|embed)\b[\s\S]*?<\/\1>/gi, "")
    .replace(/<(script|link|meta)\b[^>]*>/gi, "")
    .replace(/<svg\b[\s\S]*?<\/svg>/gi, "<svg/>")
    .replace(/\s(?:data-[\w-]+|aria-[\w-]+|style|srcset|sizes|loading|decoding|fetchpriority|tabindex|role|id)="[^"]*"/gi, "")
    .replace(/\s(?:on\w+)="[^"]*"/gi, "")
    .replace(/\sclass="([^"]{160,})"/gi, (_m, c: string) => ` class="${c.slice(0, 160)}…"`)
    .replace(/\s(src|href)="data:[^"]*"/gi, ' $1="data:…"');
  if (base) {
    s = s.replace(/\s(src|href)="(\/[^"]*)"/gi, (m, attr: string, p: string) => {
      try {
        return ` ${attr}="${new URL(p, base).href}"`;
      } catch {
        return m;
      }
    });
  }
  s = s.replace(/\s{2,}/g, " ").replace(/>\s+</g, "><").trim();
  const headLine = [
    title ? `<title>${title}</title>` : "",
    ...fonts.map((f) => `<link rel="stylesheet" href="${f}">`),
    css ? `<style>${css}</style>` : "",
  ].join("");
  return `${headLine}${s}`.slice(0, PAGE_MARKUP_MAX);
}

// ----- the answer ------------------------------------------------------------

/** Undo one layer of JSON string escaping, for an answer that came back wrapped. */
function unwrapJson(text: string): string {
  const t = text.trim();
  if (!t.startsWith("{")) return t;
  try {
    const j = JSON.parse(t) as { answer?: unknown; html?: unknown };
    if (typeof j.answer === "string") return j.answer;
    if (typeof j.html === "string") return j.html;
  } catch {
    const m = /^\{\s*"(?:answer|html)"\s*:\s*"([\s\S]*)"\s*\}$/.exec(t);
    if (m) {
      try {
        return JSON.parse(`"${m[1]}"`) as string;
      } catch {
        return m[1].replace(/\\n/g, "\n").replace(/\\"/g, '"').replace(/\\\\/g, "\\");
      }
    }
  }
  return t;
}

/**
 * The document in a model's answer, made safe to show.
 *
 * The iframe never runs scripts (no allow-scripts), and this strips them
 * anyway, with event handlers, javascript: links, frames and meta refreshes —
 * a mockup saved for a client is shown on their screen too. Empty when there
 * is no document in the answer.
 */
export function cleanMockupHtml(answer: string): string {
  let t = unwrapJson(String(answer ?? ""));
  const fence = /```(?:html)?\s*([\s\S]*?)```/i.exec(t);
  if (fence && /<html|<!doctype/i.test(fence[1])) t = fence[1];
  const start = t.search(/<!doctype html|<html[\s>]/i);
  if (start < 0) return "";
  t = t.slice(start);
  const end = t.toLowerCase().lastIndexOf("</html>");
  t = end >= 0 ? t.slice(0, end + 7) : `${t}\n</html>`;
  t = t
    .replace(/<script\b[\s\S]*?<\/script\s*>/gi, "")
    .replace(/<script\b[^>]*\/?>/gi, "")
    .replace(/<(iframe|frame|frameset|object|embed|base)\b[\s\S]*?(?:<\/\1\s*>|\/?>)/gi, "")
    .replace(/<meta[^>]+http-equiv\s*=\s*["']?refresh[^>]*>/gi, "")
    .replace(/\son\w+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, "")
    .replace(/(href|src|action|formaction)\s*=\s*(["'])\s*javascript:[^"']*\2/gi, '$1="#"');
  if (t.length > CODED_MAX) return "";
  return t.trim();
}

/** The label and reading Claude put in the document's head. */
export function mockupMeta(html: string): { label: string; reading: string } {
  // A value can hold the other quote ("the page's hero", 'the "Shop" button'),
  // so each quote style is matched up to its own closing quote.
  const content = `content=(?:"([^"]*)"|'([^']*)')`;
  const get = (name: string) => {
    const tag = new RegExp(`<meta\\b[^>]*\\bname=["']${name}["'][^>]*>`, "i").exec(html)?.[0] ?? "";
    const m = new RegExp(content, "i").exec(tag);
    const raw = m ? (m[1] ?? m[2] ?? "") : "";
    return raw ? one(raw.replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, "&"), name === "mockup-label" ? 32 : 600) : "";
  };
  return { label: get("mockup-label"), reading: get("mockup-reading") };
}

/**
 * A request from the browser, checked field by field before it reaches a
 * model: known kinds and lanes only, every string bounded. Null when it isn't
 * one.
 */
export function coerceCodedRequest(raw: unknown): CodedRequest | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const str = (v: unknown, max: number) => (typeof v === "string" ? v.slice(0, max) : "");
  const list = (v: unknown, n: number, max: number) => (Array.isArray(v) ? v.filter((x) => typeof x === "string").slice(0, n).map((x) => (x as string).slice(0, max)) : []);
  const device: CodedDevice = o.device === "phone" ? "phone" : "desktop";
  if (o.kind === "tweak") {
    const html = str(o.html, CODED_MAX);
    const change = str(o.change, 1500).trim();
    if (!html || !change) return null;
    return { kind: "tweak", html, change, siteName: str(o.siteName, 80), device };
  }
  if (o.kind === "edit") {
    const edit = str(o.edit, 6000).trim();
    const lane = o.lane === "polished" || o.lane === "bold" ? o.lane : o.lane === "faithful" ? "faithful" : null;
    if (!edit || !lane) return null;
    const r = (o.reading ?? null) as Record<string, unknown> | null;
    const f = (o.facts ?? null) as Record<string, unknown> | null;
    return {
      kind: "edit",
      edit,
      lane,
      ...(r && typeof r.instruction === "string" && r.instruction.trim() ? { reading: { label: str(r.label, 40), instruction: str(r.instruction, 1500) } } : {}),
      siteName: str(o.siteName, 80),
      ...(typeof o.url === "string" && /^https?:\/\//.test(o.url) ? { url: o.url.slice(0, 600) } : {}),
      device,
      ...(f
        ? {
            facts: {
              name: str(f.name, 80) || undefined,
              colors: list(f.colors, 8, 12),
              fonts: list(f.fonts, 4, 60),
              sections: list(f.sections, 16, 80),
              nav: list(f.nav, 10, 40),
              features: list(f.features, 12, 140),
            },
          }
        : {}),
      ...(typeof o.markup === "string" && o.markup ? { markup: o.markup.slice(0, PAGE_MARKUP_MAX) } : {}),
      ...(typeof o.outline === "string" && o.outline ? { outline: o.outline.slice(0, 3000) } : {}),
    };
  }
  if (o.kind === "look") {
    const s = (o.spec ?? null) as Record<string, unknown> | null;
    const l = (o.look ?? null) as Record<string, unknown> | null;
    if (!s || !l || !str(s.name, 80)) return null;
    // The spec's inner shapes are only ever read as text, so bounding the whole
    // thing is enough: a re-serialised copy, cut to size.
    let spec: CodedSpec;
    try {
      spec = JSON.parse(JSON.stringify(s).slice(0, 20_000)) as CodedSpec;
    } catch {
      return null;
    }
    spec.nav = list(spec.nav, 8, 40);
    return {
      kind: "look",
      spec,
      look: {
        skill: str(l.skill, 60),
        note: str(l.note, 300),
        surface: str(l.surface, 12),
        ink: str(l.ink, 12),
        accent: str(l.accent, 12),
        light: Boolean(l.light),
        type: str(l.type, 80),
        radius: Math.max(0, Math.min(40, Number(l.radius) || 0)),
        arrangement: str(l.arrangement, 160),
      },
      role: o.role === "contrast" ? "contrast" : "recommended",
      device,
    };
  }
  return null;
}

/**
 * A short stable key for a request, for the mockup cache. FNV-1a. The page's
 * markup is left out: a live page's markup changes on every load (nonces,
 * build ids), and the same change to the same page is the same mockup.
 */
export function codedKey(req: CodedRequest): string {
  const text = JSON.stringify(req, (k, v) => (k === "markup" ? undefined : v));
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return `mkc_${(h >>> 0).toString(36)}_${text.length}`;
}
