import { describe, expect, it } from "vitest";
import { rankShift, rankShiftLine } from "./rankShift";
import type { MatchResult } from "./stats";

let t = 0;
const r = (userId: string, result: MatchResult["result"], matchId: string, game: MatchResult["game"] = "spades"): MatchResult => ({
  userId, result, matchId, game, finishedAt: new Date(Date.UTC(2026, 9, 1, 0, t++)).toISOString(),
});

/** n results for a user, `wins` of them wins, each its own match. */
const record = (userId: string, wins: number, n: number): MatchResult[] =>
  Array.from({ length: n }, (_, i) => r(userId, i < wins ? "win" : "loss", `${userId}-m${i}`));

describe("rankShift", () => {
  it("is null until this match's result for the player is in", () => {
    const results = [...record("a", 3, 5)];
    expect(rankShift(results, "new-match", "a", "spades")).toBeNull();
  });

  it("shows a climb when a win lifts the player's win rate past someone", () => {
    // before: b 4/6 (66.7%) #1, a 5/8 (62.5%) #2
    const results = [...record("b", 4, 6), ...record("a", 5, 8), r("a", "win", "m-final"), r("a", "win", "m-final2")];
    // a after the first win: 6/9 = 66.7% ties b on rate, wins 6 > 4 → a #1
    const before = results.filter((x) => x.matchId !== "m-final2");
    const shift = rankShift(before, "m-final", "a", "spades")!;
    expect(shift.before).toBe(2);
    expect(shift.after).toBe(1);
    expect(shift.moved).toBe(1);
    expect(rankShiftLine(shift)).toBe("Up 1 place, from #2 to #1.");
  });

  it("shows a drop after a loss", () => {
    const results = [...record("a", 5, 6), ...record("b", 4, 6), r("a", "loss", "m-x"), r("a", "loss", "m-y")];
    const shift = rankShift(results, "m-y", "a", "spades")!;
    // before m-y: a 5/7 = 71%, b 66.7% → a #1. after: a 5/8 = 62.5% → a #2.
    expect(shift.before).toBe(1);
    expect(shift.after).toBe(2);
    expect(shift.moved).toBe(-1);
    expect(rankShiftLine(shift)).toMatch(/^Down 1 place/);
  });

  it("marks a first game as new and provisional", () => {
    const results = [...record("b", 4, 6), r("a", "win", "first")];
    const shift = rankShift(results, "first", "a", "spades")!;
    expect(shift.before).toBeNull();
    expect(shift.provisional).toBe(true);
    expect(shift.toQualify).toBe(4);
    // b is qualified, so a sits below even at 100%.
    expect(shift.after).toBe(2);
    expect(rankShiftLine(shift)).toBe("New on the board at #2 of 2.");
  });

  it("only counts the game being played", () => {
    const results = [...record("a", 5, 6), r("a", "win", "chess-1", "chess"), r("a", "win", "sp", "spades")];
    const shift = rankShift(results, "sp", "a", "spades")!;
    expect(shift.standing.played).toBe(7);
  });
});
