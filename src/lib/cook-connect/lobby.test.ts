import { describe, it, expect } from "vitest";
import {
  AWAY_AFTER_MS, CLAIM_STALE_MS, FRESH_TABLE_MS,
  awayUsers, castVote, countedVotes, emptyLobby, isClaimFresh, joinNames, lobbyView,
  partnerSeat, pickBotPartner, planBotSeats, seatResults, stageExplainer, stageFor,
  tablesToJoin, waitingLine, withdrawVote, type LobbySeat, type TableSummary,
} from "./lobby";
import { getTeam } from "./spades";

const seat = (userId: string, s: number): LobbySeat => ({ userId, seat: s });
/** A fixed "random" so tests are repeatable. */
const pick = (n: number) => () => n;

describe("stages", () => {
  it("names each headcount", () => {
    expect(stageFor(0)).toBe("empty");
    expect(stageFor(1)).toBe("alone");
    expect(stageFor(2)).toBe("pair");
    expect(stageFor(3)).toBe("trio");
    expect(stageFor(4)).toBe("full");
  });

  it("explains each stage in plain words", () => {
    expect(stageExplainer("alone")).toMatch(/computer partner/);
    expect(stageExplainer("pair")).toMatch(/opposite teams/);
    expect(stageExplainer("trio")).toMatch(/changes every game/);
  });
});

describe("votes", () => {
  const two = [seat("a", 0), seat("b", 1)];

  it("counts a vote cast at the current headcount", () => {
    const lobby = castVote(emptyLobby(), "a", 2);
    expect(countedVotes(lobby, two)).toEqual(["a"]);
  });

  it("drops a vote once somebody else sits down", () => {
    const lobby = castVote(emptyLobby(), "a", 2);
    expect(countedVotes(lobby, [...two, seat("c", 2)])).toEqual([]);
  });

  it("drops the vote of someone who left", () => {
    const lobby = castVote(castVote(emptyLobby(), "a", 2), "b", 2);
    expect(countedVotes(lobby, [seat("a", 0)])).toEqual([]);
  });

  it("replaces rather than duplicates a repeat vote", () => {
    const lobby = castVote(castVote(emptyLobby(), "a", 1), "a", 2);
    expect(lobby.votes).toEqual([{ userId: "a", humans: 2 }]);
  });

  it("takes a vote back", () => {
    const lobby = withdrawVote(castVote(emptyLobby(), "a", 2), "a");
    expect(lobby.votes).toEqual([]);
  });

  it("copes with no lobby at all", () => {
    expect(countedVotes(undefined, two)).toEqual([]);
    expect(castVote(null, "a", 1).votes).toHaveLength(1);
    expect(withdrawVote(undefined, "a").votes).toEqual([]);
  });
});

describe("the lobby view", () => {
  it("one person who agrees starts at once", () => {
    const v = lobbyView({ humans: [seat("a", 0)], lobby: castVote(null, "a", 1), me: "a" });
    expect(v.stage).toBe("alone");
    expect(v.botCount).toBe(3);
    expect(v.everyoneAgreed).toBe(true);
    expect(v.iAgreed).toBe(true);
  });

  it("two people both have to agree", () => {
    const humans = [seat("a", 0), seat("b", 1)];
    const half = lobbyView({ humans, lobby: castVote(null, "a", 2), me: "b" });
    expect(half.everyoneAgreed).toBe(false);
    expect(half.waitingOn).toEqual(["b"]);
    expect(half.agreed).toEqual(["a"]);
    expect(half.iAgreed).toBe(false);

    const both = lobbyView({ humans, lobby: castVote(castVote(null, "a", 2), "b", 2), me: "b" });
    expect(both.everyoneAgreed).toBe(true);
    expect(both.botCount).toBe(2);
  });

  it("three people all have to agree", () => {
    const humans = [seat("a", 0), seat("b", 1), seat("c", 2)];
    let lobby = castVote(castVote(null, "a", 3), "b", 3);
    expect(lobbyView({ humans, lobby, me: "a" }).waitingOn).toEqual(["c"]);
    lobby = castVote(lobby, "c", 3);
    const v = lobbyView({ humans, lobby, me: "a" });
    expect(v.everyoneAgreed).toBe(true);
    expect(v.botCount).toBe(1);
  });

  it("a fourth person means no vote is needed and no computer plays", () => {
    const humans = [seat("a", 0), seat("b", 1), seat("c", 2), seat("d", 3)];
    const v = lobbyView({ humans, lobby: castVote(null, "a", 3), me: "a" });
    expect(v.stage).toBe("full");
    expect(v.botCount).toBe(0);
    expect(v.everyoneAgreed).toBe(false);
  });

  it("someone who stepped away does not hold the table up", () => {
    const humans = [seat("a", 0), seat("b", 1)];
    const v = lobbyView({ humans, lobby: castVote(null, "a", 2), away: ["b"], me: "a" });
    expect(v.required).toEqual(["a"]);
    expect(v.away).toEqual(["b"]);
    expect(v.everyoneAgreed).toBe(true);
  });

  it("nobody seated is never 'everyone agreed'", () => {
    expect(lobbyView({ humans: [], lobby: null, me: null }).everyoneAgreed).toBe(false);
  });
});

