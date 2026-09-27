// ---------------------------------------------------------------------------
// Website Redesigner — skins.
//
// Picking a design skill in the dropdown re-skins THIS page in that skill's
// aesthetic. The point is judgement: reading "warm monochrome, typographic
// contrast" tells you nothing, but watching the whole console turn into warm
// paper with a serif headline tells you in half a second whether that skill
// designs the kind of site you want.
//
// A skin is therefore not a palette swap. It moves the axes a real design
// system moves — surface, ink, accent, the three type voices, corner radius,
// rule weight, label casing, shadow, backdrop blur, the hairline grid, the
// shader field's polarity and energy, hero alignment, grid stagger, density —
// because those are what separate "brutalist" from "expensive agency", not hue.
//
// Every value lands as a CSS custom property on the .rdx root (see skinVars),
// so the entire stylesheet follows without a single component knowing which
// skin is on.
// ---------------------------------------------------------------------------

import type { CSSProperties } from "react";
import { DEFAULT_SKILLS } from "./engine";

/** The faces loaded on this route (see app/apps/website-redesigner/page.tsx). */
export type FontKey = "black" | "grotesk" | "mono" | "serif" | "sans" | "syne";

/**
 * How the WebGL field behaves under this skin.
 * - `glow` — additive filaments on a dark surface (the house look).
 * - `ink`  — subtractive: the same noise bites INTO a light surface, so a
 *            paper skin still gets a living background instead of a dead one.
 * - `off`  — no canvas at all. Calm skins earn their calm.
 */
export type FieldMode = "glow" | "ink" | "off";

/**
 * The page's composition — not a theme, an arrangement. Each one puts the same
 * content in a different structure, because that is what separates a design
 * skill's work from its palette.
 *
 * - `console`   the house: rail, oversized hero, a bordered instrument panel.
 * - `sheet`     a printed spec sheet: masthead, ticker, label/value rows.
 * - `editorial` one narrow measure, serif headline, the form written as prose.
 * - `atelier`   agency: centred stage, floating capsule, soft offset cards.
 * - `workbench` an app shell: sidebar of steps, toolbar, dense result table.
 * - `reel`      letterboxed title card, slate panel, results as a filmstrip.
 * - `lab`       full-bleed field, giant type, glass panels off-axis, collage.
 */
export type LayoutId =
  | "console"
  | "sheet"
  | "editorial"
  | "atelier"
  | "workbench"
  | "reel"
  | "lab";

/** How the page arrives when the layout changes. One authored moment each. */
export type MotionId = "rise" | "cut" | "blur" | "lift" | "snap" | "wipe" | "mask";

/** What is behind everything. The shader is only one of the answers. */
export type BackdropId = "field" | "paper" | "dots" | "bloom" | "bars" | "flat";

export interface Skin {
  /** Design-skill name, or "house" for the page's own direction. */
  id: string;
  /** Which family this skin was cut from — shown in the skin bar. */
  family: string;
  /** One line the owner reads while judging. Concrete, never adjectives alone. */
  note: string;

  void: string;
  ink: string;
  sig: string;

  display: FontKey;
  body: FontKey;
  mono: FontKey;

  /** Corner radius in px. 0 is a decision, not a default. */
  radius: number;
  /** Rule weight in px. 2+ reads as print, 1 as interface. */
  border: number;
  /** Uppercase micro-labels, or sentence case. */
  caps: boolean;
  /** Label tracking in em. */
  track: number;
  titleCase: "uppercase" | "none";
  /** Headline tracking in em — negative tightens. */
  titleTrack: number;
  /** Headline line-height. */
  titleLead: number;
  /** Full box-shadow value for raised surfaces. */
  shadow: string;
  /** Backdrop blur in px on the console and cards. */
  blur: number;
  /** Hairline engineering grid, 0..1. */
  grid: number;

  field: FieldMode;
  /** Canvas opacity, 0..1. */
  fieldOpacity: number;
  /** Shader gain — how hard the filaments burn. */
  energy: number;
  /** Grain + scanlines, 0..1. */
  texture: number;

  layout: LayoutId;
  motion: MotionId;
  backdrop: BackdropId;
  hero: "left" | "center";
  /** Does the result grid refuse to sit level? */
  stagger: boolean;
  /** Padding multiplier. <1 dense, >1 generous. */
  density: number;
}

