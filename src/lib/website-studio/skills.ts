// ---------------------------------------------------------------------------
// Website Studio — the design skills dropdown, from the real registry.
//
// Nothing here invents a skill. The list IS the design-skill roster
// (`src/lib/redesigner/design-skills.json`), which a hook appends to every time
// a design skill is installed, enriched with the Skills Library's web design
// guide ("best for …"). A skill that lands in the roster tomorrow shows up in
// the dropdown tomorrow, with a role worked out from its own description.
//
// What this file adds is the part that lived only in prose: which skills can
// be combined. One base owns the look; passes and specialists stack on it;
// Impeccable always closes; anything that spends money or renders footage is
// opt-in and says so.
//
// Pure: no React, no fetch, no storage.
// ---------------------------------------------------------------------------

import roster from "@/lib/redesigner/design-skills.json";
import { DESIGN_GUIDE } from "@/lib/skills/design-guide";

/**
 * - base: owns the whole look. Exactly one; picking another replaces it.
 * - pass: a craft or review pass that runs around the base. Stacks.
 * - specialist: one technique or centrepiece added to the page. Stacks.
 * - workflow: a way of starting (clone a site, remix one). Stacks.
 */
export type SkillRole = "base" | "pass" | "specialist" | "workflow";

export interface StudioSkill {
  name: string;
  description: string;
  /** From the Skills Library's web design guide, when it has an entry. */
  bestFor: string;
  role: SkillRole;
  /** Spends money or renders images/footage — never picked for the owner. */
  paid: boolean;
  /** When this pass runs relative to the base. Passes only. */
  when?: "before" | "after";
}

export interface RosterEntry {
  name: string;
  description: string;
}

/** The default base: the owner's rule is one default for everything user-facing. */
export const DEFAULT_BASE = "interactive-web-studio";
/** The pass that always closes the look, whichever base ran. */
export const CLOSING_PASS = "impeccable";

/**
 * What the registry cannot say about a skill by itself. Kept to the handful
 * of facts the owner has stated as rules; everything else is inferred.
 */
const ROLE: Record<string, SkillRole> = {
  // The looks the owner's rules name as bases ("bases replace each other").
  // Named rather than inferred: their own descriptions mention WebGL, audits
  // and scroll, which is what a specialist or a pass would say too.
  "interactive-web-studio": "base",
  "taste-skill": "base",
  "taste-skill-v1": "base",
  "soft-skill": "base",
  "minimalist-skill": "base",
  "brutalist-skill": "base",
  "cinematic-ui": "base",
  "redesign-skill": "base",
  "gpt-tasteskill": "base",
  "stitch-skill": "base",
  "frontend-design": "base",
  "capcut-design": "base",
  impeccable: "pass",
  "ui-ux-pro-max": "pass",
  "web-design-guidelines": "pass",
  "webgl-trail-reveal": "specialist",
  "exploded-showcase": "specialist",
  dataviz: "specialist",
  "scroll-craft": "specialist",
  "scroll-world": "specialist",
  "h3-scroll-world": "specialist",
  "real-estate-reveal": "specialist",
  "blender-to-web": "specialist",
  brandkit: "specialist",
  "imagegen-frontend-web": "specialist",
  "imagegen-frontend-mobile": "specialist",
  "image-to-code-skill": "specialist",
  "clone-site": "workflow",
  "remix-site": "workflow",
  "shader-extract": "workflow",
};

/** Runs before the base (it feeds palettes and pairings into it). Every other pass runs after. */
const BEFORE = new Set(["ui-ux-pro-max"]);

/** Opt-in only: each of these spends money or renders images or footage. */
const PAID = new Set([
  "brandkit",
  "h3-scroll-world",
  "scroll-world",
  "scroll-craft",
  "real-estate-reveal",
  "imagegen-frontend-web",
  "imagegen-frontend-mobile",
  "image-to-code-skill",
  "blender-to-web",
]);

/**
 * In the roster because the Redesigner page has a skin for them, but not a
 * thing a website build is styled or started with: a depth (commercial), a
 * video tool, an icon maker, an exporter, a slides themer, an artifact bundler.
 */
const NOT_FOR_SITES = new Set([
  "commercial",
  "hyperframes",
  "preview-icon",
  "blender-threejs-export",
  "theme-factory",
  "web-artifacts-builder",
]);

/** A role for a skill nobody has classified, read off its own description. */
export function inferRole(description: string): SkillRole {
  const d = description.toLowerCase();
  if (/\b(clone|remix|extract|copy|port)\b/.test(d) && /\b(site|website|page|shader)\b/.test(d)) return "workflow";
  if (/\b(audit|review|critique|polish|guidelines|checklist|accessibility)\b/.test(d) && !/\b(build|create)s? (a |an )?(website|landing|site)\b/.test(d)) return "pass";
  if (/\b(hero|reveal|effect|webgl|shader|scroll-driven|scroll world|3d|teardown|logo|brand kit|image)\b/.test(d)) return "specialist";
  return "base";
}

function guideFor(name: string): string {
  const hit = DESIGN_GUIDE.find((g) => g.slug === name || g.name === name || g.slug.endsWith(`:${name}`));
  return hit?.bestFor ?? "";
}

function toSkill(e: RosterEntry): StudioSkill {
  const role = ROLE[e.name] ?? inferRole(e.description);
  return {
    name: e.name,
    description: e.description,
    bestFor: guideFor(e.name),
    role,
    paid: PAID.has(e.name),
    ...(role === "pass" ? { when: BEFORE.has(e.name) ? ("before" as const) : ("after" as const) } : {}),
  };
}

