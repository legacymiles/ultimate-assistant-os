// ---------------------------------------------------------------------------
// Expert Advisor Feature List — shared types.
//
// A "feature" is one written spec for an MT4/MT5 Expert Advisor: a title, a
// one-line summary for scanning, searchable tags, and the full verbatim spec
// body (the text you'd hand to Claude Code to build it).
// ---------------------------------------------------------------------------

export interface EaFeature {
  /** Stable kebab-case id, also used as the anchor/deep-link key. */
  id: string;
  title: string;
  /** One line shown in the row — what the feature does, in plain terms. */
  summary: string;
  /** Searchable labels, e.g. "Trailing Stop", "Risk Control". */
  tags: string[];
  /** The full spec, stored verbatim so it stays copy-paste ready. */
  body: string;
  /** ISO date (YYYY-MM-DD) the feature was added to the list. */
  addedAt: string;
}