describe("who is away", () => {
  const humans = [seat("me", 0), seat("b", 1), seat("c", 2)];

  it("is never me, and never someone connected now", () => {
    const now = 100_000;
    expect(awayUsers(humans, new Set(["b"]), {}, 0, now, "me")).toEqual(["c"]);
  });

  it("gives a grace period after the table opens", () => {
    const opened = 50_000;
    expect(awayUsers(humans, new Set(), {}, opened, opened + AWAY_AFTER_MS - 1, "me")).toEqual([]);
    expect(awayUsers(humans, new Set(), {}, opened, opened + AWAY_AFTER_MS + 1, "me")).toEqual(["b", "c"]);
  });

  it("counts from when they were last seen", () => {
    const now = 100_000;
    const seen = { b: now - 1000, c: now - AWAY_AFTER_MS - 1 };
    expect(awayUsers(humans, new Set(), seen, 0, now, "me")).toEqual(["c"]);
  });
});

describe("start claims", () => {
  it("expires", () => {
    expect(isClaimFresh({ by: "a", at: 1000 }, 1000 + CLAIM_STALE_MS - 1)).toBe(true);
    expect(isClaimFresh({ by: "a", at: 1000 }, 1000 + CLAIM_STALE_MS)).toBe(false);
    expect(isClaimFresh(null, 0)).toBe(false);
  });
});

describe("seating with computer players", () => {
  it("one person keeps their seat; the computer takes the other three", () => {
    const plan = planBotSeats([seat("a", 0)]);
    expect(plan.seats).toEqual({ a: 0 });
    expect(plan.botSeats).toEqual([1, 2, 3]);
    expect(plan.moved).toEqual([]);
    // Their partner is a computer, and so are both opponents.
    expect(plan.botSeats).toContain(partnerSeat(0));
  });

  it("two people already on opposite teams stay put", () => {
    const plan = planBotSeats([seat("a", 0), seat("b", 1)]);
    expect(plan.seats).toEqual({ a: 0, b: 1 });
    expect(plan.botSeats).toEqual([2, 3]);
    expect(plan.moved).toEqual([]);
  });

  it("two people who would be partners are split onto opposite teams", () => {
    for (const [sa, sb] of [[0, 2], [1, 3], [2, 0], [3, 1]]) {
      const plan = planBotSeats([seat("a", sa), seat("b", sb)]);
      expect(getTeam(plan.seats.a)).not.toBe(getTeam(plan.seats.b));
      expect(plan.moved).toHaveLength(1);
      // Each person's partner is a computer.
      expect(plan.botSeats).toContain(partnerSeat(plan.seats.a));
      expect(plan.botSeats).toContain(partnerSeat(plan.seats.b));
      expect(new Set([...Object.values(plan.seats), ...plan.botSeats]).size).toBe(4);
    }
  });

  it("three people: the computer sits across from whoever is picked", () => {
    const humans = [seat("a", 0), seat("b", 1), seat("c", 2)];
    for (const r of [0, 0.5, 0.99]) {
      const plan = planBotSeats(humans, [], pick(r));
      expect(plan.botSeats).toHaveLength(1);
      expect(plan.botPartner).not.toBeNull();
      expect(plan.botSeats[0]).toBe(partnerSeat(plan.seats[plan.botPartner!]));
      expect(new Set([...Object.values(plan.seats), ...plan.botSeats]).size).toBe(4);
      expect(plan.moved.length).toBeLessThanOrEqual(1);
    }
  });

  it("three people: the other two partner each other", () => {
    const plan = planBotSeats([seat("a", 0), seat("b", 1), seat("c", 2)], ["a"], pick(0));
    const others = ["a", "b", "c"].filter((id) => id !== plan.botPartner);
    expect(getTeam(plan.seats[others[0]])).toBe(getTeam(plan.seats[others[1]]));
    expect(getTeam(plan.seats[plan.botPartner!])).not.toBe(getTeam(plan.seats[others[0]]));
  });

  it("four people: no computer", () => {
    const plan = planBotSeats([seat("a", 0), seat("b", 1), seat("c", 2), seat("d", 3)]);
    expect(plan.botSeats).toEqual([]);
    expect(plan.moved).toEqual([]);
  });

  it("repairs a doubled-up or out-of-range seat", () => {
    const plan = planBotSeats([seat("a", 0), seat("b", 0), seat("c", 9)]);
    const used = Object.values(plan.seats);
    expect(new Set(used).size).toBe(3);
    expect(used.every((s) => s >= 0 && s <= 3)).toBe(true);
  });
});

