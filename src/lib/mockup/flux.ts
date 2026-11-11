// ---------------------------------------------------------------------------
// Mockups — the Flux 2 picture of a lane.
//
// The coded drawing (render.ts) is exact about layout and words but is still
// a wireframe in a skin. When the owner's PC is running the picture drawer
// (WanGP + Flux 2 Klein, tools/wangp-image), each lane is also painted as a
// finished design, so the owner judges something close to what will actually
// be built.
//
// The rule that makes it useful: the picture is described from the SAME spec
// and the SAME skin the drawing uses — the same name, nav, headline, buttons,
// sections, colours and type voice. A picture of "a nice website" would be
// decoration; this is a picture of THIS page in THIS direction.
//
// Pure: it decides the words and the size, never fetches. One paragraph, no
// newlines — WanGP refused every multi-paragraph prompt (see images/server/draw.ts).
// ---------------------------------------------------------------------------

import { isLight, skinFor, type FontKey } from "@/lib/redesigner/skins";
import type { Chrome, Device, MockupDirection, MockupSpec } from "./types";

/** The drawer's hard cap is 2000 characters; stay well inside it. */
export const FLUX_PROMPT_MAX = 1400;

/** Picture size per device. Multiples of 16, close to the drawing's aspect. */
export const FLUX_SIZE: Record<Device, { width: number; height: number }> = {
  desktop: { width: 1024, height: 656 },
  phone: { width: 512, height: 1024 },
};

const TYPE_VOICE: Record<FontKey, string> = {
  black: "heavy condensed black sans-serif headlines",
  grotesk: "geometric grotesk headlines",
  mono: "monospace technical headlines",
  serif: "elegant high-contrast serif headlines",
  sans: "clean neutral sans-serif headlines",
  syne: "wide expressive display headlines",
};

const ARRANGEMENT: Record<Chrome, { site: string; app: string }> = {
  console: { site: "split hero with text left and a product visual right", app: "left sidebar navigation, top bar, main content panel and a detail panel" },
  workbench: { site: "dense split hero with a toolbar-style header", app: "compact left rail, toolbar, dense data panels" },
  sheet: { site: "printed-newspaper masthead with a huge headline and ruled columns", app: "newspaper-style sheet with a heavy masthead rule and columns" },
  editorial: { site: "narrow centred editorial column with generous whitespace", app: "centred editorial reading column" },
  atelier: { site: "centred agency-style hero under a floating pill navigation", app: "centred stage under a floating pill navigation with soft shadows" },
  reel: { site: "cinematic letterboxed hero with black bars", app: "cinematic letterboxed layout" },
  lab: { site: "oversized headline with frosted glass cards over a glowing gradient", app: "frosted glass panels over a glowing gradient" },
};

function q(text: string, max = 48): string {
  const t = String(text || "").replace(/\s+/g, " ").replace(/["\n\r]/g, "").trim();
  return t.length > max ? `${t.slice(0, max - 1).trim()}…` : t;
}

/**
 * The picture's prompt for one lane.
 *
 * Ordered most-important first, because Flux weighs the start of a prompt
 * hardest: what it is, the layout, the words on it, then the look.
 */
export function fluxPrompt(
  spec: MockupSpec,
  direction: MockupDirection,
  device: Device = "desktop",
  opts: { layoutRef?: boolean } = {},
): string {
  const skin = skinFor(direction.skill);
  const site = spec.site;
  const what = site
    ? device === "phone"
      ? "mobile website homepage"
      : "website homepage, full above-the-fold view"
    : device === "phone"
      ? "mobile app screen"
      : "web app dashboard screen";
  const layout = ARRANGEMENT[direction.chrome]?.[site ? "site" : "app"] ?? "";
  const nav = spec.nav.slice(0, 5).map((n) => q(n, 16)).join(", ");

  const words = site
    ? [
        `brand name "${q(spec.name, 28)}" top left`,
        nav ? `navigation links ${nav}` : "",
        `big headline "${q(site.headline, 60)}"`,
        site.ctas[0] ? `primary button "${q(site.ctas[0], 22)}"` : "",
        site.sections.length ? `then sections titled ${site.sections.slice(0, 3).map((s) => `"${q(s.title, 28)}"`).join(", ")}` : "",
      ]
    : [
        `app name "${q(spec.name, 28)}"`,
        nav ? `navigation ${nav}` : "",
        `page title "${q(spec.name, 28)}"`,
        spec.rows.length ? `showing ${spec.entity.toLowerCase()} like ${spec.rows.slice(0, 3).map((r) => `"${q(r.title, 26)}"`).join(", ")}` : "",
        `primary button "${q(spec.action, 22)}"`,
      ];

  const look = [
    `${isLight(skin) ? "light" : "dark"} theme`,
    `background ${skin.void}, text ${skin.ink}, accent colour ${skin.sig}`,
    TYPE_VOICE[skin.display],
    skin.radius === 0 ? "sharp square corners" : skin.radius >= 16 ? "soft rounded corners" : "subtly rounded corners",
    skin.border >= 2 ? "bold ruled lines" : "hairline borders",
    q(skin.note, 120),
  ];

  // With the coded drawing as image 1, Flux keeps its structure and every
  // word, and only does what a picture model is good at: finish. Measured on
  // the owner's 3050 with edits: painting from a real picture kept every word
  // of the page legible, where a text-only prompt invents its own page.
  const lead = opts.layoutRef
    ? "Repaint image 1, a coded layout of this page, as a finished high-fidelity design: keep its layout, sections and every word of text exactly, and make it look polished and real. "
    : "";
  const text =
    lead +
    `High-fidelity UI design of a ${what} for ${q(spec.name, 28)}, ${q(spec.oneLiner, 110)}. ` +
    `Layout: ${layout}. ` +
    `On screen: ${words.filter(Boolean).join("; ")}. ` +
    `Style: ${look.join(", ")}. ` +
    "Flat straight-on screenshot, crisp legible text, pixel-perfect spacing, professional award-winning web design, no device frame, no hands, no people, no watermark.";

  return text.replace(/\s+/g, " ").slice(0, FLUX_PROMPT_MAX);
}

/**
 * What a reference contributes to a cache key. A data URL is summarised by
 * its length and ends rather than hashed whole — a screenshot is ~200 KB and
 * this runs on every render — which is enough to tell two pictures apart.
 */
export function refKey(refs: { image?: string; url?: string; html?: string }[] | undefined): string {
  if (!refs?.length) return "";
  return refs
    .map((r) =>
      r.url ? `u:${r.url}` : r.html ? `h:${r.html.length}:${r.html.slice(-200)}` : r.image ? `i:${r.image.length}:${r.image.slice(40, 120)}:${r.image.slice(-80)}` : "",
    )
    .join("|");
}

/** A short stable key for a prompt, for the picture cache. FNV-1a. */
export function pictureKey(prompt: string, device: Device, refs = ""): string {
  let h = 0x811c9dc5;
  const text = `${device}|${prompt}${refs ? `|${refs}` : ""}`;
  for (let i = 0; i < text.length; i += 1) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return `mk_${(h >>> 0).toString(36)}_${text.length}`;
}
