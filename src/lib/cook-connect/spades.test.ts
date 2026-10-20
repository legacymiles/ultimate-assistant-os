import { describe, it, expect } from "vitest";
import {
  createDeck, dealCards, initGameState, isValidPlay, determineTrickWinner,
  calculateRoundScore, applyRoundScore, sortHand, getTeam, nextSeat,
  WINNING_SCORE, type TrickPlay,
  recapRound, trumpSteal,
} from "./spades";
import { chooseBid, chooseCard } from "./spadesBot";
import { botNotices, canPlay, checkPlay, recordPlay, resolveCall } from "./renege";

const trick = (...plays: [number, string][]): TrickPlay[] =>
  plays.map(([seat, card]) => ({ seat, card }));

describe("the deck", () => {
  it("has 52 distinct cards", () => {
    const deck = createDeck();
    expect(deck).toHaveLength(52);
    expect(new Set(deck).size).toBe(52);
  });

  it("deals four hands of 13 with nothing repeated", () => {
    const hands = dealCards();
    expect(Object.values(hands).every((h) => h.length === 13)).toBe(true);
    expect(new Set(Object.values(hands).flat()).size).toBe(52);
  });

  it("sorts a hand by suit then rank", () => {
    expect(sortHand(["AH", "2S", "KS", "3H"])).toEqual(["2S", "KS", "3H", "AH"]);
  });
});

describe("the deal", () => {
  it("starts bidding to the dealer's left", () => {
    const state = initGameState(2);
    expect(state.currentTurn).toBe(3);
    expect(state.phase).toBe("bidding");
    expect(state.spadeBroken).toBe(false);
  });

  it("wraps past the last seat", () => {
    expect(initGameState(3).currentTurn).toBe(0);
    expect(nextSeat(3)).toBe(0);
  });

  it("seats partners across the table", () => {
    expect(getTeam(0)).toBe(getTeam(2));
    expect(getTeam(1)).toBe(getTeam(3));
    expect(getTeam(0)).not.toBe(getTeam(1));
  });
});

describe("legal plays", () => {
  const hand = ["2H", "AH", "3S", "4C"];

  it("lets you lead anything but a spade before spades are broken", () => {
    expect(isValidPlay("2H", hand, [], false)).toBe(true);
    expect(isValidPlay("3S", hand, [], false)).toBe(false);
  });

  it("lets you lead a spade once they are broken", () => {
    expect(isValidPlay("3S", hand, [], true)).toBe(true);
  });

  it("lets you lead a spade when spades are all you hold", () => {
    expect(isValidPlay("3S", ["3S", "KS"], [], false)).toBe(true);
  });

  it("makes you follow the led suit", () => {
    const led = trick([0, "5H"]);
    expect(isValidPlay("AH", hand, led, false)).toBe(true);
    expect(isValidPlay("4C", hand, led, false)).toBe(false);
  });

  it("frees you to play anything when you are void in the led suit", () => {
    const led = trick([0, "5D"]);
    expect(isValidPlay("4C", hand, led, false)).toBe(true);
    expect(isValidPlay("3S", hand, led, false)).toBe(true);
  });
});

describe("who takes the trick", () => {
  it("gives it to the highest card of the led suit", () => {
    expect(determineTrickWinner(trick([0, "5H"], [1, "KH"], [2, "3H"], [3, "9H"]))).toBe(1);
  });

  it("lets any spade beat the led suit", () => {
    expect(determineTrickWinner(trick([0, "AH"], [1, "2S"], [2, "KH"], [3, "QH"]))).toBe(1);
  });

  it("gives it to the highest spade when several are trumped in", () => {
    expect(determineTrickWinner(trick([0, "AH"], [1, "2S"], [2, "TS"], [3, "KH"]))).toBe(2);
  });

  it("ignores off-suit cards that are not spades", () => {
    expect(determineTrickWinner(trick([0, "5H"], [1, "AD"], [2, "AC"], [3, "6H"]))).toBe(3);
  });
});

