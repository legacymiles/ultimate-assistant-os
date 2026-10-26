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
  "youtube-videos",
  "find-my-life",
  "seedance-studio",
  "jarvis-audio-studio",
  "image-studio",
  "viral-studio-content",
  "gods-eye-view",
  "game-studio",
  "ai-rankings",
  "cook-connect",
  "trading-studio",
  "financial-bible",
  "baby-no-scroll",
  "dump-finder",
  "client-review",
  "personas-studio",
  "money-agent-studio",
  "contradicting",
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

/**
 * Apps that now live inside another app — "one home per kind of thing".
 *
 * Each still has its catalog entry (the detail page, the Projects Timeline
 * history and old links all read it) and its old route redirects into its new
 * home with the right section open. What it loses is a tile of its own: a
 * merged slug leaves the hub grid AND the App plugins page, because the home
 * it moved into is already listed in one of them. The value is the slug of
 * that home — which may itself be merged (EMBER Reveal and the Kart Teardown
 * are the Showcase inside Website Redesigner, which is inside App Builder).
 */
export const MERGED_INTO: Record<string, string> = {
  "ea-world": "trading-studio",
  "ea-lab": "trading-studio",
  "ea-feature-list": "trading-studio",
  "multi-order-calculator": "trading-studio",
  "game-creator": "game-studio",
  "slippery-escape": "game-studio",
  "item-storm-arena": "game-studio",
  "website-redesigner": "app-builder",
  "fire-reveal": "website-redesigner",
  "kart-showcase": "website-redesigner",
};

/** Whether this app now lives inside another app, and so has no tile of its own. */
export function isMerged(slug: string): boolean {
  return Object.prototype.hasOwnProperty.call(MERGED_INTO, slug);
}

/** The top-level home a merged app lives in today (follows a chain), or null. */
export function homeOf(slug: string): string | null {
  let at = slug;
  for (let i = 0; i < 8 && isMerged(at); i++) at = MERGED_INTO[at];
  return at === slug ? null : at;
}

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
  "money-agent-studio":
    "Agents that make videos that make money: clip the best moments out of long videos, run faceless channels, and work paid "
    + "clipping campaigns. Your PC makes them, you approve every one, Personas Studio posts them, and the money shows in Financial Bible.",
  contradicting:
    "Receipts for “I never said that.” A clip-on Omi recorder streams the conversation in; when someone denies a line, the "
    + "exact words and time come back on your phone, with the lead-up one tap away. Consent-first and fair to both people.",
  "app-builder":
    "Where every new app starts. Say the idea — or show a recording of an app or workflow — and its super agent takes it "
    + "apart, asks what it is for, and proposes the features that would make it the best in its category for you to accept, "
    + "deny or edit. Build it hands the brief to Claude Code with felix, prompt-enhancer, the design skill, software-factory "
    + "and claude-security (plus video-analyzer and rea for a recording). Jarvis chat and Camera Autopilot send new apps here. "
    + "Website Redesigner lives here too — a new look for a site that keeps what it does, and a Showcase of app ideas worth building again.",
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
  "viral-studio-content":
    "The clips a video workflow is pointed at, kept in one place: viral sounds, fights, dances and "
    + "motion, each on its own board. Paste a link and it lands where you are; hover and it plays — so "
    + "the reference is real footage you picked, not a name a model guessed at.",
  "gods-eye-view":
    "Real satellite, aircraft and camera feeds to shoot from, or to grab a location plate no stock library has.",
  "game-studio":
    "Every game in one place. Create is Game Creator — describe a game and Unreal on this PC builds it, "
    + "playtests it and packages it — and Unfinished games is the shelf of games that play but are not "
    + "done, each playable right in the list with a Finish it button that hands the rest to Claude Code.",
  "trading-studio":
    "Every trading-bot tool behind one switcher: EA World for what you learned and EA Lab for what you "
    + "measured (both on this PC for now), Replay to watch a bot trade a real past session tick by tick, "
    + "the outside Terminals, the Feature List of every spec, and the gold basket Calculator.",
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
    // rather than rendering a card that goes nowhere — and one that has moved
    // inside another app is reached through that app's card instead.
    if (!p || isMerged(slug)) return [];
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
  return PROJECTS.filter((p) => !inJarvis(p.slug) && !isMerged(p.slug));
}
