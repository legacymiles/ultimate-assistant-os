// ---------------------------------------------------------------------------
// Design Intelligence — the words every website build receives.
//
// One block, three modes, used by every builder in the hub:
//   build    — App Builder making something new
//   review   — Client Review edits: keep the site's look, raise nothing generic
//   redesign — Redesigner / App Builder redesign: audit the old site, then beat it
//
// What this block is NOT: a design. It never names a palette, a typeface or a
// layout. Those belong to the design skill the pipeline already names (the
// Redesigner V2 brief explains why — a token sheet written in between keeps the
// colours and throws the skill's opinions away). This is the PROCESS around the
// skill: understand, research, choose, find real components, give the page one
// standout, then prove it with a check the builder did not write.
//
// Pure: a string in, a string out, tested beside it.
// ---------------------------------------------------------------------------

import { REGISTRIES } from "./sources";

export type DesignMode = "build" | "review" | "redesign";

export interface DesignBriefOptions {
  mode: DesignMode;
  /** The design skill that owns every visual decision (from the pipeline or the picked look). */
  skill?: string;
  /** "website" for pages people visit, "app" for a product people use. Changes the standout advice. */
  surface?: "website" | "app";
  /** The live site being redesigned or edited — the design check's "before". */
  beforeUrl?: string;
  /** Routes that must carry a standout. Defaults to the home page. */
  importantPaths?: string[];
  /**
   * False inside a hub worktree, where node_modules is shared and installing is
   * forbidden: components are ported from their registry source instead.
   */
  canInstall?: boolean;
  /** How to get the site running for the check, when it is not obvious. */
  runHint?: string;
  /**
   * The named skill is the ONLY design voice (a Redesigner bake-off lane): the
   * block then names no other skill — no closing pass, no motion skill — so
   * the difference between lanes stays the skill and nothing else.
   */
  soleSkill?: boolean;
}

/** Packages the hub already has, so a ported component can use them without an install. */
export const HUB_PACKAGES = ["motion", "gsap", "lucide-react", "tailwind-merge", "three", "@react-three/fiber", "@react-three/drei"];

/** How a build runs the check, from any shell. The bridge sets JARVIS_DESIGN_CHECK on every thread. */
export const CHECK_COMMAND = 'node "$JARVIS_DESIGN_CHECK" <url>';
export const CHECK_COMMAND_PS = "node $env:JARVIS_DESIGN_CHECK <url>";

/** The tells that read as "basic", banned in every mode. */
export const BANNED = [
  "placeholder copy of any kind (lorem ipsum, \"Feature 1\", \"Your Company\", \"John Doe\", 555 numbers, \"coming soon\") and stand-in image services",
  "a centred hero that is one big heading, one sentence and two buttons",
  "the same grid of rounded, shadowed cards section after section",
  "default type at one weight (Inter/system on white) with Tailwind's stock blue button",
  "a purple-to-pink gradient, glass panels or blur as a substitute for a direction",
  "motion on everything, or no motion at all; emoji doing an icon's job",
  "shadcn/Magic UI/Aceternity components left in their demo styling — an installed component is a starting point, never the finish",
];

const registryList = Object.keys(REGISTRIES).join(", ");

function standoutRule(surface: "website" | "app", paths: string[]): string {
  const what =
    surface === "app"
      ? "one moment of delight that serves the work — a command palette that feels instant, a live number that rolls, a drag that has weight, an empty state with personality"
      : "one memorable visual or interactive feature — the hero's mechanic, a scroll moment, a reveal, a piece of data made physical";
  return [
    `One-Standout Rule: ${paths.join(", ")} ${paths.length === 1 ? "gets" : "each get"} ${what}. One, executed perfectly, that fits the direction — not several competing gimmicks, and never effects added only to look modern.`,
    `Mark the standout's root element with data-standout="<what it is in a few words>". The design check fails an important page without one. It must keep working (or degrade to a still, legible version) under prefers-reduced-motion and on a phone.`,
  ].join("\n");
}