describe("scoring a round", () => {
  it("pays ten a trick for a made contract", () => {
    const score = calculateRoundScore({ 0: 3, 1: 3, 2: 2, 3: 2 }, { 0: 3, 1: 3, 2: 2, 3: 2 });
    expect(score.team1Score).toBe(50);
    expect(score.team1Bags).toBe(0);
  });

  it("adds a point a bag for overtricks", () => {
    const score = calculateRoundScore({ 0: 2, 1: 3, 2: 2, 3: 2 }, { 0: 4, 1: 3, 2: 2, 3: 2 });
    expect(score.team1Bags).toBe(2);
    expect(score.team1Score).toBe(42);
  });

  it("takes the whole contract away when a team is set", () => {
    const score = calculateRoundScore({ 0: 4, 1: 3, 2: 3, 3: 2 }, { 0: 2, 1: 4, 2: 2, 3: 3 });
    expect(score.team1Score).toBe(-70);
  });

  it("pays a hundred for a made nil", () => {
    const score = calculateRoundScore({ 0: 0, 1: 3, 2: 4, 3: 2 }, { 0: 0, 1: 3, 2: 4, 3: 2 });
    expect(score.team1Score).toBe(140); // 100 nil + 40 contract
  });

  it("costs a hundred for a broken nil, and the tricks it took become bags", () => {
    const score = calculateRoundScore({ 0: 0, 1: 3, 2: 4, 3: 2 }, { 0: 2, 1: 3, 2: 4, 3: 2 });
    expect(score.team1Score).toBe(-58); // -100 nil + 40 contract + 2 bags
    expect(score.team1Bags).toBe(2);
  });
});

describe("running totals", () => {
  const totals = { team1: 0, team2: 0, bags1: 0, bags2: 0 };

  it("docks a hundred at ten bags and carries the rest over", () => {
    const after = applyRoundScore(
      { ...totals, team1: 200, bags1: 9 },
      { team1Score: 42, team2Score: 0, team1Bags: 2, team2Bags: 0 },
    );
    expect(after.team1).toBe(142); // 200 + 42 - 100
    expect(after.bags1).toBe(1);
  });

  it("ends the game once a team passes the target", () => {
    const after = applyRoundScore(
      { ...totals, team1: WINNING_SCORE - 10 },
      { team1Score: 50, team2Score: 10, team1Bags: 0, team2Bags: 0 },
    );
    expect(after.gameOver).toBe(true);
    expect(after.winningTeam).toBe(1);
  });

  it("keeps playing on a tie at the target", () => {
    const after = applyRoundScore(
      { ...totals, team1: 450, team2: 450 },
      { team1Score: 50, team2Score: 50, team1Bags: 0, team2Bags: 0 },
    );
    expect(after.gameOver).toBe(false);
  });

  it("ends the game when a team falls through the floor", () => {
    const after = applyRoundScore(
      { ...totals, team1: 100, team2: -150 },
      { team1Score: 0, team2Score: -60, team1Bags: 0, team2Bags: 0 },
    );
    expect(after.gameOver).toBe(true);
    expect(after.winningTeam).toBe(1);
  });
});

describe("the computer player", () => {
  it("bids at least one and never more than thirteen", () => {
    expect(chooseBid(["2C", "3C", "4C", "5D", "6D", "7D", "8H", "9H", "TH", "2H", "3D", "4D", "5C"]))
      .toBeGreaterThanOrEqual(1);
    expect(chooseBid(sortHand(["AS", "KS", "QS", "JS", "TS", "9S", "8S", "7S", "6S", "5S", "4S", "3S", "2S"])))
      .toBeLessThanOrEqual(13);
  });

  it("bids a strong hand higher than a weak one", () => {
    const strong = chooseBid(["AS", "KS", "QS", "AH", "AD", "AC", "2C", "3C", "4C", "5D", "6D", "7D", "8H"]);
    const weak = chooseBid(["2C", "3C", "4C", "5D", "6D", "7D", "8H", "9H", "2H", "3H", "4H", "5H", "6C"]);
    expect(strong).toBeGreaterThan(weak);
  });

  it("only ever plays a legal card", () => {
    const state = initGameState(0);
    state.phase = "playing";
    state.currentTrick = trick([0, "5H"]);
    const seat = 1;
    const card = chooseCard(state, seat);
    expect(state.hands[seat]).toContain(card);
    expect(isValidPlay(card, state.hands[seat], state.currentTrick, state.spadeBroken)).toBe(true);
  });

  it("takes a trick it can win as the last to play", () => {
    const state = initGameState(0);
    state.phase = "playing";
    state.hands[3] = ["AH", "2H"];
    // Seat 0 is an opponent and is winning it, so seat 3 should take it.
    state.currentTrick = trick([0, "KH"], [1, "5H"], [2, "3H"]);
    expect(chooseCard(state, 3)).toBe("AH");
  });

  it("does not trump its own partner's winning trick", () => {
    const state = initGameState(0);
    state.phase = "playing";
    state.spadeBroken = true;
    state.hands[3] = ["2S", "4D"];
    // Seat 1 is seat 3's partner and is winning with the ace.
    state.currentTrick = trick([0, "5H"], [1, "AH"], [2, "3H"]);
    expect(chooseCard(state, 3)).toBe("4D");
  });

  it("leads something other than a spade while spades are unbroken", () => {
    const state = initGameState(0);
    state.phase = "playing";
    state.hands[2] = ["2S", "7D", "9C"];
    state.currentTrick = [];
    const card = chooseCard(state, 2);
    expect(card).not.toBe("2S");
  });
});

