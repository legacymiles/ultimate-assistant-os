// Spades rules engine. Pure functions over a serialisable GameState, so the
// same code scores a table whether the state came from Supabase or from the
// in-browser demo backend.

import type { LobbyState } from "./lobby";
import type { RenegeRecord, RenigCall } from "./renege";

export type Suit = "S" | "H" | "D" | "C";
/** A card is rank + suit, e.g. "2S", "AH", "TD". */
export type Card = string;

export interface TrickPlay {
  seat: number;
  card: Card;
}

export interface GameState {
  /**
   * "dealing": a new hand is waiting for its dealer to shuffle and deal (the
   * hands are not shown yet). Then one round of bidding, then the play.
   */
  phase: "dealing" | "bidding" | "playing" | "roundEnd" | "gameEnd";
  hands: Record<number, Card[]>;
  bids: Record<number, number | null>;
  currentTrick: TrickPlay[];
  trickLeader: number;
  currentTurn: number;
  tricksWon: Record<number, number>;
  spadeBroken: boolean;
  trickNumber: number;
  dealer: number;
  lastTrick?: TrickPlay[];
  lastTrickWinner?: number;
  /** Seats played by the computer — empty at the start, or someone who left. */
  bots?: number[];
  /** User ids who have voted for a rematch. */
  rematch?: string[];
  /** The waiting room: votes to start with computer players, and who is starting it. */
  lobby?: LobbyState;
  /**
   * Who partnered the computer in each game at this table, oldest first, so a
   * three-person table can hand the computer a different partner every game.
   */
  botPartners?: string[];
  /**
   * Where people sit when that changed between games (the computer's partner
   * rotating). Wins over match_players.seat, which keeps the original seat so
   * the seat rows never collide; results are written per person, not per seat.
   */
  seatOverrides?: Record<string, number>;
  /**
   * Secret record of illegal plays this game (see renege.ts). Kept for the
   * whole game, and never shown until a "Call renig" settles.
   */
  reneges?: RenegeRecord[];
  /** A settled "Call renig" — it ends the game. */
  renigCall?: RenigCall | null;
  /** What the hand that just ended came to — drives the "SET!" moment. */
  lastRound?: RoundRecap;
  /**
   * Between hands (phase "roundEnd"): who has pressed Next. The next hand is
   * dealt only once everyone at the table who is still here has pressed it —
   * it never deals by itself (owner's rule, Oct 2026).
   */
  ready?: string[];
}

/** A finished hand, kept on the next hand's state so every screen can replay it. */
export interface RoundRecap {
  /** Round number of the hand that ended. */
  round: number;
  bids: Record<number, number | null>;
  tricksWon: Record<number, number>;
  /** Teams that fell short of their contract. */
  set: number[];
  /** Nil bids and whether each one held. */
  nils: { seat: number; made: boolean }[];
  team1Score: number;
  team2Score: number;
}

export const RANK_VALUES: Record<string, number> = {
  "2": 2, "3": 3, "4": 4, "5": 5, "6": 6, "7": 7, "8": 8,
  "9": 9, T: 10, J: 11, Q: 12, K: 13, A: 14,
};

export const RANK_DISPLAY: Record<string, string> = {
  "2": "2", "3": "3", "4": "4", "5": "5", "6": "6", "7": "7", "8": "8",
  "9": "9", T: "10", J: "J", Q: "Q", K: "K", A: "A",
};

export const SUIT_SYMBOLS: Record<string, string> = { S: "♠", H: "♥", D: "♦", C: "♣" };

/** Target score, and the floor that ends a game early. */
export const WINNING_SCORE = 500;
export const LOSING_SCORE = -200;
// No bags (owner's rule, Oct 2026): an overtrick is simply +1 point and is
// never counted or penalised. The spades_games.team*_bags columns are kept in
// the database but no longer read or written.

export const getSuit = (card: Card): string => card[card.length - 1];
export const getRank = (card: Card): string => card.slice(0, -1);
export const isRedSuit = (suit: string): boolean => suit === "H" || suit === "D";

function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export function sortHand(cards: Card[]): Card[] {
  const suitOrder: Record<string, number> = { S: 0, H: 1, D: 2, C: 3 };
  return [...cards].sort((a, b) => {
    const sd = suitOrder[getSuit(a)] - suitOrder[getSuit(b)];
    return sd !== 0 ? sd : RANK_VALUES[getRank(a)] - RANK_VALUES[getRank(b)];
  });
}

