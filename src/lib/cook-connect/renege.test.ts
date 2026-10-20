import { describe, it, expect } from "vitest";
import {
  BOT_NOTICE_CHANCE, accusableSeats, botNotices, callHeadline, canAccuse, canPlay, checkPlay,
  completeEvidence, evidenceLine, recordPlay, resolveCall, seededRoll, type RenegeRecord,
} from "./renege";
import { chooseCard } from "./spadesBot";
import { initGameState, isValidPlay, type TrickPlay } from "./spades";

const trick = (...plays: [number, string][]): TrickPlay[] => plays.map(([seat, card]) => ({ seat, card }));
const names = ["Alex", "Sam", "Jay", "Kim"];
const nameOf = (seat: number) => names[seat];

/** Sam (seat 1) plays a club on a heart lead while holding a heart. */
function samReneges(): RenegeRecord[] {
  return recordPlay([], {
    seat: 1, userId: "sam", round: 2, trickNumber: 5, card: "4C",
    hand: ["4C", "9H", "KD"], trick: trick([0, "AH"]), spadeBroken: false,
  });
}

describe("which cards are legal", () => {
  it("is the normal rule by default", () => {
    const hand = ["4C", "9H"];
    expect(canPlay("4C", hand, trick([0, "AH"]), false, false)).toBe(false);
    expect(canPlay("9H", hand, trick([0, "AH"]), false, false)).toBe(true);
  });

  it("lets any card in the hand through once unlocked", () => {
    const hand = ["4C", "9H", "2S"];
    expect(canPlay("4C", hand, trick([0, "AH"]), false, true)).toBe(true);
    expect(canPlay("2S", hand, [], false, true)).toBe(true);
  });

  it("never plays a card you don't hold, unlocked or not", () => {
    expect(canPlay("AS", ["4C"], [], true, true)).toBe(false);
  });

  it("says what kind of renig a play would be", () => {
    expect(checkPlay("4C", ["4C", "9H"], trick([0, "AH"]), false)).toEqual({ legal: false, kind: "suit", ledSuit: "H" });
    expect(checkPlay("2S", ["2S", "9H"], [], false)).toEqual({ legal: false, kind: "spades", ledSuit: null });
    expect(checkPlay("4C", ["4C", "2S"], trick([0, "AH"]), false).legal).toBe(true); // void in hearts
  });
});

describe("recording a renig", () => {
  it("writes down who, when, what card, what was led, and that they held it", () => {
    const [r] = samReneges();
    expect(r).toMatchObject({
      seat: 1, userId: "sam", round: 2, trickNumber: 5, card: "4C",
      ledSuit: "H", kind: "suit", heldLedSuit: true,
    });
    expect(r.trick).toEqual(trick([0, "AH"], [1, "4C"]));
  });

  it("writes nothing for a legal play", () => {
    const before = samReneges();
    const after = recordPlay(before, {
      seat: 2, userId: "jay", round: 2, trickNumber: 5, card: "2H",
      hand: ["2H", "3C"], trick: trick([0, "AH"], [1, "4C"]), spadeBroken: false,
    });
    expect(after).toBe(before);
  });

  it("records a spade lead before spades are broken", () => {
    const [r] = recordPlay(undefined, {
      seat: 3, userId: "kim", round: 1, trickNumber: 1, card: "AS",
      hand: ["AS", "2H"], trick: [], spadeBroken: false,
    });
    expect(r.kind).toBe("spades");
    expect(r.ledSuit).toBeNull();
  });

  it("keeps the finished trick as evidence", () => {
    const full = trick([0, "AH"], [1, "4C"], [2, "2H"], [3, "5H"]);
    const [r] = completeEvidence(samReneges(), 2, 5, full);
    expect(r.trick).toEqual(full);
    // A different trick is left alone.
    expect(completeEvidence(samReneges(), 2, 6, full)[0].trick).toHaveLength(2);
  });
});

