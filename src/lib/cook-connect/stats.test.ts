import { describe, it, expect } from "vitest";
import {
  buildRecords, leaderboard, rankCookbooks, formatStreak, formatWinRate,
  QUALIFYING_GAMES, type MatchResult,
} from "./stats";

const at = (n: number) => new Date(2026, 0, n).toISOString();

const run = (userId: string, results: MatchResult["result"][], game: MatchResult["game"] = "spades") =>
  results.map((result, i) => ({ userId, result, game, finishedAt: at(i + 1) }));

describe("buildRecords", () => {
  it("counts wins, losses and draws", () => {
    const [rec] = buildRecords(run("a", ["win", "loss", "win", "draw"]));
    expect(rec.played).toBe(4);
    expect(rec.wins).toBe(2);
    expect(rec.losses).toBe(1);
    expect(rec.draws).toBe(1);
  });

  it("scores a draw as half a win", () => {
    const [rec] = buildRecords(run("a", ["win", "draw"]));
    expect(rec.winRate).toBe(0.75);
  });

  it("counts a winning streak from the most recent result backwards", () => {
    const [rec] = buildRecords(run("a", ["loss", "win", "win", "win"]));
    expect(rec.streak).toBe(3);
  });

  it("reports a losing streak as a negative number", () => {
    const [rec] = buildRecords(run("a", ["win", "loss", "loss"]));
    expect(rec.streak).toBe(-2);
  });

  it("breaks the streak on a draw", () => {
    const [rec] = buildRecords(run("a", ["win", "win", "draw"]));
    expect(rec.streak).toBe(0);
  });

  it("reads the streak from newest, whatever order the rows arrive in", () => {
    const shuffled = [...run("a", ["loss", "win", "win"])].reverse();
    expect(buildRecords(shuffled)[0].streak).toBe(2);
  });

  it("splits the record per game", () => {
    const [rec] = buildRecords([...run("a", ["win", "loss"], "spades"), ...run("a", ["win"], "chess")]);
    expect(rec.byGame.spades).toEqual({ played: 2, wins: 1 });
    expect(rec.byGame.chess).toEqual({ played: 1, wins: 1 });
  });

  it("marks a player provisional until the qualifying game count", () => {
    const short = buildRecords(run("a", Array(QUALIFYING_GAMES - 1).fill("win")))[0];
    const long = buildRecords(run("b", Array(QUALIFYING_GAMES).fill("win")))[0];
    expect(short.qualified).toBe(false);
    expect(long.qualified).toBe(true);
  });
});

describe("leaderboard", () => {
  it("keeps a perfect provisional record below every qualified player", () => {
    // The case the qualifier exists for: 3-0 must not beat 40-25.
    const perfect = run("newcomer", ["win", "win", "win"]);
    const veteran = run("veteran", [...Array(40).fill("win"), ...Array(25).fill("loss")]);
    const [first, second] = leaderboard([...perfect, ...veteran]);
    expect(first.userId).toBe("veteran");
    expect(second.userId).toBe("newcomer");
    expect(second.qualified).toBe(false);
  });

  it("ranks qualified players by win rate", () => {
    const a = run("a", ["win", "win", "win", "win", "loss"]); // 80%
    const b = run("b", ["win", "win", "win", "loss", "loss"]); // 60%
    expect(leaderboard([...a, ...b]).map((r) => r.userId)).toEqual(["a", "b"]);
  });

  it("uses total wins to break an equal win rate", () => {
    const a = run("a", ["win", "win", "win", "loss", "loss", "loss"]); // 50%, 3 wins
    const b = run("b", ["win", "win", "win", "win", "loss", "loss", "loss", "loss"]); // 50%, 4 wins
    expect(leaderboard([...a, ...b])[0].userId).toBe("b");
  });

  it("is stable when two players are identical", () => {
    const rows = [...run("zoe", ["win", "loss"]), ...run("abe", ["win", "loss"])];
    expect(leaderboard(rows).map((r) => r.userId)).toEqual(["abe", "zoe"]);
  });

  it("returns nothing for nobody", () => {
    expect(leaderboard([])).toEqual([]);
  });
});

describe("rankCookbooks", () => {
  const cb = (cookbookId: string, saves: number, recipes: number, title = cookbookId) =>
    ({ cookbookId, title, ownerId: "o", saves, recipes });

  it("ranks by saves", () => {
    const ranked = rankCookbooks([cb("a", 2, 9), cb("b", 7, 1)]);
    expect(ranked.map((r) => r.cookbookId)).toEqual(["b", "a"]);
  });

  it("breaks a tie on the deeper cookbook", () => {
    const ranked = rankCookbooks([cb("thin", 4, 2), cb("deep", 4, 20)]);
    expect(ranked[0].cookbookId).toBe("deep");
  });

  it("falls back to title so the order never wobbles", () => {
    const ranked = rankCookbooks([cb("x", 1, 1, "Zucchini"), cb("y", 1, 1, "Apples")]);
    expect(ranked.map((r) => r.title)).toEqual(["Apples", "Zucchini"]);
  });
});

describe("formatting", () => {
  it("shows a win rate as a whole percentage", () => {
    expect(formatWinRate(0.6237)).toBe("62%");
    expect(formatWinRate(0)).toBe("0%");
  });

  it("labels streaks", () => {
    expect(formatStreak(3)).toBe("W3");
    expect(formatStreak(-2)).toBe("L2");
    expect(formatStreak(0)).toBe("—");
  });
});
