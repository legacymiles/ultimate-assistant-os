// ---------------------------------------------------------------------------
// The studio wall — the Studio tab's front page.
//
// Studio used to open straight onto the workflow wall, so the studios the
// owner had built sat behind the App plugins page and you had to remember
// which door. This is the other front page: one tall panel per studio, each
// playing a clip of what that studio makes.
//
// It owns NO facts about the studios. The name, the line under it and the hue
// come from the catalog; what is inside a studio comes from that studio's own
// `HomeSection[]` where it has one, and from `MERGED_INTO` where it is instead
// composed of apps that moved in. So adding a section to Trading Studio, or
// merging another app into Game Studio, changes this wall without anyone
// editing it — which is the only way a second list of the same thing stays
// true for more than a week.
//
// Clicking a panel LEAVES Jarvis for that studio's own route, except for the
// workflow wall, which has no route of its own and opens in the tab. That is
// not a compromise: these studios are full apps with their own shells and
// their own `?section=` routing, and re-hosting them inside Jarvis would mean
// maintaining a second mount for every one of them.
// ---------------------------------------------------------------------------

import { PROJECTS } from "@/lib/catalog";
import { MERGED_INTO } from "@/lib/studio/plugins";
import { GAME_SECTIONS } from "./games";
import type { HomeIcon, HomeSection } from "./sections";
import { TRADING_SECTIONS } from "./trading";

/** One thing inside a studio, as a spine along the panel's bottom edge. */
export interface Inside {
  label: string;
  icon: HomeIcon;
}

export interface WallCard {
  /** Also the clip's filename in public/studio/. */
  id: string;
  name: string;
  tagline: string;
  hue: number;
  /** Where clicking goes, or null for the workflow wall, which opens in-tab. */
  href: string | null;
  inside: Inside[];
  clip: { video: string; poster: string };
}

/**
 * The studios that get a panel, in the order they are drawn, and where each
 * one's contents come from.
 *
 * A hand-written order rather than every plugin slug: the App plugins page
 * lists all twenty-one, and a wall of twenty-one tall panels is a list with
 * pictures. These are the ones that MAKE something, which is what the Studio
 * tab is for.
 */
const WALL: {
  slug: string;
  /** A studio with its own sections list hands it over directly. */
  sections?: readonly HomeSection[];
  /** Otherwise: spines written here, for a studio whose parts are not modelled. */
  inside?: Inside[];
}[] = [
  { slug: "image-studio", inside: [{ label: "Agents", icon: "Sparkles" }, { label: "Gallery", icon: "Grid" }] },
  {
    slug: "jarvis-audio-studio",
    inside: [
      { label: "Find", icon: "Search" },
      { label: "Classify", icon: "Waveform" },
      { label: "Create", icon: "Mic" },
    ],
  },
  { slug: "seedance-studio", inside: [{ label: "Engine", icon: "Waveform" }] },
  { slug: "personas-studio", inside: [{ label: "Personas", icon: "Users" }, { label: "Calendar", icon: "Calendar" }, { label: "Analytics", icon: "Target" }] },
  { slug: "money-agent-studio", inside: [{ label: "Clip", icon: "Scissors" }, { label: "Channels", icon: "Film" }, { label: "Campaigns", icon: "Cash" }] },
  { slug: "game-studio", sections: GAME_SECTIONS },
  { slug: "trading-studio", sections: TRADING_SECTIONS },
];

/** The panel for the workflow wall itself, which is not an app with a route. */
const WORKFLOWS: WallCard = {
  id: "video",
  name: "Video Studio",
  tagline: "The video agent",
  hue: 258,
  href: null,
  inside: [
    { label: "Workflows", icon: "Film" },
    { label: "Gallery", icon: "Image" },
  ],
  clip: { video: "/studio/video.mp4", poster: "/studio/video.webp" },
};

/** Whatever moved into this studio, as spines, from the catalog's own titles. */
function mergedInto(slug: string): Inside[] {
  return Object.entries(MERGED_INTO)
    .filter(([, home]) => home === slug)
    .flatMap(([merged]) => {
      const p = PROJECTS.find((x) => x.slug === merged);
      return p ? [{ label: p.title, icon: "Layers" as HomeIcon }] : [];
    });
}

/**
 * The wall.
 *
 * A studio whose catalog entry has gone simply stops having a panel, rather
 * than drawing one that leads nowhere — the same rule `studioPlugins` follows,
 * and for the same reason: these lists outlive the apps in them.
 */
export function wallCards(): WallCard[] {
  const cards = WALL.flatMap<WallCard>((entry) => {
    const p = PROJECTS.find((x) => x.slug === entry.slug);
    if (!p) return [];
    const inside = entry.sections
      ? entry.sections.map((s) => ({ label: s.label, icon: s.icon }))
      : [...(entry.inside ?? []), ...mergedInto(entry.slug)];
    return [
      {
        id: entry.slug,
        name: p.title,
        tagline: p.tag ?? "",
        hue: Array.isArray(p.hue) ? p.hue[0] : 220,
        href: p.appUrl ?? `/apps/${p.slug}`,
        inside,
        clip: { video: `/studio/${clipFor(entry.slug)}.mp4`, poster: `/studio/${clipFor(entry.slug)}.webp` },
      },
    ];
  });
  return [WORKFLOWS, ...cards];
}

/**
 * The clip filename for a slug.
 *
 * Mostly the slug, with three exceptions where the clip was shot for the thing
 * rather than for the slug: `jarvis-audio-studio` is a microphone, so the file
 * is `audio`; `seedance-studio` is a record unspooling into film, so it is
 * `music-video`; `trading-studio` is a balance scale, so it is `trading`.
 */
function clipFor(slug: string): string {
  const named: Record<string, string> = {
    "jarvis-audio-studio": "audio",
    "seedance-studio": "music-video",
    "image-studio": "image",
    "game-studio": "game",
    "personas-studio": "personas",
    "money-agent-studio": "money-agent",
    "trading-studio": "trading",
  };
  return named[slug] ?? slug;
}
