// Leaderboard ranking.
//
// Players are ranked on wins and win rate. The wrinkle the owner asked for:
// a 3-0 player must not outrank a 40-25 one, so anybody under the qualifying
// number of games is ranked below every qualified player and shown as
// provisional rather than hidden.

export const QUALIFYING_GAMES = 5;

export interface MatchResult {
  userId: string;
  /** "win" | "loss" | "draw". Draws count as played but win neither. */
  result: "win" | "loss" | "draw";
  /** Newest last — order decides the streak. */
  finishedAt: string;
  game: "spades" | "chess";
  /** The match it came from — lets a game-over screen rank "before" and "after". */
  matchId?: string;
}

export interface PlayerRecord {
  userId: string;
  played: number;
  wins: number;
  losses: number;
  draws: number;
  /** 0–1. Draws count as half a win, the way chess scores a game. */
  winRate: number;
  /** Positive for a run of wins, negative for a run of losses, 0 after a draw. */
  streak: number;
  /** False until the player has reached QUALIFYING_GAMES. */
  qualified: boolean;
  byGame: Record<"spades" | "chess", { played: number; wins: number }>;
}

const emptyByGame = (): PlayerRecord["byGame"] => ({
  spades: { played: 0, wins: 0 },
  chess: { played: 0, wins: 0 },
});

/** Fold a list of finished match results into one record per player. */
export function buildRecords(results: MatchResult[]): PlayerRecord[] {
  const byUser = new Map<string, MatchResult[]>();
  for (const r of results) {
    const list = byUser.get(r.userId);
    if (list) list.push(r);
    else byUser.set(r.userId, [r]);
  }

  return [...byUser.entries()].map(([userId, list]) => {
    const ordered = [...list].sort((a, b) => a.finishedAt.localeCompare(b.finishedAt));
    const wins = ordered.filter((r) => r.result === "win").length;
    const losses = ordered.filter((r) => r.result === "loss").length;
    const draws = ordered.filter((r) => r.result === "draw").length;
    const played = ordered.length;

    // Walk back from the newest result while it keeps repeating.
    let streak = 0;
    const last = ordered[ordered.length - 1];
    if (last && last.result !== "draw") {
      const sign = last.result === "win" ? 1 : -1;
      for (let i = ordered.length - 1; i >= 0 && ordered[i].result === last.result; i--) {
        streak += sign;
      }
    }

    const byGame = emptyByGame();
    for (const r of ordered) {
      byGame[r.game].played += 1;
      if (r.result === "win") byGame[r.game].wins += 1;
    }

    return {
      userId,
      played,
      wins,
      losses,
      draws,
      winRate: played === 0 ? 0 : (wins + draws * 0.5) / played,
      streak,
      qualified: played >= QUALIFYING_GAMES,
      byGame,
    };
  });
}

/**
 * Rank order: qualified players first, then win rate, then wins, then fewer
 * games (a better rate over fewer games is the tie-break, not the headline),
 * then user id so the order never wobbles between renders.
 */
export function rankRecords(records: PlayerRecord[]): PlayerRecord[] {
  return [...records].sort((a, b) => {
    if (a.qualified !== b.qualified) return a.qualified ? -1 : 1;
    if (b.winRate !== a.winRate) return b.winRate - a.winRate;
    if (b.wins !== a.wins) return b.wins - a.wins;
    if (a.played !== b.played) return a.played - b.played;
    return a.userId.localeCompare(b.userId);
  });
}

export const leaderboard = (results: MatchResult[]): PlayerRecord[] =>
  rankRecords(buildRecords(results));

/** "62%" — no decimals; the table is scanned, not audited. */
export const formatWinRate = (rate: number): string => `${Math.round(rate * 100)}%`;

export function formatStreak(streak: number): string {
  if (streak === 0) return "—";
  return streak > 0 ? `W${streak}` : `L${Math.abs(streak)}`;
}

export interface CookbookStanding {
  cookbookId: string;
  title: string;
  ownerId: string;
  saves: number;
  recipes: number;
}

/** Most-saved cookbooks. Ties break on the deeper cookbook, then on title. */
export function rankCookbooks(rows: CookbookStanding[]): CookbookStanding[] {
  return [...rows].sort((a, b) => {
    if (b.saves !== a.saves) return b.saves - a.saves;
    if (b.recipes !== a.recipes) return b.recipes - a.recipes;
    return a.title.localeCompare(b.title);
  });
}