describe("calling renig", () => {
  it("only on the other team", () => {
    expect(canAccuse(0, 1)).toBe(true);
    expect(canAccuse(0, 2)).toBe(false);
    expect(canAccuse(0, 0)).toBe(false);
    expect(accusableSeats(0)).toEqual([1, 3]);
    expect(accusableSeats(3)).toEqual([0, 2]);
  });

  it("a right call: the renig team loses, the caller's team wins", () => {
    const call = resolveCall(samReneges(), { seat: 0, userId: "alex" }, { seat: 1, userId: "sam" }, { at: 1 });
    expect(call.correct).toBe(true);
    expect(call.winningTeam).toBe(1);
    expect(call.evidence?.card).toBe("4C");
    expect(callHeadline(call, nameOf)).toBe("Sam reneged — caught by Alex. Alex's team wins.");
  });

  it("a wrong call: the caller's team loses", () => {
    const call = resolveCall(samReneges(), { seat: 0, userId: "alex" }, { seat: 3, userId: "kim" });
    expect(call.correct).toBe(false);
    expect(call.winningTeam).toBe(2);
    expect(call.evidence).toBeNull();
    expect(callHeadline(call, nameOf)).toBe("Wrong call — Kim didn't renig. Alex's team loses.");
  });

  it("a renig from an earlier hand of the same game still counts", () => {
    const call = resolveCall(samReneges(), { seat: 2, userId: "jay" }, { seat: 1, userId: "sam" });
    expect(call.correct).toBe(true);
    expect(call.winningTeam).toBe(1);
  });

  it("nothing on record means every call is wrong", () => {
    const call = resolveCall(undefined, { seat: 1, userId: "sam" }, { seat: 0, userId: "alex" });
    expect(call.correct).toBe(false);
    expect(call.winningTeam).toBe(1);
  });

  it("describes the evidence in plain words", () => {
    const line = evidenceLine(samReneges()[0], nameOf, (c) => c);
    expect(line).toBe("Hearts were led and Sam played the 4C while still holding a heart (round 2, trick 5).");
    const spade = recordPlay([], {
      seat: 3, userId: "kim", round: 1, trickNumber: 1, card: "AS", hand: ["AS", "2H"], trick: [], spadeBroken: false,
    })[0];
    expect(evidenceLine(spade, nameOf, (c) => c)).toMatch(/led the AS before spades were broken/);
  });
});

describe("computer players", () => {
  it("never renig", () => {
    for (let i = 0; i < 200; i++) {
      const state = initGameState(i % 4);
      state.phase = "playing";
      // Play a whole hand with the computer at every seat.
      for (let t = 0; t < 52; t++) {
        const seat = state.currentTurn;
        const card = chooseCard(state, seat);
        expect(isValidPlay(card, state.hands[seat], state.currentTrick, state.spadeBroken)).toBe(true);
        state.hands[seat] = state.hands[seat].filter((c) => c !== card);
        state.currentTrick = [...state.currentTrick, { seat, card }];
        if (card.endsWith("S")) state.spadeBroken = true;
        if (state.currentTrick.length === 4) { state.currentTrick = []; state.currentTurn = seat; }
        state.currentTurn = (state.currentTurn + 1) % 4;
      }
    }
  });

  it("call out a renig when the roll comes in under the chance", () => {
    const hit = botNotices(samReneges(), [2, 3], "k", BOT_NOTICE_CHANCE, () => 0.1);
    // Seat 1 reneged; seat 2 is the only computer on the other team.
    expect(hit).toEqual({ accuserSeat: 2, accusedSeat: 1, record: samReneges()[0] });
  });

  it("stay quiet when the roll misses", () => {
    expect(botNotices(samReneges(), [2, 3], "k", BOT_NOTICE_CHANCE, () => 0.9)).toBeNull();
  });

  it("never call it on their own partner", () => {
    // Seat 3 is Sam's partner; no other computer.
    expect(botNotices(samReneges(), [3], "k", 1, () => 0)).toBeNull();
  });

  it("leave alone a seat a computer has since taken over", () => {
    expect(botNotices(samReneges(), [1, 2], "k", 1, () => 0)).toBeNull();
  });

  it("never call it when nobody reneged", () => {
    expect(botNotices([], [0, 1, 2, 3], "k", 1, () => 0)).toBeNull();
    expect(botNotices(undefined, [2], "k", 1, () => 0)).toBeNull();
  });

  it("roll the same on every browser, about a quarter of the time", () => {
    expect(seededRoll("match-1:r1:t3")).toBe(seededRoll("match-1:r1:t3"));
    let hits = 0;
    for (let i = 0; i < 4000; i++) if (seededRoll(`m:${i}`) < BOT_NOTICE_CHANCE) hits++;
    expect(hits / 4000).toBeGreaterThan(0.2);
    expect(hits / 4000).toBeLessThan(0.3);
    for (let i = 0; i < 100; i++) {
      const r = seededRoll(`x${i}`);
      expect(r).toBeGreaterThanOrEqual(0);
      expect(r).toBeLessThan(1);
    }
  });
});
