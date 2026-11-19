// ---------------------------------------------------------------------------
// Look mode: a design direction and an app spec, as plain words for the
// model that writes the coded mockup (coded.ts). The skin decides colours,
// type voice and corners; the chrome decides the arrangement — the same two
// axes the layout drawing (render.ts) uses, so the written mockup and the
// instant drawing beside it never disagree about what a direction is.
// ---------------------------------------------------------------------------

import { isLight, skinFor, type FontKey } from "@/lib/redesigner/skins";
import type { CodedLook, CodedSpec } from "./coded";
import type { Chrome, MockupDirection, MockupSpec } from "./types";

const TYPE_VOICE: Record<FontKey, string> = {
  black: "heavy condensed black sans-serif",
  grotesk: "geometric grotesk",
  mono: "monospace, technical",
  serif: "elegant high-contrast serif",
  sans: "clean neutral sans-serif",
  syne: "wide expressive display face",
};

const ARRANGEMENT: Record<Chrome, { site: string; app: string }> = {
  console: { site: "split hero, text left and a product visual right", app: "left sidebar navigation, top bar, main panel and a detail panel" },
  workbench: { site: "dense split hero under a toolbar-style header", app: "compact left rail, toolbar, dense data panels" },
  sheet: { site: "printed-newspaper masthead, huge headline, ruled columns", app: "newspaper-style sheet with a heavy masthead rule and columns" },
  editorial: { site: "one narrow centred editorial column with generous whitespace", app: "centred editorial reading column" },
  atelier: { site: "centred agency-style hero under a floating pill navigation", app: "centred stage under a floating pill navigation, soft shadows" },
  reel: { site: "cinematic letterboxed hero with black bars", app: "cinematic letterboxed layout, results as a filmstrip" },
  lab: { site: "oversized headline, frosted glass cards over a glowing gradient", app: "frosted glass panels over a glowing gradient" },
};

export function codedLook(direction: MockupDirection, site: boolean): CodedLook {
  const skin = skinFor(direction.skill);
  return {
    skill: direction.skill,
    note: direction.note || skin.note,
    surface: skin.void,
    ink: skin.ink,
    accent: skin.sig,
    light: isLight(skin),
    type: TYPE_VOICE[skin.display] ?? "clean sans-serif",
    radius: skin.radius,
    arrangement: ARRANGEMENT[direction.chrome]?.[site ? "site" : "app"] ?? "",
  };
}

export function codedSpec(spec: MockupSpec): CodedSpec {
  return {
    name: spec.name,
    oneLiner: spec.oneLiner,
    audience: spec.audience,
    nav: spec.nav,
    ...(spec.site
      ? {
          site: {
            headline: spec.site.headline,
            sub: spec.site.sub,
            ctas: spec.site.ctas,
            sections: spec.site.sections.map((s) => ({ title: s.title, body: s.body })),
            proof: spec.site.proof,
            footer: spec.site.footer,
          },
        }
      : {
          app: {
            entity: spec.entity,
            action: spec.action,
            columns: spec.columns,
            rows: spec.rows.map((r) => ({ title: r.title, meta: r.meta, tag: r.tag })),
            stats: spec.stats.map((s) => ({ label: s.label, value: s.value })),
          },
        }),
  };
}