export function createDeck(): Card[] {
  const suits = ["S", "H", "D", "C"];
  const ranks = ["2", "3", "4", "5", "6", "7", "8", "9", "T", "J", "Q", "K", "A"];
  return suits.flatMap((s) => ranks.map((r) => r + s));
}

export function dealCards(): Record<number, Card[]> {
  const deck = shuffle(createDeck());
  return {
    0: sortHand(deck.slice(0, 13)),
    1: sortHand(deck.slice(13, 26)),
    2: sortHand(deck.slice(26, 39)),
    3: sortHand(deck.slice(39, 52)),
  };
}

// --- the deal, the bidding and who leads ----------------------------------
//
// Like a real table (owner's rule, Oct 2026): the player to the dealer's left
// bids first, bidding goes clockwise (seat + 1) and the dealer bids last, one
// round. The player to the dealer's left also leads the first trick; after
// that whoever wins a trick leads the next. After each hand the deal passes to
// the left, so the next player along bids first and leads next hand.

/** The player to a seat's left (clockwise). */
export const nextSeat = (seat: number): number => (seat + 1) % 4;
/** Seats 0 and 2 are team 1; seats 1 and 3 are team 2. */
export const getTeam = (seat: number): number => (seat % 2 === 0 ? 1 : 2);
/** Seats on a team. */
export const teamSeats = (team: number): [number, number] => (team === 1 ? [0, 2] : [1, 3]);

/** Who bids first, and leads the first trick: the player to the dealer's left. */
export const firstToAct = (dealer: number): number => nextSeat(dealer);
/** The bidding order for a hand: dealer's left first, the dealer last. */
export const biddingOrder = (dealer: number): number[] => [1, 2, 3, 4].map((k) => (dealer + k) % 4);
/** The deal passes to the left after each hand. */
export const nextDealer = (dealer: number): number => nextSeat(dealer);

/**
 * A new hand, waiting for the dealer to shuffle and deal. The cards are
 * already dealt in the state (so old code and the tests always find 13 a
 * seat), but nothing is shown until `dealHand` flips it to bidding.
 */
export function initGameState(dealer: number): GameState {
  const first = firstToAct(dealer);
  return {
    phase: "dealing",
    hands: dealCards(),
    bids: { 0: null, 1: null, 2: null, 3: null },
    currentTrick: [],
    trickLeader: first,
    currentTurn: first,
    tricksWon: { 0: 0, 1: 0, 2: 0, 3: 0 },
    spadeBroken: false,
    trickNumber: 1,
    dealer,
  };
}

/** "Stop & deal": a fresh shuffle goes out and bidding starts at the dealer's left. */
export function dealHand(state: GameState, hands: Record<number, Card[]> = dealCards()): GameState {
  const first = firstToAct(state.dealer);
  return {
    ...state,
    phase: "bidding",
    hands,
    bids: { 0: null, 1: null, 2: null, 3: null },
    currentTrick: [],
    trickLeader: first,
    currentTurn: first,
    tricksWon: { 0: 0, 1: 0, 2: 0, 3: 0 },
    spadeBroken: false,
    trickNumber: 1,
  };
}

/**
 * One bid, in turn. When the dealer (the last bidder) is in, play starts with
 * the dealer's left leading. Returns null for a bid out of turn.
 */
export function applyBid(state: GameState, seat: number, bid: number): GameState | null {
  if (state.phase !== "bidding" || state.currentTurn !== seat || state.bids[seat] !== null) return null;
  const bids = { ...state.bids, [seat]: Math.max(0, Math.min(13, Math.round(bid))) };
  const allIn = [0, 1, 2, 3].every((s) => bids[s] !== null && bids[s] !== undefined);
  const first = firstToAct(state.dealer);
  return {
    ...state,
    bids,
    phase: allIn ? "playing" : "bidding",
    trickLeader: allIn ? first : state.trickLeader,
    currentTurn: allIn ? first : nextSeat(seat),
  };
}

