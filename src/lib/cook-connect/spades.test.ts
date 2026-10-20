import { describe, it, expect } from "vitest";
import {
  createDeck, dealCards, initGameState, isValidPlay, determineTrickWinner,
  calculateRoundScore, applyRoundScore, sortHand, getTeam, nextSeat,
  WINNING_SCORE, type TrickPlay,
  isRenege, isPlayable, trackRenege, callableReneges, callRenege, renegeTransfer,
  recapRound, trumpSteal,
} from "./spades";
import { chooseBid, chooseCard } from "./spadesBot";

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

describe("reneging", () => {
  // Seat 1 holds hearts but throws a club on a heart lead.
  const led = trick([0, "KH"]);
  const hand = ["2H", "4C", "9D"];

  it("spots a renege only when the led suit was still in hand", () => {
    expect(isRenege("4C", hand, led)).toBe(true);
    expect(isRenege("2H", hand, led)).toBe(false);
    expect(isRenege("4C", ["4C", "9D"], led)).toBe(false);
    expect(isRenege("4C", hand, [])).toBe(false);
  });

  it("lets you renege only with the house rule on, and never lead spades early", () => {
    expect(isPlayable("4C", hand, led, false, true)).toBe(true);
    expect(isPlayable("4C", hand, led, false, false)).toBe(false);
    expect(isPlayable("3S", ["3S", "2H"], [], false, true)).toBe(false);
  });

  it("logs the renege and exposes it once they play the skipped suit", () => {
    let log = trackRenege([], 1, "4C", hand, led, 3);
    expect(log).toEqual([{ seat: 1, trick: 3, card: "4C", led: "H" }]);
    expect(callableReneges(log, 0)).toHaveLength(0); // not provable yet
    log = trackRenege(log, 1, "2H", ["2H", "9D"], trick([2, "5S"]), 4);
    expect(log[0].exposed).toBe(true);
  });

  it("only lets the other team call it, and only once", () => {
    const log = [{ seat: 1, trick: 3, card: "4C", led: "H", exposed: true }];
    expect(callRenege(log, 3).caught).toBeNull(); // partner can't call it
    const first = callRenege(log, 0);
    expect(first.caught?.calledBy).toBe(0);
    expect(callRenege(first.reneges, 2).caught).toBeNull();
  });

  it("moves three tricks to the other team per renege", () => {
    const won = { 0: 2, 1: 4, 2: 2, 3: 1 };
    expect(renegeTransfer([{ seat: 1, trick: 1, card: "4C", led: "H" }], won)).toEqual({ team1: -3, team2: 3 });
    // Can't give up more than they won.
    expect(renegeTransfer([{ seat: 0, trick: 1, card: "4C", led: "H" }], { 0: 1, 1: 6, 2: 0, 3: 6 }))
      .toEqual({ team1: 1, team2: -1 });
  });

  it("can set a team that otherwise made its bid, without breaking a nil", () => {
    const bids = { 0: 3, 1: 4, 2: 0, 3: 2 };
    const won = { 0: 4, 1: 5, 2: 0, 3: 4 };
    const clean = calculateRoundScore(bids, won);
    expect(clean.team1Score).toBe(30 + 1 + 100);
    const penalised = calculateRoundScore(bids, won, [{ seat: 0, trick: 2, card: "4C", led: "H" }]);
    expect(penalised.team1Score).toBe(-30 + 100); // 4 - 3 = 1 trick < 3 bid, nil still made
    expect(penalised.team2Score).toBe(60 + 6);
  });

  it("recaps the hand: who got set, which nils held, every renege revealed", () => {
    const recap = recapRound(2, { 0: 3, 1: 4, 2: 0, 3: 2 }, { 0: 4, 1: 5, 2: 0, 3: 4 },
      [{ seat: 0, trick: 2, card: "4C", led: "H" }]);
    expect(recap.set).toEqual([1]);
    expect(recap.nils).toEqual([{ seat: 2, made: true }]);
    expect(recap.reneges[0].exposed).toBe(true);
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