type Family = Omit<Skin, "id" | "note">;

// ----- families -------------------------------------------------------------
// Seven worlds. Each skill below inherits one and then bends it — usually the
// accent, sometimes the surface or the display face — so no two skills in a
// family look like the same page with a different colour.

const VOID: Family = {
  family: "void",
  layout: "console",
  motion: "rise",
  backdrop: "field",
  void: "#050505",
  ink: "#f5f5f5",
  sig: "#ff4d2e",
  display: "black",
  body: "grotesk",
  mono: "mono",
  radius: 0,
  border: 1,
  caps: true,
  track: 0.16,
  titleCase: "uppercase",
  titleTrack: -0.035,
  titleLead: 0.88,
  shadow: "0 30px 70px -20px rgba(0, 0, 0, 0.9)",
  blur: 18,
  grid: 0.5,
  field: "glow",
  fieldOpacity: 1,
  energy: 0.75,
  texture: 0.5,
  hero: "left",
  stagger: true,
  density: 1,
};

const TERMINAL: Family = {
  ...VOID,
  family: "terminal",
  layout: "sheet",
  motion: "cut",
  backdrop: "field",
  void: "#e7e4dc",
  ink: "#101010",
  sig: "#d0260f",
  body: "mono",
  radius: 0,
  border: 2,
  track: 0.2,
  titleTrack: -0.045,
  titleLead: 0.82,
  shadow: "none",
  blur: 0,
  grid: 0.95,
  field: "ink",
  fieldOpacity: 0.34,
  energy: 0.55,
  texture: 1,
  stagger: false,
  density: 0.82,
};

const PAPER: Family = {
  family: "paper",
  layout: "editorial",
  motion: "blur",
  backdrop: "paper",
  void: "#f6f3ec",
  ink: "#191713",
  sig: "#a4522f",
  display: "serif",
  body: "sans",
  mono: "mono",
  radius: 2,
  border: 1,
  caps: false,
  track: 0.02,
  titleCase: "none",
  titleTrack: -0.02,
  titleLead: 0.98,
  shadow: "0 18px 40px -28px rgba(25, 23, 19, 0.5)",
  blur: 0,
  grid: 0,
  field: "off",
  fieldOpacity: 0,
  energy: 0.2,
  texture: 0,
  hero: "left",
  stagger: false,
  density: 1.18,
};

const STUDIO: Family = {
  family: "studio",
  layout: "atelier",
  motion: "lift",
  backdrop: "bloom",
  void: "#faf7f2",
  ink: "#15141a",
  sig: "#2f5d50",
  display: "syne",
  body: "sans",
  mono: "mono",
  radius: 16,
  border: 1,
  caps: false,
  track: 0.04,
  titleCase: "none",
  titleTrack: -0.03,
  titleLead: 1,
  shadow: "0 26px 60px -34px rgba(21, 20, 26, 0.55)",
  blur: 0,
  grid: 0,
  field: "ink",
  fieldOpacity: 0.16,
  energy: 0.3,
  texture: 0,
  hero: "center",
  stagger: false,
  density: 1.24,
};

const PRODUCT: Family = {
  family: "product",
  layout: "workbench",
  motion: "snap",
  backdrop: "dots",
  void: "#0b0c10",
  ink: "#eef1f7",
  sig: "#5b9dff",
  display: "sans",
  body: "sans",
  mono: "mono",
  radius: 10,
  border: 1,
  caps: false,
  track: 0.03,
  titleCase: "none",
  titleTrack: -0.038,
  titleLead: 1,
  shadow: "0 22px 50px -30px rgba(0, 0, 0, 0.85)",
  blur: 14,
  grid: 0,
  field: "glow",
  fieldOpacity: 0.4,
  energy: 0.3,
  texture: 0.08,
  hero: "left",
  stagger: false,
  density: 1.02,
};

const CINEMA: Family = {
  family: "cinema",
  layout: "reel",
  motion: "wipe",
  backdrop: "bars",
  void: "#0a0806",
  ink: "#f1e9dc",
  sig: "#dfa04a",
  display: "serif",
  body: "grotesk",
  mono: "mono",
  radius: 3,
  border: 1,
  caps: true,
  track: 0.3,
  titleCase: "uppercase",
  titleTrack: 0.01,
  titleLead: 0.94,
  shadow: "0 40px 90px -40px rgba(0, 0, 0, 0.95)",
  blur: 10,
  grid: 0.14,
  field: "glow",
  fieldOpacity: 0.8,
  energy: 0.5,
  texture: 0.35,
  hero: "center",
  stagger: true,
  density: 1.12,
};