// Renig follows the owner's rule (renege.ts has the full suite): illegal cards
// are locked unless "Renig" is pressed, an illegal play is recorded in secret,
// and "Call renig" ends the game — the renig team loses if it is true, the
// caller's team loses if it is not. Nothing is moved at scoring time.
describe("reneging", () => {
  // Seat 1 holds hearts but throws a club on a heart lead.
  const led = trick([0, "KH"]);
  const hand = ["2H", "4C", "9D"];
  const play = (seat: number, card: string, h: string[], t: TrickPlay[], trickNumber: number) =>
    ({ seat, userId: `p${seat}`, round: 1, trickNumber, card, hand: h, trick: t, spadeBroken: false });

  it("spots a renig only when the led suit was still in hand", () => {
    expect(checkPlay("4C", hand, led, false)).toMatchObject({ legal: false, kind: "suit", ledSuit: "H" });
    expect(checkPlay("2H", hand, led, false).legal).toBe(true);
    expect(checkPlay("4C", ["4C", "9D"], led, false).legal).toBe(true);
    expect(checkPlay("4C", hand, [], false).legal).toBe(true);
  });

  it("locks illegal cards until the hand is unlocked; then any card goes", () => {
    expect(canPlay("4C", hand, led, false, false)).toBe(false);
    expect(canPlay("4C", hand, led, false, true)).toBe(true);
    // An early spade lead is locked too, and is a renig of its own when unlocked.
    expect(canPlay("3S", ["3S", "2H"], [], false, false)).toBe(false);
    expect(canPlay("3S", ["3S", "2H"], [], false, true)).toBe(true);
    expect(checkPlay("3S", ["3S", "2H"], [], false).kind).toBe("spades");
  });

  it("records a renig in secret, and following suit later changes nothing", () => {
    let log = recordPlay([], play(1, "4C", hand, led, 3));
    expect(log).toHaveLength(1);
    expect(log[0]).toMatchObject({ seat: 1, trickNumber: 3, card: "4C", ledSuit: "H", heldLedSuit: true });
    log = recordPlay(log, play(1, "2H", ["2H", "9D"], trick([2, "5H"]), 4));
    expect(log).toHaveLength(1);
  });

  it("can be called at once, by the other team only, and the call ends the game", () => {
    const log = recordPlay([], play(1, "4C", hand, led, 3));
    // Right call by seat 0: the renig team (2) loses.
    const right = resolveCall(log, { seat: 0, userId: "p0" }, { seat: 1, userId: "p1" });
    expect(right).toMatchObject({ correct: true, winningTeam: 1 });
    // Wrong call by seat 2 on seat 3: the caller's team (1) loses.
    const wrong = resolveCall(log, { seat: 2, userId: "p2" }, { seat: 3, userId: "p3" });
    expect(wrong).toMatchObject({ correct: false, winningTeam: 2 });
  });

  it("moves no tricks at scoring: a renig only matters if someone calls it", () => {
    const bids = { 0: 3, 1: 4, 2: 0, 3: 2 };
    const won = { 0: 4, 1: 5, 2: 0, 3: 4 };
    const score = calculateRoundScore(bids, won);
    expect(score.team1Score).toBe(30 + 1 + 100);
    expect(score.team2Score).toBe(60 + 3);
  });

  it("recaps the hand: who got set and which nils held, with no renig revealed", () => {
    const recap = recapRound(2, { 0: 3, 1: 4, 2: 0, 3: 2 }, { 0: 2, 1: 5, 2: 0, 3: 4 });
    expect(recap.set).toEqual([1]);
    expect(recap.nils).toEqual([{ seat: 2, made: true }]);
    expect(recap).not.toHaveProperty("reneges");
  });

  it("a computer on the other team sometimes calls it, never its partner's", () => {
    const log = recordPlay([], play(1, "4C", hand, led, 3));
    expect(botNotices(log, [0, 2], "k", 0.25, () => 0.1)?.accuserSeat).toBe(0);
    expect(botNotices(log, [3], "k", 1, () => 0)).toBeNull();
  });
});

describe("trump steals", () => {
  it("is a low spade taking down a picture card", () => {
    const steal = trumpSteal(trick([0, "AH"], [1, "2S"], [2, "3H"]));
    expect(steal?.winner.card).toBe("2S");
    expect(steal?.victim.card).toBe("AH");
    expect(steal?.upset).toBe(1);
  });

  it("isn't one when spades were led or no picture card fell", () => {
    expect(trumpSteal(trick([0, "AS"], [1, "2S"]))).toBeNull();
    expect(trumpSteal(trick([0, "9H"], [1, "2S"]))).toBeNull();
    expect(trumpSteal(trick([0, "KH"], [1, "AH"]))).toBeNull();
  });
});
