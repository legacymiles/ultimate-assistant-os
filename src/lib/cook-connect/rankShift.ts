// Where a game moved you on that game's leaderboard.
//
// The game-over screen shows a player going up or down the rankings (owner's
// rule, Oct 2026). Rank the board without this match, then with it, and
// compare. Pure, so every browser at the table reaches the same answer.

import { buildRecords, QUALIFYING_GAMES, type MatchResult } from "./stats";
import { gameBoard, type GameId, type GameStanding } from "./sides";

export interface RankShift {
  /** 1-based rank before this match, or null if this was your first game here. */
  before: number | null;
  /** 1-based rank after it. */
  after: number;
  /** Places gained (positive) or lost (negative). 0 when unchanged or new. */
  moved: number;
  /** How many players are on the board now. */
  of: number;
  /** Still under the qualifying number of games, so ranked below every qualified player. */
  provisional: boolean;
  /** Games to go before the record joins the ranked board (0 once qualified). */
  toQualify: number;
  /** Your standing on this game's board after the match. */
  standing: GameStanding;
}

const rankOf = (board: GameStanding[], userId: string): number | null => {
  const i = board.findIndex((r) => r.userId === userId);
  return i < 0 ? null : i + 1;
};

/**
 * Null when this match's result for `userId` is not in yet (it is written a
 * moment after the game ends) or the player has no record on this board.
 */
export function rankShift(
  results: MatchResult[],
  matchId: string,
  userId: string,
  game: GameId,
): RankShift | null {
  const mine = results.some((r) => r.matchId === matchId && r.userId === userId);
  if (!mine) return null;

  const afterBoard = gameBoard(buildRecords(results), game);
  const beforeBoard = gameBoard(buildRecords(results.filter((r) => r.matchId !== matchId)), game);

  const after = rankOf(afterBoard, userId);
  if (after === null) return null;
  const before = rankOf(beforeBoard, userId);
  const standing = afterBoard[after - 1];

  return {
    before,
    after,
    moved: before === null ? 0 : before - after,
    of: afterBoard.length,
    provisional: !standing.qualified,
    toQualify: Math.max(0, QUALIFYING_GAMES - standing.played),
    standing,
  };
}

/** The line under the rank: plain words, never just a number. */
export function rankShiftLine(shift: RankShift): string {
  if (shift.before === null) return `New on the board at #${shift.after} of ${shift.of}.`;
  if (shift.moved > 0) return `Up ${shift.moved} ${shift.moved === 1 ? "place" : "places"}, from #${shift.before} to #${shift.after}.`;
  if (shift.moved < 0) {
    const n = Math.abs(shift.moved);
    return `Down ${n} ${n === 1 ? "place" : "places"}, from #${shift.before} to #${shift.after}.`;
  }
  return `Holding at #${shift.after} of ${shift.of}.`;
}