const NEON: Family = {
  family: "neon",
  layout: "lab",
  motion: "mask",
  backdrop: "field",
  void: "#04050f",
  ink: "#e9ecff",
  sig: "#4cf0d0",
  display: "syne",
  body: "grotesk",
  mono: "mono",
  radius: 14,
  border: 1,
  caps: true,
  track: 0.14,
  titleCase: "none",
  titleTrack: -0.04,
  titleLead: 0.92,
  shadow: "0 30px 80px -30px rgba(0, 0, 0, 0.9)",
  blur: 22,
  grid: 0.34,
  field: "glow",
  fieldOpacity: 1,
  energy: 1,
  texture: 0.28,
  hero: "left",
  stagger: true,
  density: 1.06,
};

// ----- the roster -----------------------------------------------------------
// One entry per design skill. `note` is the thing being judged, so it names
// what you will SEE, not what the skill claims about itself.

type Entry = Partial<Skin> & { base: Family; note: string };

const ENTRIES: Record<string, Entry> = {
  "interactive-web-studio": {
    base: NEON,
    note: "Deep-space console, mint signal, expressive display type. The field burns hardest here.",
  },
  "capcut-design": {
    base: PRODUCT,
    note: "Token-exact product UI: slate surface, 10px radius, sentence case, one blue.",
  },
  "webgl-trail-reveal": {
    base: NEON,
    sig: "#ff5cf0",
    void: "#07040d",
    note: "Two-state magenta: the whole page reads as a surface something is about to be revealed under.",
  },
  "exploded-showcase": {
    base: CINEMA,
    layout: "lab",
    motion: "mask",
    sig: "#ff7a35",
    void: "#0b0a09",
    display: "syne",
    note: "Hardware teardown: warm graphite, machined orange, parts laid out on a level grid.",
  },
  "scroll-craft": {
    base: CINEMA,
    sig: "#e2604a",
    display: "syne",
    titleCase: "none",
    track: 0.14,
    note: "Layered depth, one engineered peak. Loud display face, generous air, staggered results.",
  },
  "blender-to-web": {
    base: NEON,
    sig: "#ff9a2e",
    void: "#0a0710",
    radius: 20,
    note: "Sculptural: rounded volumes, amber key light against violet void, everything looks lit.",
  },
  "real-estate-reveal": {
    base: CINEMA,
    layout: "atelier",
    motion: "blur",
    backdrop: "bloom",
    sig: "#c9a468",
    void: "#0c0b09",
    note: "Luxury listing: brass on near-black, serif headline, wide tracking, centred.",
  },
  impeccable: {
    base: PRODUCT,
    sig: "#8b7cff",
    radius: 12,
    density: 1.08,
    note: "Quiet operator UI. Precise spacing steps, restrained violet, nothing shouting.",
  },
  "scroll-world": {
    base: NEON,
    sig: "#49a8ff",
    void: "#030814",
    note: "Fly-through blue: cold atmosphere, high field energy, motion implied everywhere.",
  },
  "cinematic-ui": {
    base: CINEMA,
    note: "Film art direction: letterbox calm, amber grade, tracked-out caps, serif headline.",
  },
  "h3-scroll-world": {
    base: NEON,
    sig: "#ff4d6d",
    void: "#0a0410",
    energy: 1,
    note: "Generated-footage red against deep violet — the loudest of the scroll-world family.",
  },
  "frontend-design": {
    base: VOID,
    sig: "#ffcc00",
    void: "#0a0a0a",
    note: "Anthropic's bold-direction default: one committed aesthetic, yellow signal, hard edges.",
  },
  "taste-skill": {
    base: PAPER,
    sig: "#1f5f4b",
    hero: "center",
    note: "Anti-slop editorial: warm paper, serif headline, one deep green, nothing templated.",
  },
  "taste-skill-v1": {
    base: PAPER,
    sig: "#3a5a8c",
    note: "The older taste rule set: same paper, cooler ink-blue accent, left-aligned.",
  },
  "soft-skill": {
    base: STUDIO,
    note: "Expensive agency: cream, 16px radii, soft depth, centred hero, air everywhere.",
  },
  "minimalist-skill": {
    base: PAPER,
    sig: "#6f6a60",
    void: "#f8f7f4",
    density: 1.26,
    note: "Warm monochrome. The accent is barely an accent — hierarchy comes from type alone.",
  },
  "brutalist-skill": {
    base: TERMINAL,
    note: "Swiss print meets terminal: 2px rules, zero radius, dense grid, ink-bitten background.",
  },
  "gpt-tasteskill": {
    base: NEON,
    layout: "sheet",
    motion: "snap",
    backdrop: "flat",
    sig: "#c8ff2f",
    void: "#0a0a0a",
    radius: 4,
    display: "black",
    titleCase: "uppercase",
    note: "GSAP marketing one-pager: acid lime on black, hard corners, gapless blocks.",
  },
  "redesign-skill": {
    base: PAPER,
    sig: "#2b6cb0",
    void: "#f4f4f2",
    radius: 6,
    note: "Upgrade-in-place: the familiar shape, lifted — cleaner rules, calmer blue, no theatre.",
  },
  "stitch-skill": {
    base: PAPER,
    layout: "workbench",
    motion: "snap",
    backdrop: "dots",
    sig: "#8a3d6b",
    radius: 0,
    border: 1,
    caps: true,
    track: 0.12,
    note: "Design-system first: strict rules, asymmetric columns, plum accent used sparingly.",
  },
  "imagegen-frontend-web": {
    base: STUDIO,
    sig: "#b2542f",
    void: "#f7f2ea",
    note: "Mockup-first gallery: one warm palette, big soft frames, image-shaped sections.",
  },
  "image-to-code-skill": {
    base: STUDIO,
    sig: "#3f4fb5",
    radius: 12,
    note: "Match-the-mockup build: measured radii, cool indigo, structure you can read off a JPEG.",
  },
  brandkit: {
    base: STUDIO,
    layout: "sheet",
    motion: "cut",
    backdrop: "flat",
    sig: "#111111",
    void: "#f2efe9",
    display: "black",
    titleCase: "uppercase",
    radius: 4,
    note: "Brand board: black logotype on stock, tight caps, swatches doing the talking.",
  },
  "ui-ux-pro-max": {
    base: PRODUCT,
    sig: "#22c08a",
    void: "#0d1117",
    radius: 8,
    note: "Dashboard intelligence: green status accent, tabular density, everything a control.",
  },
  "theme-factory": {
    base: PRODUCT,
    sig: "#ff8f3f",
    void: "#101014",
    radius: 14,
    note: "Curated theme, applied wholesale: warm orange, rounded surfaces, consistent everywhere.",
  },
  "web-artifacts-builder": {
    base: PRODUCT,
    backdrop: "flat",
    sig: "#e2e8f0",
    void: "#0f1115",
    radius: 8,
    note: "shadcn in one file: neutral chrome, component-shaped blocks, no brand of its own.",
  },
  "web-design-guidelines": {
    base: PRODUCT,
    backdrop: "flat",
    motion: "snap",
    sig: "#ffffff",
    void: "#000000",
    radius: 6,
    grid: 0.12,
    fieldOpacity: 0.22,
    note: "Ship-ready constraint: pure black and white, unmissable focus rings, no decoration.",
  },
  "clone-site": {
    base: TERMINAL,
    layout: "workbench",
    motion: "snap",
    sig: "#1b4dd8",
    void: "#eceae5",
    note: "Measure-first: blueprint blue on newsprint, everything annotated, nothing invented.",
  },
  "remix-site": {
    base: STUDIO,
    sig: "#d63aa0",
    void: "#f6f1f6",
    radius: 18,
    note: "Tokenised re-skin: the measured site, made yours — pink brand swapped over calm bones.",
  },
  "shader-extract": {
    base: NEON,
    sig: "#7cf24a",
    void: "#02060a",
    energy: 1,
    texture: 0.45,
    note: "One captured effect, rebuilt: phosphor green, heavy grain, the field is the subject.",
  },
  "blender-threejs-export": {
    base: NEON,
    sig: "#ff7043",
    void: "#0b0a0c",
    radius: 10,
    note: "Viewer chrome: orbit-control orange on studio grey, the object gets the room.",
  },
  hyperframes: {
    base: VOID,
    layout: "reel",
    motion: "wipe",
    backdrop: "bars",
    sig: "#a0ff1f",
    void: "#0a0a0a",
    radius: 2,
    display: "syne",
    note: "Motion pipeline: timeline lime on black, mono labels, frames not pages.",
  },
  "preview-icon": {
    base: VOID,
    layout: "workbench",
    motion: "snap",
    backdrop: "dots",
    sig: "#00e5ff",
    void: "#070709",
    radius: 6,
    density: 0.92,
    note: "Tile factory: cyan on near-black, compact, everything sized like a grid card.",
  },
};

