// ---------------------------------------------------------------------------
// Mockups — choosing the three directions.
//
// A bake-off is only worth looking at if the lanes DISAGREE. Three dark
// console skins side by side is not a choice, it is the same answer printed
// three times, and the owner learns nothing by staring at it.
//
// So the three lanes are picked by FAMILY, not by name: the recommended skill
// takes lane 1, and lanes 2 and 3 come from two families the recommendation is
// not in. The skins module already groups the skills into seven worlds (void,
// terminal, paper, atelier, lab, reel…) and that grouping is what makes the
// comparison real — surface polarity, type voice, corner radius and layout all
// move together, which is what a design skill actually decides.
//
// Lane 1 is always the recommendation. Putting it first and labelling it means
// the owner is judging the house pick against alternatives rather than being
// handed three strangers, and if they keep lane 1 that is a real decision
// rather than a default they never saw.
// ---------------------------------------------------------------------------

import { SKINS, skinFor, type Skin } from "@/lib/redesigner/skins";
import type { Chrome, MockupDirection } from "./types";

/**
 * The skills worth offering as an alternative.
 *
 * Deliberately the owner's own swap list (see their build rules) rather than
 * all 34 skins: a bake-off against `shader-extract` or `preview-icon` is a
 * category error, because those are not directions an app's look can be.
 */
const CANDIDATES = [
  "interactive-web-studio",
  "taste-skill",
  "soft-skill",
  "minimalist-skill",
  "brutalist-skill",
  "cinematic-ui",
  "commercial",
  "frontend-design",
  "impeccable",
  "redesign-skill",
  "capcut-design",
  "stitch-skill",
];

/** The skin's layout IS the chrome: how the app gets framed. */
function chromeOf(skin: Skin): Chrome {
  return skin.layout as Chrome;
}

/**
 * Three directions for this app.
 *
 * `recommended` is whatever the spec already chose (understanding.designSkill).
 * An unknown or empty name falls back to the studio default rather than
 * failing — a mockup that refuses to draw because a skill name was misspelt is
 * worse than a mockup in the house look.
 */
export function directionsFor(recommended: string | undefined | null): MockupDirection[] {
  const first = recommended && recommended in SKINS ? recommended : "interactive-web-studio";
  const firstSkin = skinFor(first);
  const lanes: MockupDirection[] = [
    {
      skill: first,
      note: firstSkin.note,
      role: "recommended",
      chrome: chromeOf(firstSkin),
    },
  ];

  const usedFamilies = new Set([firstSkin.family]);
  const usedChromes = new Set([chromeOf(firstSkin)]);

  for (const name of CANDIDATES) {
    if (lanes.length >= 3) break;
    if (name === first) continue;
    const skin = SKINS[name];
    if (!skin) continue;
    // A different family is the point. A different chrome on top of that is
    // what stops two lanes reading as the same page in two colourways.
    if (usedFamilies.has(skin.family)) continue;
    if (usedChromes.has(chromeOf(skin))) continue;
    usedFamilies.add(skin.family);
    usedChromes.add(chromeOf(skin));
    lanes.push({ skill: name, note: skin.note, role: "contrast", chrome: chromeOf(skin) });
  }

  // If the roster was too narrow to find two contrasting families (only
  // possible if the skins module shrinks), fill on family alone rather than
  // showing fewer than three lanes — a two-lane bake-off is a different,
  // worse product than a three-lane one.
  for (const name of CANDIDATES) {
    if (lanes.length >= 3) break;
    if (name === first || lanes.some((l) => l.skill === name)) continue;
    const skin = SKINS[name];
    if (!skin || usedFamilies.has(skin.family)) continue;
    usedFamilies.add(skin.family);
    lanes.push({ skill: name, note: skin.note, role: "contrast", chrome: chromeOf(skin) });
  }

  return lanes;
}

/** The direction the owner or client settled on, ready to draw again. */
export function directionFor(skill: string): MockupDirection {
  const skin = skinFor(skill);
  return {
    skill: skin.id === "house" ? "interactive-web-studio" : skill,
    note: skin.note,
    role: "recommended",
    chrome: chromeOf(skin),
  };
}
