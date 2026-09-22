// AI rates every place first; community ratings pull it up or down. The AI
// counts as AI_PRIOR_WEIGHT votes, so a handful of ratings nudge it and ten or
// so mostly decide it.
export const AI_PRIOR_WEIGHT = 3;
export const MIN_COMMUNITY_RATINGS = 3;

export interface StarInput {
  aiStars: number | null;
  ratingCount: number;
  ratingSum: number;
}

export interface Stars {
  /** One decimal, for the detail panel. */
  value: number | null;
  /** Whole star, for filtering and the table. */
  rounded: number | null;
  source: "ai" | "blend" | "community" | "none";
}

const clamp = (n: number) => Math.min(5, Math.max(1, n));
const oneDecimal = (n: number) => Math.round(n * 10) / 10;

function stars(raw: number, source: Stars["source"]): Stars {
  const value = oneDecimal(clamp(raw));
  return { value, rounded: Math.round(value), source };
}

export function blendedStars({ aiStars, ratingCount, ratingSum }: StarInput): Stars {
  if (aiStars != null) {
    if (ratingCount === 0) return stars(aiStars, "ai");
    return stars((aiStars * AI_PRIOR_WEIGHT + ratingSum) / (AI_PRIOR_WEIGHT + ratingCount), "blend");
  }
  if (ratingCount >= MIN_COMMUNITY_RATINGS) return stars(ratingSum / ratingCount, "community");
  return { value: null, rounded: null, source: "none" };
}
