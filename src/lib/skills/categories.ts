// ---------------------------------------------------------------------------
// Skills Library — topical categories.
//
// Categories are a curated, code-defined layer keyed by a skill's stable slug.
// Keying by slug (not by row id) means a category survives a re-sync: the scan
// overwrites a synced skill's title/overview/body but never its slug. Add a
// slug here to tag another skill; a skill with no entry is "uncategorized" and
// only appears under the "All" filter.
// ---------------------------------------------------------------------------

import type { Skill } from "./types";

/** slug → category label. */
export const CATEGORY_BY_SLUG: Record<string, string> = {
  "github:scroll-world": "Web Design",
  "interactive-web-studio": "Web Design",
  "webgl-trail-reveal": "Web Design",
  "exploded-showcase": "Web Design",
  "capcut-design": "Web Design",
};

/** Preferred order for the category filter chips; others sort after, A–Z. */
export const CATEGORY_ORDER = ["Web Design"];

/** The category for a skill, or null when it hasn't been tagged. */
export function categoryFor(skill: Skill): string | null {
  if (skill.slug && CATEGORY_BY_SLUG[skill.slug]) return CATEGORY_BY_SLUG[skill.slug];
  return null;
}

/** Distinct categories present in a list, in display order. */
export function categoriesIn(skills: Skill[]): string[] {
  const set = new Set<string>();
  for (const s of skills) {
    const c = categoryFor(s);
    if (c) set.add(c);
  }
  return Array.from(set).sort((a, b) => {
    const ia = CATEGORY_ORDER.indexOf(a);
    const ib = CATEGORY_ORDER.indexOf(b);
    if (ia !== -1 || ib !== -1) return (ia === -1 ? 999 : ia) - (ib === -1 ? 999 : ib);
    return a.localeCompare(b);
  });
}