/**
 * Who plays next in a trick: the next seat clockwise from `from` that has not
 * played in it yet. Usually that is simply the next seat; it differs only
 * after someone played out of turn (their turn is then skipped).
 */
export function nextToPlay(trick: TrickPlay[], from: number): number {
  let seat = nextSeat(from);
  for (let k = 0; k < 4 && trick.some((t) => t.seat === seat); k++) seat = nextSeat(seat);
  return seat;
}

/**
 * Can this seat play out of turn right now? Only while cards are being played,
 * only when it is someone else's turn, only once per trick, and only after the
 * trick has been led — so the leader's card always sets the suit to follow.
 */
export const canPlayOutOfTurn = (state: GameState, seat: number): boolean =>
  state.phase === "playing" && state.currentTurn !== seat && seat >= 0 && seat <= 3
  && state.currentTrick.length > 0
  && !state.currentTrick.some((t) => t.seat === seat) && (state.hands[seat]?.length ?? 0) > 0;

/** Follow the led suit if you can; don't lead spades until they're broken. */
export function isValidPlay(
  card: Card,
  hand: Card[],
  currentTrick: TrickPlay[],
  spadeBroken: boolean,
): boolean {
  if (currentTrick.length === 0) {
    if (getSuit(card) === "S" && !spadeBroken) {
      return hand.every((c) => getSuit(c) === "S"); // nothing but spades left
    }
    return true;
  }
  const leadSuit = getSuit(currentTrick[0].card);
  if (getSuit(card) === leadSuit) return true;
  return !hand.some((c) => getSuit(c) === leadSuit);
}

export function determineTrickWinner(trick: TrickPlay[]): number {
  let winner = trick[0];
  for (let i = 1; i < trick.length; i++) {
    const play = trick[i];
    const ws = getSuit(winner.card);
    const ps = getSuit(play.card);
    if (ps === "S" && ws !== "S") winner = play;
    else if (ps === ws && RANK_VALUES[getRank(play.card)] > RANK_VALUES[getRank(winner.card)]) {
      winner = play;
    }
  }
  return winner.seat;
}

export interface RoundScore {
  team1Score: number;
  team2Score: number;
}

/** What a team bid and took this hand. Nil bids are left out of the contract. */
export interface TeamResult {
  /** The team's combined bid, nil bids not counted. */
  contract: number;
  /** The team's combined tricks (a nil bidder's tricks count toward it). */
  tricks: number;
  /** Set: the TEAM took fewer than the TEAM bid. Never decided per player. */
  set: boolean;
  /** Points for the hand: contract, overtricks and nils. */
  points: number;
}

/**
 * A partnership is scored as one (owner's rule, Oct 2026): partners who bid
 * 2 and 2 need 4 between them, however they split them — 4 and 0 makes it.
 * Made: ten a trick bid plus one a trick over (no bags, no penalty). Set: minus
 * ten a trick bid. A nil stays a single player's: +100 held, -100 broken.
 */
export function teamResult(
  team: number,
  bids: Record<number, number | null>,
  tricksWon: Record<number, number>,
): TeamResult {
  const seats = teamSeats(team);
  let points = 0;
  for (const s of seats) {
    if (bids[s] === 0) points += (tricksWon[s] || 0) === 0 ? 100 : -100;
  }
  const contract = seats.reduce((a, s) => a + (bids[s] ? bids[s]! : 0), 0);
  const tricks = seats.reduce((a, s) => a + (tricksWon[s] || 0), 0);
  const set = contract > 0 && tricks < contract;
  if (contract > 0) points += set ? -contract * 10 : contract * 10 + (tricks - contract);
  return { contract, tricks, set, points };
}

/** (A renig is not scored here: a "Call renig" ends the whole game — see renege.ts.) */
export function calculateRoundScore(
  bids: Record<number, number | null>,
  tricksWon: Record<number, number>,
): RoundScore {
  return {
    team1Score: teamResult(1, bids, tricksWon).points,
    team2Score: teamResult(2, bids, tricksWon).points,
  };
}

