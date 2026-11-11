// ---------------------------------------------------------------------------
// Mockups — the shapes.
//
// A mockup is what the app will LOOK like, drawn before a line of it is built.
// It is not a picture: it is a real, self-contained HTML document rendered in
// an iframe, so it scrolls, hovers and reads at a phone width exactly like the
// finished thing would. That is the whole reason this exists rather than an
// image model — a picture of an interface tells you about the colours, and a
// rendered interface tells you whether you want to use it.
//
// Nothing here calls out. A spec plus a skin is enough to draw an app, so a
// mockup costs nothing, needs no key, and appears the moment the feature list
// does (checklist R4).
//
// Two axes make the three directions genuinely different rather than three
// palettes of the same page:
//
//   SHAPE comes from the app      — what the main surface is FULL of. A
//                                   marketplace is a grid, a tracker is a
//                                   board, a log is a table. Same in every
//                                   direction, because it is the app's truth.
//   CHROME comes from the skin    — how the app is FRAMED. A sidebar console,
//                                   a printed sheet, an editorial measure, an
//                                   agency stage. Different per direction,
//                                   because that is what a design skill
//                                   actually decides.
// ---------------------------------------------------------------------------

/** Which width the mockup is drawn for. Phones are not narrow desktops. */
export type Device = "desktop" | "phone";

/** What the main surface is full of — the app's own truth, not the skin's. */
export type Shape = "board" | "grid" | "list" | "feed" | "table" | "canvas";

/** How the app is framed. Derived from the skin's layout. */
export type Chrome = "console" | "sheet" | "editorial" | "atelier" | "workbench" | "reel" | "lab";

/** One row, card or tile on the main surface. */
export interface MockupRow {
  title: string;
  meta: string;
  /** A short status word, when the shape wants one. */
  tag?: string;
  /** 0..1 — drives a bar, a meter or a progress rail. */
  level?: number;
}

/** One number worth putting at the top. */
export interface MockupStat {
  label: string;
  value: string;
  /** "+12%" — shown only when the direction has room for it. */
  delta?: string;
}

/**
 * Everything needed to draw the app, in the app's own words.
 *
 * Every string here comes from the spec the owner already approved — the
 * understanding, the accepted features, the audience. None of it is invented
 * filler, because a mockup full of "Item 1 / Item 2" is the exact thing that
 * makes a finished app read as a demo.
 */
export interface MockupSpec {
  name: string;
  oneLiner: string;
  audience: string;
  shape: Shape;
  /** Where you can go. The app's real sections. */
  nav: string[];
  /** What the app is full of, plural and capitalised: "Orders", "Recipes". */
  entity: string;
  stats: MockupStat[];
  rows: MockupRow[];
  /** Column headings when the shape is a board or a table. */
  columns: string[];
  /** The one primary action. */
  action: string;
  /** Toolbar actions beside it. */
  tools: string[];
  /** The detail panel's fields. */
  detail: { label: string; value: string }[];
  /** The signed-in person's initials, for the avatar. */
  who: string;
  /**
   * Set when the thing being drawn is a WEBSITE, not an app. A website is a
   * page people scroll — nav, hero, sections, a call to action — and drawing it
   * as an app console (rail, stat tiles, rows of features) is what made every
   * site mockup look like a dashboard. When this is present the renderer draws
   * a page instead, and the app fields above are ignored.
   */
  site?: MockupSite;
}

/** A website, in its own words: what the page says, top to bottom. */
export interface MockupSite {
  /** The hero's headline. */
  headline: string;
  /** The line under it. */
  sub: string;
  /** The page's real calls to action, primary first. */
  ctas: string[];
  /** The sections down the page, in order. */
  sections: { title: string; body: string; tag?: string }[];
  /** One line of proof (a review, a stat, a guarantee), when there is one. */
  proof?: string;
  /** Where it is, for the footer: a domain or a short address. */
  footer?: string;
  /** Colours the existing site uses, when this is a redesign. Never drawn as the new look. */
  oldColors?: string[];
}

/** A Flux 2 picture of one lane, drawn on the owner's PC. */
export interface MockupPicture {
  /** data: URL of the picture. */
  image: string;
  /** The prompt that drew it — the cache key, and what the owner can read. */
  prompt: string;
  ms: number;
}

/** One lane of the bake-off: a design skill, drawn. */
export interface MockupDirection {
  /** The design skill. Its identity in the UI, and what lands in the brief. */
  skill: string;
  /** The skin's own one-liner — concrete, never adjectives alone. */
  note: string;
  /** What this lane is doing in the comparison. */
  role: "recommended" | "contrast";
  /** The chrome this direction frames the app in. */
  chrome: Chrome;
}

/**
 * The direction that won.
 *
 * Kept on the project (App Builder) or the version (Client Review) rather than
 * in component state, because the whole point is that it survives the tab
 * closing and reaches the build brief. `by` matters: a client approving a look
 * is not the same event as the owner picking one, and the owner's dashboard
 * needs to tell them apart.
 */
export interface LookChoice {
  skill: string;
  at: string;
  by: "owner" | "client";
  /**
   * Set when the bake-off was for an EDIT to a live page: which of the three
   * readings of the change was picked, and the tweaks made to it. The skill
   * above stays the site's own look, so nothing that reads `skill` changes.
   */
  edit?: EditPick;
}

/**
 * A picture Flux starts FROM. The first one is the scene being changed.
 *
 * `url` and `html` are photographed by the drawer on the owner's PC at the
 * size being drawn, so the reference and the result line up; `image` is a
 * data URL already in hand (a screenshot the app took, or a lane's own
 * picture when it is being tweaked).
 */
export interface MockupRef {
  image?: string;
  url?: string;
  html?: string;
  /** Lets coded mockup HTML load the hub's own fonts. */
  base?: string;
  width?: number;
  height?: number;
}

export type { EditLaneId, EditPick, SiteFacts } from "./edit";
import type { EditPick } from "./edit";
