// ---------------------------------------------------------------------------
// Blueprint — skill router.
//
// Maps the vibe of an idea onto the user's own design/build skills, so the
// generated prompt tells the build agent exactly which technique to reach for.
// This mirrors the `prompt-architect` skill's router table; keep them in sync.
// ---------------------------------------------------------------------------

import type { BlueprintKind, RecommendedSkill } from "./types";

interface SkillRule {
  skill: string;
  why: string;
  /** Companion skill that should ride along when this one matches. */
  companion?: string;
  test: RegExp;
}

// Order matters: the most specific vibes are checked first, the broad
// "make it feel premium" catch-all last.
const RULES: SkillRule[] = [
  {
    skill: "exploded-showcase",
    why: "the hero — a 3D product teardown that explodes into individually labeled, inspectable parts with leader-line callouts",
    companion: "interactive-web-studio",
    test: /\b(exploded|teardown|tear[- ]down|inspect|parts|components|spec sheet|callouts?|3d product|device|gadget|machine|vehicle|engine|drone|hardware)\b/i,
  },
  {
    skill: "webgl-trail-reveal",
    why: "the hero image interaction — a mouse-trail reveal where moving the cursor uncovers a hidden/transformed layer beneath",
    companion: "interactive-web-studio",
    test: /\b(image reveal|reveal on|hover to reveal|scanning|before[- ]?after|hidden version|trail reveal|x[- ]?ray|unicorn\.?studio)\b/i,
  },
  {
    skill: "capcut-design",
    why: "a strict, consistent design-token system (exact color, type and spacing) for a clean editor/tool UI",
    test: /\b(editor|timeline|dashboard|admin|media tool|design system|token system|control panel|workspace|studio ui)\b/i,
  },
  {
    skill: "website-redesigner",
    why: "reskinning an existing site while preserving everything it does",
    test: /\b(redesign|restyle|reskin|make[- ]?over|moderni[sz]e)\b/i,
  },
  {
    skill: "interactive-web-studio",
    why: "premium, cinematic interactivity — WebGL/Three.js scenes, custom shaders, smooth scroll, a magnetic cursor and scroll-driven storytelling, with one original interactive 'toy'",
    test: /\b(premium|cinematic|immersive|interactive|3d|webgl|shader|animat|playful|game|experimental|awwwards|wow|high[- ]end|motion|scroll|parallax|luxur|bold)\b/i,
  },
];

/** Plain-technique descriptions used when a portable/shareable prompt is asked for. */
export const TECHNIQUE: Record<string, string> = {
  "interactive-web-studio":
    "premium cinematic interactivity: WebGL/Three.js scenes, custom shaders, smooth scroll, a magnetic cursor, scroll-driven storytelling and one original interactive 'toy'",
  "exploded-showcase":
    "a 3D product-teardown hero: one object on a slow orbit that explodes into individually labeled, inspectable parts with leader-line callouts",
  "webgl-trail-reveal":
    "a mouse-trail image reveal: two aligned images where moving the cursor paints a persistent trail revealing the hidden layer, with subtle distortion at the boundary",
  "capcut-design":
    "a strict, consistent design-token system (exact color, type and spacing scale) for a clean, modern editor/tool UI",
  "website-redesigner":
    "a redesign that changes only the visual layer while keeping every existing behavior intact",
};

/**
 * Recommend design skills from the free text of an idea (+ answers). Returns
 * up to `max` unique skills, each with a reason. Guarantees a sensible default
 * for websites so a polished build never ships skill-less.
 */
export function routeSkills(
  text: string,
  kind: BlueprintKind,
  max = 3,
): RecommendedSkill[] {
  const out: RecommendedSkill[] = [];
  const seen = new Set<string>();

  const push = (skill: string, why: string) => {
    if (seen.has(skill) || out.length >= max) return;
    seen.add(skill);
    out.push({ skill, why });
  };

  for (const rule of RULES) {
    if (rule.test.test(text)) {
      push(rule.skill, rule.why);
      if (rule.companion) push(rule.companion, TECHNIQUE[rule.companion] ?? "supporting motion and scene work");
    }
  }

  // Default: any website that should feel polished gets the studio skill.
  if (out.length === 0 && kind === "website") {
    push("interactive-web-studio", RULES[RULES.length - 1].why);
  }

  return out;
}

/** Translate a recommended skill into a portable technique description. */
export function toTechnique(skill: string): string {
  return TECHNIQUE[skill] ?? "the appropriate modern technique for this kind of interface";
}
