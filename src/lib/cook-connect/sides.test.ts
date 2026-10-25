import { describe, expect, it } from "vitest";
import {
  FEED_KINDS, GAMES, HOME_PAGE, gameBoard, landingSide, otherSide, parseSide, sideOfPage, topCooks,
} from "./sides";
import type { PlayerRecord } from "./stats";

const rec = (
  userId: string,
  spades: [number, number],
  chess: [number, number],
  streak = 0,
): PlayerRecord => {
  const played = spades[0] + chess[0];
  const wins = spades[1] + chess[1];
  return {
    userId, played, wins, losses: played - wins, draws: 0,
    winRate: played ? wins / played : 0, streak, qualified: played >= 5,
    byGame: { spades: { played: spades[0], wins: spades[1] }, chess: { played: chess[0], wins: chess[1] } },
  };
};

describe("sides", () => {
  it("puts every cooking screen on Cookbook and every game screen on Connect", () => {
    for (const p of ["cookbooks", "cookbook", "recipe", "new-recipe", "new-cookbook", "shared", "journal", "group"]) {
      expect(sideOfPage(p)).toBe("cookbook");
    }
    for (const p of ["play", "spades", "chess"]) expect(sideOfPage(p)).toBe("connect");
  });

  it("keeps shared screens (explore, profile, boards) on whichever side you are on", () => {
    for (const p of ["explore", "profile", "leaderboards"]) {
      expect(sideOfPage(p)).toBeNull();
      expect(landingSide(p, "connect")).toBe("connect");
      expect(landingSide(p, "cookbook")).toBe("cookbook");
    }
    expect(landingSide("spades", "cookbook")).toBe("connect");
  });

  it("has a home per side and flips", () => {
    expect(HOME_PAGE.cookbook).toBe("cookbooks");
    expect(HOME_PAGE.connect).toBe("play");
    expect(otherSide("cookbook")).toBe("connect");
    expect(otherSide("connect")).toBe("cookbook");
  });

  it("reads a remembered side and ignores junk", () => {
    expect(parseSide("connect")).toBe("connect");
    expect(parseSide("nope")).toBe("cookbook");
    expect(parseSide(null, "connect")).toBe("connect");
  });

  it("splits the feed but shares follows", () => {
    expect(FEED_KINDS.connect).toContain("match_won");
    expect(FEED_KINDS.cookbook).not.toContain("match_won");
    expect(FEED_KINDS.cookbook).toContain("followed");
    expect(FEED_KINDS.connect).toContain("followed");
  });

  it("lists spades and chess as games", () => {
    expect(GAMES.map((g) => g.id)).toEqual(["spades", "chess"]);
  });
});

describe("gameBoard", () => {
  const records = [
    rec("ann", [10, 8], [0, 0]),
    rec("bo", [2, 2], [10, 9]),
    rec("cy", [6, 3], [6, 1]),
  ];

  it("ranks a game on that game alone and leaves out people who never played it", () => {
    const chess = gameBoard(records, "chess");
    expect(chess.map((r) => r.userId)).toEqual(["bo", "cy"]);
    expect(chess[0]).toMatchObject({ played: 10, wins: 9, losses: 1, qualified: true });
  });

  it("marks a short run provisional and ranks it below every qualified player", () => {
    const spades = gameBoard(records, "spades");
    // bo is 2–0 in spades (100%) but under 5 games, so ann and cy rank first.
    expect(spades.map((r) => r.userId)).toEqual(["ann", "cy", "bo"]);
    expect(spades[2].qualified).toBe(false);
  });

  it("uses the overall record for all games", () => {
    const all = gameBoard(records, "all");
    expect(all[0].userId).toBe("bo");
    expect(all).toHaveLength(3);
  });
});

describe("topCooks", () => {
  it("adds up saves across a cook's cookbooks", () => {
    const rows = topCooks([
      { cookbookId: "1", title: "A", ownerId: "ann", saves: 3, recipes: 4 },
      { cookbookId: "2", title: "B", ownerId: "bo", saves: 5, recipes: 2 },
      { cookbookId: "3", title: "C", ownerId: "ann", saves: 4, recipes: 1 },
    ]);
    expect(rows).toEqual([
      { ownerId: "ann", saves: 7, cookbooks: 2, recipes: 5 },
      { ownerId: "bo", saves: 5, cookbooks: 1, recipes: 2 },
    ]);
  });
});
