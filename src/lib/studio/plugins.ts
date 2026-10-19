// ---------------------------------------------------------------------------
// The apps that have moved out of the hub and into Jarvis.
//
// Neither kind is a copy. The app still has exactly one definition, in the hub
// catalog (src/lib/catalog.ts), and still runs at its own route; what moves is
// where the owner goes looking for it. So this file is only the allowlists, and
// they are also the rule that keeps the two places from showing the same app
// twice: a slug listed here leaves the hub grid (`hubProjects`) and appears in
// Jarvis instead. Moving another finished app across is adding a slug.
//
// There are two ways in, and the difference is whether you leave Jarvis to use
// the app. A PLUGIN is a door out: its card on the App plugins page opens the
// whole app in its own tab, because it is a place you go and work for a while.
// A TOOLBOX app opens inside Jarvis, in the rail's Toolbox folder next to
// Skills and Tools, because it is something you reach for mid-thought and then
// carry on — and leaving the assistant to use it is the friction that stops you
// reaching for it at all.
// ---------------------------------------------------------------------------

import { PROJECTS, type CatalogProject } from "@/lib/catalog";

/** The slugs allowed in, in the order they should appear. */
export const PLUGIN_SLUGS = [
  "app-builder",
  "seedance-studio",
  "jarvis-audio-studio",
  "image-studio",
  "tiktok-dances",
  "gods-eye-view",
  "game-creator",
  "website-redesigner",
  "ai-rankings",
  "cook-connect",
  "ea-lab",
  "ea-world",
  "financial-bible",
  "baby-no-scroll",
  "dump-finder",
  "client-review",
  "personas-studio",
] as const;

/**
 * The apps that open INSIDE Jarvis, as tabs in the Toolbox folder.
 *
 * The rail draws these, with its own label and icon, in src/components/jarvis/
 * Jarvis.tsx — a tab needs a component to mount, which an allowlist of slugs
 * cannot supply. What lives here is the half the hub needs to know: that these
 * two are no longer tiles on the front page.
 */
export const TOOLBOX_SLUGS = ["prompt-architect", "projects-timeline"] as const;

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
  "app-builder":
    "Where every new app starts. Say the idea — or show a recording of an app or workflow — and its super agent takes it "
    + "apart, asks what it is for, and proposes the features that would make it the best in its category for you to accept, "
    + "deny or edit. Build it hands the brief to Claude Code with felix, prompt-enhancer, the design skill, software-factory "
    + "and claude-security (plus video-analyzer and rea for a recording). Jarvis chat and Camera Autopilot send new apps here.",
  "seedance-studio":
    "Studio the other way round. Every workflow here starts from a prompt and the audio arrives last; "
    + "this one starts from the track — it measures the tempo, the bar lines, the sections and the "
    + "drops, transcribes the words, and cuts the film TO them, with the lip-sync ranges outranking "
    + "the prompt on any shot that sings.",
  "jarvis-audio-studio":
    "The soundtrack half of Studio, all three parts of it. Confirm the exact recording a workflow is "
    + "cut to and pull a file of it with its licence recorded, so a finished piece never ships on "
    + "audio nobody can account for; read back what a track actually is — tempo, key, energy — when a "
    + "workflow needs to be cut to it; or write and render the song itself when nothing that exists "
    + "fits the film.",
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
  "ea-lab":
    "The one plugin that renders nothing and refuses things. Drop a trading bot into a watched folder "
    + "and it is backtested on this PC, filed by how it fails, and rated on results it has not seen "
    + "before — with peak unhedged exposure, the number that decides whether an account survives and "
    + "the one no MetaTrader report prints.",
  "ea-world":
    "The plugin that holds everything LEARNED rather than everything made. Trading bots, their source "
    + "as readable text, the mechanics worth stealing with the MQL4 that actually survives a live "
    + "server, and the families filed by how they die — then a bench that assembles any of it into one "
    + "build prompt and names the contradictions first, because a drawdown ceiling and a loss-doubling "
    + "sizer both get implemented and only one gets obeyed. EA Lab measures a bot; this is where it is "
    + "understood.",
  "financial-bible":
    "The plugin that turns an idea into Saturday morning. Everything else here makes something to "
    + "look at; this one costs it, sources it, puts it in order, and then argues with you about it — "
    + "cheaper, different material, is this even allowed here — handing back the edit as a diff with a "
    + "lower total rather than another wall of text. It refuses to talk about LLCs and marketing until "
    + "asked, which is why the plan gets read.",
  "baby-no-scroll":
    "The only plugin here that is used by handing the device away. Every other one of these is a place "
    + "to do work; this is the twenty minutes you get to do it in. One video or one game fills the "
    + "screen, everything else is taken away, and the way out is a padlock that has to be dragged the "
    + "whole width of the screen — a gesture question rather than a password one, because a password "
    + "typed one-handed in a dark room is the thing nobody does twice.",
  "client-review":
    "Where client work comes back in. Send a client their site on a private link; they sign in, type "
    + "their edits over the live page and press Send to Jarvis, and the batch waits here for you to "
    + "approve, reword or reject before it becomes the next version — and they get a notification when "
    + "it is ready.",
  "dump-finder":
    "The one plugin that is used from a truck cab. Everything else here makes or keeps something; this "
    + "answers where a load of millings, concrete, trash or scrap can go within so many miles, nearest "
    + "first, with Directions one tap away, and keeps the price a ton and the gate hours you learned "
    + "on each site so the next load does not start with a phone call.",
  "personas-studio":
    "Where the content goes out. Every workflow here makes a video; this is where each one meets the "
    + "persona and the account it belongs to — planned on a calendar at the hour that persona's own "
    + "numbers say works, posted for you when the time comes, and then watched view by view so the "
    + "next morning's ideas start from what actually landed.",
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

/** Whether this app is offered as a card on Jarvis's App plugins page. */
export function isPlugin(slug: string): boolean {
  return (PLUGIN_SLUGS as readonly string[]).includes(slug);
}

/** Whether this app opens inside Jarvis, as a tab in the Toolbox folder. */
export function isToolboxApp(slug: string): boolean {
  return (TOOLBOX_SLUGS as readonly string[]).includes(slug);
}

/** Whether this app has moved to Jarvis, either way, and has left the hub. */
export function inJarvis(slug: string): boolean {
  return isPlugin(slug) || isToolboxApp(slug);
}

/**
 * What the hub itself shows. The catalog keeps every app — the detail pages,
 * the routes and the plugin cards all read from it — but an app that has moved
 * into Jarvis stops being a tile here, so the hub is the things that have not
 * moved rather than a second copy of the list.
 */
export function hubProjects(): CatalogProject[] {
  return PROJECTS.filter((p) => !inJarvis(p.slug));
}