function componentsSection(canInstall = true, soleSkill = false): string {
  const motion = soleSkill
    ? "- Motion: every animation must earn its place — check easing, duration and interruption on each one before you finish."
    : "- Motion craft: Emil Kowalski's skills (`emil-design-eng`, `review-animations`) — run `review-animations` on anything that moves.";
  if (!canInstall) {
    return [
      "Find real components before writing your own — but this folder may not install anything:",
      `- Search the registries (shadcn MCP, Magic UI MCP, or browse magicui.design, ui.aceternity.com, 21st.dev). Read the item's registry JSON (e.g. ${Object.values(REGISTRIES)[0].replace("{name}", "<item>")}) and port its source into this app's own folder, using only packages already installed here: ${HUB_PACKAGES.join(", ")}. If a component needs anything else, rebuild its effect with those, or choose another.`,
      motion,
      "- Restyle every ported component to the direction; never leave its demo styling. Note each one in your report: component → source → licence (Aceternity: fine here, never redistributed as a template; Magic UI Pro and 21st.dev items need their own licence).",
    ].join("\n");
  }
  return [
    "Find real components before writing your own:",
    `- One install path: the shadcn CLI (v4). \`npx shadcn@latest init\`, then add the registries ${registryList} to components.json (\`registries\`: ${Object.entries(REGISTRIES)
      .map(([k, v]) => `"${k}": "${v}"`)
      .join(", ")}). Search with the shadcn MCP (\`npx shadcn@latest mcp\`) or the Magic UI MCP when connected; install with \`npx shadcn@latest add @magicui/<item>\` / \`@aceternity/<item>\`, or a 21st.dev component with \`npx shadcn@latest add "https://21st.dev/r/<author>/<slug>"\`.`,
    "- Primitives, never hand-rolled: Base UI or Radix (through shadcn), Sonner for toasts, `command` (cmdk) for a ⌘K palette, `drawer` (Vaul — unmaintained but stable) for phone sheets, `@number-flow/react` for any number that changes.",
    motion,
    "- Then restyle every installed component to the direction, from the design skill's tokens. Pick components because the direction needs them; never build the page around a component because it exists.",
    "- Licences: Aceternity is free for client sites but never redistributable as a template; Magic UI Pro and 21st.dev items need their own licences; Unicorn Studio scenes only with a real Unicorn Studio account (its SDK keeps the watermark). Add a short Components table to the README and your report: component → source → licence.",
  ].join("\n");
}

function researchSection(mode: DesignMode): string {
  return [
    `Research before choosing${mode === "review" ? " (only when an edit adds something new to the site)" : ""}:`,
    "- Look at 3–5 real, current references for THIS category and audience: Awwwards collections, recent.design (formerly Godly), the Aura gallery, and the named quality bar. Browse them; never scrape them and never copy a page — write down the one principle each teaches (how the hero works, how the type is set, the interaction people remember).",
    "- None of those three has an API or MCP. Do not claim to have used them programmatically.",
  ].join("\n");
}

function checkSection(mode: DesignMode, paths: string[], beforeUrl?: string, runHint?: string): string {
  const flags = `--important ${paths.join(",")}`;
  return [
    "Prove it — the design check, which you did not write and cannot soften:",
    runHint ? `- ${runHint}` : "",
    `- Run \`${CHECK_COMMAND} ${flags}\` (PowerShell: \`${CHECK_COMMAND_PS} ${flags}\`) against the running site. It loads each page at 390 px and 1440 px in a real browser, saves screenshots, and fails on placeholder copy, sideways scroll, console errors, broken images, unreadable contrast, the default-AI-site look, a page of look-alike card grids, and an important page with no standout.`,
    mode === "redesign" && beforeUrl
      ? `- Run it FIRST on the current site (${beforeUrl}) and keep that report as the baseline: it names what reads as generic today. The redesign must have zero fails and a higher score than the baseline.`
      : mode === "review" && beforeUrl
      ? `- Run it on the current version (${beforeUrl}) before you change anything, and again on your branch. Your edits may not add a single new fail.`
      : "",
    "- Open the screenshots and actually look at them. Fix every fail, then every warning you agree with, and run it again. Two rounds; if it still fails, say exactly what and why in your report.",
    "- Put the check's first line (PASS/FAIL · score) in your final report.",
  ]
    .filter(Boolean)
    .join("\n");
}