const ROLE_ORDER: SkillRole[] = ["base", "pass", "specialist", "workflow"];

/**
 * Every skill the dropdown offers, grouped base → passes → specialists →
 * workflows, the default base first and free before paid.
 *
 * `extra` is how the list grows without a code change: pass it skills found
 * somewhere else (the Skills Library's Web Design category, a scan of the PC)
 * and any the roster does not already have are added, classified the same way.
 */
export function studioSkills(extra: RosterEntry[] = [], base: RosterEntry[] = roster as RosterEntry[]): StudioSkill[] {
  const seen = new Set<string>();
  const out: StudioSkill[] = [];
  for (const e of [...base, ...extra]) {
    const name = e?.name?.trim();
    if (!name || seen.has(name) || NOT_FOR_SITES.has(name)) continue;
    seen.add(name);
    out.push(toSkill({ name, description: (e.description ?? "").trim() }));
  }
  return out.sort(
    (a, b) =>
      ROLE_ORDER.indexOf(a.role) - ROLE_ORDER.indexOf(b.role) ||
      Number(b.name === DEFAULT_BASE) - Number(a.name === DEFAULT_BASE) ||
      Number(b.name === CLOSING_PASS) - Number(a.name === CLOSING_PASS) ||
      Number(a.paid) - Number(b.paid) ||
      0,
  );
}

export const ROLE_LABEL: Record<SkillRole, string> = {
  base: "Look — pick one",
  pass: "Craft passes — stack",
  specialist: "Centrepieces — stack",
  workflow: "Ways to start — stack",
};

/** The dropdown's sections, in order, empty ones left out. */
export function skillGroups(skills: StudioSkill[]): { role: SkillRole; label: string; skills: StudioSkill[] }[] {
  return ROLE_ORDER.map((role) => ({ role, label: ROLE_LABEL[role], skills: skills.filter((s) => s.role === role) })).filter(
    (g) => g.skills.length,
  );
}

// ----- combining ---------------------------------------------------------------------------

export interface SkillCombo {
  /** The one skill that owns the look. */
  base: string;
  /** Passes that run before the base, in pick order. */
  before: string[];
  /** Specialists and workflows, in pick order. */
  extras: string[];
  /** Passes that run after, Impeccable always last. */
  after: string[];
  /** Picked skills that spend money or render footage. */
  paid: string[];
  /** The order the build runs them in. */
  order: string[];
}

/**
 * Tick or untick one skill, applying the combination rules so the selection
 * is always a valid one:
 * - ticking a base replaces the base already picked (bases never stack);
 * - the closing pass cannot be unticked — it always runs;
 * - everything else simply toggles.
 */
export function toggleSkill(picks: readonly string[], name: string, skills: StudioSkill[]): string[] {
  const skill = skills.find((s) => s.name === name);
  if (!skill) return [...picks];
  const has = picks.includes(name);
  if (skill.role === "base") {
    const others = picks.filter((p) => skills.find((s) => s.name === p)?.role !== "base");
    // Unticking the only base falls back to the default rather than to none.
    return has ? others : [...others, name];
  }
  if (name === CLOSING_PASS) return has ? [...picks] : [...picks, name];
  return has ? picks.filter((p) => p !== name) : [...picks, name];
}

/**
 * The selection as the build will run it. Unknown names are dropped, a missing
 * base becomes the default, and Impeccable closes whether it was ticked or not.
 */
export function combine(picks: readonly string[], skills: StudioSkill[] = studioSkills()): SkillCombo {
  const known = picks.map((p) => skills.find((s) => s.name === p)).filter((s): s is StudioSkill => Boolean(s));
  const bases = known.filter((s) => s.role === "base");
  const base = bases.length ? bases[bases.length - 1].name : DEFAULT_BASE;
  const before = known.filter((s) => s.role === "pass" && s.when === "before").map((s) => s.name);
  const extras = known.filter((s) => s.role === "specialist" || s.role === "workflow").map((s) => s.name);
  const after = [
    ...known.filter((s) => s.role === "pass" && s.when !== "before" && s.name !== CLOSING_PASS).map((s) => s.name),
    CLOSING_PASS,
  ];
  const paid = known.filter((s) => s.paid).map((s) => s.name);
  const order = [...before, base, ...extras, ...after].filter((n, i, all) => all.indexOf(n) === i);
  return { base, before, extras, after, paid, order };
}

/** What the dropdown's button says: "interactive-web-studio + 2". */
export function comboLabel(c: SkillCombo): string {
  const more = c.order.length - 2; // not counting the base or the always-on closing pass
  return more > 0 ? `${c.base} + ${more}` : c.base;
}

/**
 * The lines a build brief carries for the picked skills, so the PC runs them
 * in the order chosen and knows which one owns the look.
 */
export function comboBrief(c: SkillCombo): string {
  const lines = [
    `Design skills the owner picked in Website Studio, in the order to run them: ${c.order.join(" → ")}.`,
    `${c.base} owns the look — surface, type, radius, density. The others add to it and never restyle it.`,
  ];
  if (c.before.length) lines.push(`Run ${c.before.join(", ")} first; it feeds palettes and pairings into ${c.base}.`);
  if (c.extras.length) lines.push(`Stack ${c.extras.join(", ")} on top as their own centrepiece or step.`);
  lines.push(`${CLOSING_PASS} closes the look pass on every screen.`);
  if (c.paid.length) lines.push(`The owner opted in to ${c.paid.join(", ")}, which spend money or render footage — images and video are made locally with WanGP, never a paid source.`);
  return lines.join("\n");
}