/** The story of a finished hand, for the end-of-hand moments. */
export function recapRound(
  round: number,
  bids: Record<number, number | null>,
  tricksWon: Record<number, number>,
): RoundRecap {
  const t1 = teamResult(1, bids, tricksWon);
  const t2 = teamResult(2, bids, tricksWon);
  const set = [t1.set ? 1 : 0, t2.set ? 2 : 0].filter(Boolean);
  const nils = [0, 1, 2, 3]
    .filter((s) => bids[s] === 0)
    .map((seat) => ({ seat, made: (tricksWon[seat] || 0) === 0 }));
  return { round, bids, tricksWon, set, nils, team1Score: t1.points, team2Score: t2.points };
}

// --- the big moments ---------------------------------------------------------

/**
 * A trump steal: spades weren't led, a spade won, and the trick had a picture
 * card of the led suit in it. The lower the spade and the higher the card it
 * beat, the bigger the upset (0–1).
 */
export function trumpSteal(trick: TrickPlay[]): { winner: TrickPlay; victim: TrickPlay; upset: number } | null {
  if (trick.length < 2) return null;
  const led = getSuit(trick[0].card);
  if (led === "S") return null;
  const winnerSeat = determineTrickWinner(trick);
  const winner = trick.find((t) => t.seat === winnerSeat)!;
  if (getSuit(winner.card) !== "S") return null;
  const victims = trick
    .filter((t) => getSuit(t.card) === led)
    .sort((a, b) => RANK_VALUES[getRank(b.card)] - RANK_VALUES[getRank(a.card)]);
  const victim = victims[0];
  if (!victim || RANK_VALUES[getRank(victim.card)] < 12) return null;
  const upset = (RANK_VALUES[getRank(victim.card)] - RANK_VALUES[getRank(winner.card)] + 12) / 24;
  return { winner, victim, upset: Math.max(0, Math.min(1, upset)) };
}

/** Apply a round's result to a running total. No bags: nothing else is added. */
export function applyRoundScore(
  totals: { team1: number; team2: number },
  round: RoundScore,
) {
  const team1 = totals.team1 + round.team1Score;
  const team2 = totals.team2 + round.team2Score;
  const over = team1 >= WINNING_SCORE || team2 >= WINNING_SCORE
    || team1 <= LOSING_SCORE || team2 <= LOSING_SCORE;
  return {
    team1, team2,
    gameOver: over && team1 !== team2,
    winningTeam: team1 > team2 ? 1 : 2,
  };
}

// --- the race to the target -------------------------------------------------

/** How many points each team still needs to win (0 once there). */
export function pointsToWin(
  totals: { team1: number; team2: number },
  target: number = WINNING_SCORE,
): { target: number; 1: number; 2: number } {
  return {
    target,
    1: Math.max(0, target - totals.team1),
    2: Math.max(0, target - totals.team2),
  };
}

/**
 * A team this close to the target could finish the game in one ordinary hand
 * (a ten-trick team bid is worth 100).
 */
export const FINAL_HAND_REACH = 100;

/** What a team's bids are worth if they make them exactly (nils included). */
export function contractPoints(team: number, bids: Record<number, number | null>): number | null {
  const seats = teamSeats(team);
  if (seats.some((s) => bids[s] === null || bids[s] === undefined)) return null;
  return seats.reduce((a, s) => a + (bids[s] === 0 ? 100 : bids[s]! * 10), 0);
}

export interface FinalHandThreat {
  team: 1 | 2;
  /** Points still needed to reach the target. */
  need: number;
  /** True once the team has bid enough that making the bid wins the game. */
  onBid: boolean;
}

/**
 * Could the next (or current) hand end the game? A team is a threat when its
 * score plus what it can plausibly make reaches the target: once both partners
 * have bid, that is exactly their bid; before then, being within
 * FINAL_HAND_REACH of the target. A team whose bid falls short is no threat.
 */
export function finalHandThreats(
  totals: { team1: number; team2: number },
  bids?: Record<number, number | null>,
  target: number = WINNING_SCORE,
): FinalHandThreat[] {
  const out: FinalHandThreat[] = [];
  for (const team of [1, 2] as const) {
    const score = team === 1 ? totals.team1 : totals.team2;
    const need = target - score;
    if (need <= 0) continue;
    const onBid = bids ? contractPoints(team, bids) : null;
    if (onBid !== null) {
      if (onBid >= need) out.push({ team, need, onBid: true });
    } else if (need <= FINAL_HAND_REACH) {
      out.push({ team, need, onBid: false });
    }
  }
  return out;
}
