// ---------------------------------------------------------------------------
// App plugins — the finished apps, moved out of the hub and into Jarvis.
//
// A plugin is not a copy. The app still has exactly one definition, in the hub
// catalog (src/lib/catalog.ts), and still runs at its own route; what moves is
// where the owner goes looking for it. So this file is only the allowlist, and
// it is also the rule that keeps the two places from showing the same app
// twice: a slug listed here leaves the hub grid (`hubProjects`) and appears in
// Jarvis instead. Moving another finished app across is adding a slug.
// ---------------------------------------------------------------------------

import { PROJECTS, type CatalogProject } from "@/lib/catalog";

/** The slugs allowed in, in the order they should appear. */
export const PLUGIN_SLUGS = [
  "seedance-studio",
  "mp3-download",
  "image-studio",
  "tiktok-dances",
  "gods-eye-view",
  "game-creator",
  "website-redesigner",
  "ai-rankings",
  "cook-connect",
] as const;

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
  "seedance-studio":
    "Studio the other way round. Every workflow here starts from a prompt and the audio arrives last; "
    + "this one starts from the track — it measures the tempo, the bar lines, the sections and the "
    + "drops, transcribes the words, and cuts the film TO them, with the lip-sync ranges outranking "
    + "the prompt on any shot that sings.",
  "mp3-download":
    "The soundtrack half of Studio. Confirm the exact recording a workflow is cut to, then pull a "
    + "file of it with its licence recorded — so a finished piece never ships on audio nobody can "
    + "account for.",
  "image-studio":
    "Where a frame gets made before it moves. Its specialist agents keep a face across a whole set of "
    + "stills, so the first frame a video workflow is handed is already the person and the look you "
    + "meant, rather than something the video model guessed at.",
  "tiktok-dances":
    "The move itself, verified. Every tile is a real dance that actually plays, with the song and the "
    + "year attached — so a dance workflow is pointed at footage that exists instead of a name a model "
    + "invented.",
  "gods-eye-view":
    "Real satellite, aircraft and camera feeds to shoot from, or to grab a location plate no stock library has.",
  "game-creator":
    "The one plugin that renders nothing and builds something. Describe a game and Unreal on this PC "
    + "builds it, playtests it and packages it — and the screenshots it takes from the player's eye are "
    + "plates a workflow can shoot from.",
  "website-redesigner":
    "For the work that ends on a page. Point it at a site, keep what the site does, and take away three "
    + "redesign directions and a build prompt — so a finished film or image has somewhere worth living.",
  "ai-rankings":
    "The written case for which model to reach for. Cost, whether it runs on your own machine, and "
    + "whether it needs a key you hold — with your own notes as the reason a tool keeps its rank.",
  "cook-connect":
    "Recipes written well enough to hand straight to a food-photography or ASMR workflow, and a table to "
    + "play somebody at while a render runs.",
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

/** Whether this app has moved to Jarvis and should no longer sit in the hub. */
export function isPlugin(slug: string): boolean {
  return (PLUGIN_SLUGS as readonly string[]).includes(slug);
}

/**
 * What the hub itself shows. The catalog keeps every app — the detail pages,
 * the routes and the plugin cards all read from it — but an app that has moved
 * into Jarvis stops being a tile here, so the hub is the things that have not
 * moved rather than a second copy of the list.
 */
export function hubProjects(): CatalogProject[] {
  return PROJECTS.filter((p) => !isPlugin(p.slug));
}