describe("rotating the computer's partner", () => {
  const ids = ["a", "b", "c"];

  it("never gives it to the same person twice in a row", () => {
    for (const r of [0, 0.3, 0.6, 0.99]) {
      expect(pickBotPartner(ids, ["b"], pick(r))).not.toBe("b");
    }
  });

  it("favours whoever has had it least", () => {
    // a twice, b once, last was b: only c has never had it.
    expect(pickBotPartner(ids, ["a", "b", "a", "b"], pick(0.99))).toBe("c");
  });

  it("is random among equals", () => {
    const seen = new Set([0, 0.4, 0.8].map((r) => pickBotPartner(ids, [], pick(r))));
    expect(seen.size).toBe(3);
  });

  it("over many games, everyone gets a turn and nobody gets two in a row", () => {
    const history: string[] = [];
    for (let i = 0; i < 30; i++) {
      const next = pickBotPartner(ids, history)!;
      if (history.length) expect(next).not.toBe(history[history.length - 1]);
      history.push(next);
    }
    for (const id of ids) expect(history.filter((h) => h === id).length).toBe(10);
  });

  it("still picks someone when only one person is left", () => {
    expect(pickBotPartner(["a"], ["a"])).toBe("a");
    expect(pickBotPartner([], [])).toBeNull();
  });

  it("each new game's plan moves the computer to the new partner", () => {
    let humans = [seat("a", 0), seat("b", 1), seat("c", 2)];
    const history: string[] = [];
    for (let game = 0; game < 6; game++) {
      const plan = planBotSeats(humans, history);
      if (history.length) expect(plan.botPartner).not.toBe(history[history.length - 1]);
      history.push(plan.botPartner!);
      expect(plan.botSeats[0]).toBe(partnerSeat(plan.seats[plan.botPartner!]));
      humans = Object.entries(plan.seats).map(([userId, s]) => ({ userId, seat: s }));
    }
  });
});

describe("matchmaking", () => {
  const now = Date.parse("2026-10-19T12:00:00Z");
  const table = (over: Partial<TableSummary>): TableSummary => ({
    id: "t", game: "spades", status: "pending", isPublic: true,
    createdAt: "2026-10-19T11:58:00Z", updatedAt: "2026-10-19T11:59:30Z",
    humanIds: ["x"], seatsFree: 3, ...over,
  });

  it("picks the fullest live table first, then the longest waiting", () => {
    const order = tablesToJoin([
      table({ id: "one", humanIds: ["x"], seatsFree: 3, createdAt: "2026-10-19T11:50:00Z" }),
      table({ id: "two", humanIds: ["y", "z"], seatsFree: 2 }),
      table({ id: "older-one", humanIds: ["w"], seatsFree: 3, createdAt: "2026-10-19T11:40:00Z" }),
    ], "me", now);
    expect(order).toEqual(["two", "older-one", "one"]);
  });

  it("skips chess, private, full, empty, stale and my own tables", () => {
    const order = tablesToJoin([
      table({ id: "chess", game: "chess" }),
      table({ id: "private", isPublic: false }),
      table({ id: "full", seatsFree: 0 }),
      table({ id: "empty", humanIds: [] }),
      table({ id: "stale", updatedAt: new Date(now - FRESH_TABLE_MS - 1).toISOString() }),
      table({ id: "mine", humanIds: ["me"] }),
      table({ id: "live", status: "live" }),
      table({ id: "ok" }),
    ], "me", now);
    expect(order).toEqual(["ok"]);
  });
});

describe("words", () => {
  it("joins names the way people say them", () => {
    expect(joinNames([])).toBe("");
    expect(joinNames(["Sam"])).toBe("Sam");
    expect(joinNames(["Sam", "Jo"])).toBe("Sam and Jo");
    expect(joinNames(["Sam", "Jo", "Al"])).toBe("Sam, Jo and Al");
  });

  it("says who we are waiting on", () => {
    expect(waitingLine(["Sam"])).toBe("Waiting for Sam to agree…");
    expect(waitingLine([])).toBe("");
  });
});

describe("results with computer players", () => {
  it("marks computer seats so the leaderboard skips them, and scores the people", () => {
    const rows = seatResults([
      { userId: "a", isBot: false, team: 1 },
      { userId: "bot:1", isBot: true, team: 2 },
      { userId: "b", isBot: false, team: 2 },
      { userId: "bot:2", isBot: true, team: 1 },
      { userId: "", isBot: false, team: 1 },
    ], 1);
    expect(rows).toEqual([
      { userId: "a", isBot: false, result: "win" },
      { userId: "bot:1", isBot: true, result: "loss" },
      { userId: "b", isBot: false, result: "loss" },
      { userId: "bot:2", isBot: true, result: "win" },
    ]);
  });
});
