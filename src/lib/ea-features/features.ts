// ---------------------------------------------------------------------------
// Expert Advisor Feature List — the features themselves.
//
// This list is code-defined on purpose: the features are dictated and added
// here, so they ship with the app and show up on every browser and every
// deploy (no database, no per-browser storage to lose).
//
// To add a feature: append an object to EA_FEATURES. Keep `body` verbatim —
// it's what gets copied out and handed to a build agent.
// ---------------------------------------------------------------------------

import type { EaFeature } from "./types";

export const EA_FEATURES: EaFeature[] = [
  {
    id: "intelligent-position-addition-manager",
    title: "Intelligent Position Addition Manager",
    summary:
      "Gates every additional position behind secured profit instead of price distance — a new 0.02 lot only opens when the floating profit and trailing stop can already absorb the extra exposure, and the trailing stop is recalculated for the new basket size.",
    tags: [
      "Position Management",
      "Risk Control",
      "Trailing Stop",
      "Basket Exposure",
      "Entry Logic",
      "Lot Sizing",
    ],
    addedAt: "2026-07-21",
    body: `## Feature: Intelligent Position Addition Manager

Add a new feature to the existing EA that manages when additional positions may be opened.

This feature should not add positions based only on price movement or a fixed distance between trades. Instead, every new position must be evaluated to determine whether the current trade has enough protected profit to safely support another position.

The EA should continuously monitor the current floating profit and the location of the trailing stop.

Before opening another position (for example, another 0.02 lot trade), the EA must determine whether the existing profit and trailing stop provide enough protection for the additional exposure.

If adding another position would increase the possibility of the basket closing in a loss or increase drawdown beyond the protected profit, the EA must not add the position.

If the current trade has accumulated enough profit and the trailing stop has moved far enough to safely absorb the additional 0.02 lot position, the EA may open the new trade.

Every time a new position is opened, the EA must immediately recalculate the trailing stop to account for the increased total lot size and overall basket exposure.

As price continues moving in profit, the trailing stop should continue advancing. Each time additional profit is secured by the trailing stop, the EA should reevaluate whether another 0.02 lot position can now be safely added.

The goal is to allow the EA to gradually build larger positions while using previously secured profit to support future entries, rather than increasing exposure that the current trade cannot yet afford.`,
  },
];

/** Every distinct tag in the list, most-used first, then A–Z. */
export function allTags(features: EaFeature[] = EA_FEATURES): string[] {
  const counts = new Map<string, number>();
  for (const f of features) {
    for (const t of f.tags) counts.set(t, (counts.get(t) ?? 0) + 1);
  }
  return Array.from(counts.keys()).sort((a, b) => {
    const d = (counts.get(b) ?? 0) - (counts.get(a) ?? 0);
    return d !== 0 ? d : a.localeCompare(b);
  });
}

/**
 * Search across title, summary, tags and the full spec body, then narrow to
 * features carrying every selected tag. Newest features sort first.
 */
export function filterFeatures(
  features: EaFeature[],
  query: string,
  tags: string[],
): EaFeature[] {
  const q = query.trim().toLowerCase();
  return features
    .filter((f) => {
      if (tags.length > 0 && !tags.every((t) => f.tags.includes(t))) return false;
      if (!q) return true;
      return (
        f.title.toLowerCase().includes(q) ||
        f.summary.toLowerCase().includes(q) ||
        f.body.toLowerCase().includes(q) ||
        f.tags.some((t) => t.toLowerCase().includes(q))
      );
    })
    .sort((a, b) => b.addedAt.localeCompare(a.addedAt) || a.title.localeCompare(b.title));
}