/** The page's own direction, and what "Pick for me" wears. */
export const HOUSE: Skin = {
  ...VOID,
  id: "house",
  note: "The redesigner's own skin: molten ember on void, outlined display type, live shader field.",
};

export const SKINS: Record<string, Skin> = Object.fromEntries(
  Object.entries(ENTRIES).map(([id, { base, note, ...over }]) => [
    id,
    { ...base, ...over, id, note },
  ]),
);

/** Roster order, so the skin bar's ← → step through the same list as the menu. */
export const SKIN_ORDER: string[] = DEFAULT_SKILLS.map((s) => s.name).filter(
  (n) => n in SKINS,
);

export function skinFor(name: string | null | undefined): Skin {
  if (!name) return HOUSE;
  return SKINS[name] ?? HOUSE;
}

/** sRGB relative luminance. Decides whether a skin is ink-on-paper. */
export function luminance(hex: string): number {
  const n = parseInt(hex.replace("#", ""), 16);
  const ch = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * ch[0] + 0.7152 * ch[1] + 0.0722 * ch[2];
}

/** A light surface swallows faded ink far faster than a dark one does. */
export function isLight(skin: Skin): boolean {
  return luminance(skin.void) > 0.5;
}

/**
 * Every token the stylesheet reads. Colours stay as raw hex so the CSS can
 * derive its own steps with color-mix — one source of truth per skin.
 *
 * The dimming steps are NOT shared between light and dark skins. 42% ink on
 * black still reads; 42% ink on newsprint is a smudge. So each polarity gets
 * its own ladder and the hairlines get theirs, which is the whole reason a
 * light skin here does not look like a dark one with the colours flipped.
 */