/** The `<design_intelligence>` block for a build brief. */
export function designIntelligenceBlock(o: DesignBriefOptions): string {
  const surface = o.surface ?? "website";
  const paths = o.importantPaths?.length ? o.importantPaths : ["/"];
  const skill = o.skill ?? "the design skill in the pipeline";

  if (o.mode === "review") {
    return [
      "<design_intelligence>",
      "These are edits to a site a client already has. Its design is the brief: match its type, colour, spacing, radius and voice so every change looks native. No redesign, and no unrequested change.",
      "But never lower the bar: an edit that adds a section, a form or a component builds it in the site's own language with a real component (below), with real content — not a generic block dropped in.",
      componentsSection(o.canInstall ?? true, o.soleSkill ?? false),
      researchSection("review"),
      `Banned in anything you add:\n${BANNED.map((b) => `- ${b}`).join("\n")}`,
      checkSection("review", paths, o.beforeUrl, o.runHint),
      "</design_intelligence>",
    ].join("\n\n");
  }

  const steps = [
    `1. Understand — who this is for, what it must make them feel, and the one thing they must remember. Write it in three lines before any code.${o.mode === "redesign" ? " For a redesign, also list what the current site does (the functionality inventory) and what reads as generic on it today." : ""}`,
    "2. Research — see below. Real references for this category, not memory.",
    `3. Choose a direction — run ${skill} and commit to ONE distinctive direction it proposes for this project (type pairing, colour world, layout logic, motion personality). Say it in 4–6 lines. It must be specific to this project: if it would suit any other site, it is not a direction.`,
    "4. Find and implement real components and effects — see below.",
    "5. Build it cohesive — one system of tokens, every screen and state (hover, focus, loading, empty, error) in the same language, real content throughout, motion that means something.",
    `6. Preview, inspect, test and refine — the design check below${o.soleSkill ? "" : ", then impeccable's closing pass"}.`,
  ];

  return [
    "<design_intelligence>",
    o.mode === "redesign"
      ? "This is a redesign. Every function the site has today must still work afterwards; only the design changes. The six steps below are mandatory, in order, before and during the build."
      : "Before and during the build, these six steps are mandatory, in order. You choose the design yourself — the owner should never have to supply ideas or ask for it to be better.",
    steps.join("\n"),
    researchSection(o.mode),
    componentsSection(o.canInstall ?? true, o.soleSkill ?? false),
    standoutRule(surface, paths),
    `Banned — each reads as basic, generic AI output:\n${BANNED.map((b) => `- ${b}`).join("\n")}`,
    checkSection(o.mode, paths, o.beforeUrl, o.runHint),
    "</design_intelligence>",
  ].join("\n\n");
}

/** One line for briefs that have no room (In Queue's 4000 characters). */
export function designIntelligenceLine(mode: DesignMode): string {
  return mode === "review"
    ? "Design Intelligence (review): match the site's own design; anything added uses a real component (shadcn/@magicui/@aceternity) in the site's language; no placeholder or generic blocks; run the design check before and after — no new fails."
    : `Design Intelligence (${mode}): run the design-intelligence skill — understand, research real references, commit to one direction, install real components (shadcn + @magicui/@aceternity/21st.dev), one data-standout per important page, then the design check (0 fails) before reporting.`;
}
