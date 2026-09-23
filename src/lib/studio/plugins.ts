// ---------------------------------------------------------------------------
// App plugins — hub apps the owner has allowed into Studio.
//
// These are not Studio workflows and they are not copies: each one is a whole
// app that already lives in the hub (src/lib/catalog.ts) and stays there. This
// file is only the allowlist, so a plugin's name, blurb and URL have exactly
// one home and cannot drift. Allowing another one is adding a slug.
// ---------------------------------------------------------------------------

import { PROJECTS, type CatalogProject } from "@/lib/catalog";

/** The slugs allowed in, in the order they should appear. */
export const PLUGIN_SLUGS = ["mp3-download", "gods-eye-view", "cook-connect", "cookbook-genie"] as const;

export interface StudioPlugin {
  slug: string;
  title: string;
  tag: string;
  /** The first sentence of the catalog overview — the full one is an essay. */
  blurb: string;
  href: string;
  hue: number;
  status: CatalogProject["status"];
  /** Why it earns a place next to the workflows. */
  why: string;
}

/** One line, and only the first: the catalog overviews run to paragraphs. */
function firstSentence(text: string): string {
  const cut = text.match(/^.*?[.!?](?=\s|$)/);
  return (cut ? cut[0] : text).trim();
}

const WHY: Record<string, string> = {
  "mp3-download":
    "The soundtrack half of Studio. Confirm the exact recording a workflow is cut to, then pull a "
    + "file of it with its licence recorded — so a finished piece never ships on audio nobody can "
    + "account for.",
  "gods-eye-view":
    "Real satellite, aircraft and camera feeds to shoot from, or to grab a location plate no stock library has.",
  "cook-connect":
    "Recipes written well enough to hand straight to a food-photography or ASMR workflow, and a table to "
    + "play somebody at while a render runs.",
  "cookbook-genie":
    "Recipes with the dish described well enough to hand straight to a food-photography or ASMR workflow.",
};

export function studioPlugins(): StudioPlugin[] {
  return PLUGIN_SLUGS.flatMap((slug) => {
    const p = PROJECTS.find((x) => x.slug === slug);
    // An allowlisted slug that has left the catalog simply stops appearing,
    // rather than rendering a card that goes nowhere.
    if (!p) return [];
    return [
      {
        slug: p.slug,
        title: p.title,
        tag: p.tag ?? "",
        blurb: firstSentence(p.overview),
        href: p.appUrl ?? `/apps/${p.slug}`,
        hue: Array.isArray(p.hue) ? p.hue[0] : 220,
        status: p.status,
        why: WHY[slug] ?? "",
      },
    ];
  });
}