export function skinVars(skin: Skin): CSSProperties {
  const light = isLight(skin);
  return {
    "--a2": light ? "88%" : "74%",
    "--a3": light ? "72%" : "58%",
    "--a4": light ? "58%" : "46%",
    "--l1": light ? "18%" : "13%",
    "--l2": light ? "36%" : "26%",
    "--l3": light ? "10%" : "7%",
    "--void": skin.void,
    "--ink": skin.ink,
    "--sig": skin.sig,
    "--display": `var(--f-${skin.display})`,
    "--body": `var(--f-${skin.body})`,
    "--mono": `var(--f-${skin.mono})`,
    "--radius": `${skin.radius}px`,
    // A pill radius on a 15px checkbox would swallow it, so small controls get
    // their own capped step rather than the headline radius.
    "--radius-sm": `${Math.min(skin.radius, 6)}px`,
    "--bw": `${skin.border}px`,
    "--case": skin.caps ? "uppercase" : "none",
    "--track": `${skin.track}em`,
    "--title-case": skin.titleCase,
    "--title-track": `${skin.titleTrack}em`,
    "--title-lead": `${skin.titleLead}`,
    "--shadow": skin.shadow,
    "--blur": `${skin.blur}px`,
    "--grid-op": `${skin.grid}`,
    "--field-op": `${skin.fieldOpacity}`,
    "--pad": `${skin.density}`,
  } as CSSProperties;
}

/** Shader parameters. Kept out of skinVars: these cross into WebGL, not CSS. */
export function fieldParams(skin: Skin) {
  return {
    base: skin.void,
    sig: skin.sig,
    /** 1 = additive glow, 0 = ink biting into a light surface. */
    polarity: skin.field === "ink" ? 0 : 1,
    energy: skin.energy,
    texture: skin.texture,
  };
}
