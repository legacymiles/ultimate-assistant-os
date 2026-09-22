// Spades rules engine. Pure functions over a serialisable GameState, so the
// same code scores a table whether the state came from Supabase or from the
// in-browser demo backend.

export type Suit = "S" | "H" | "D" | "C";
/** A card is rank + suit, e.g. "2S", "AH", "TD". */
export type Card = string;

export interface TrickPlay {
  seat: number;
  card: Card;
}

export interface GameState {
  phase: "bidding" | "playing" | "roundEnd" | "gameEnd";
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
/** Ten bags costs a hundred points. */
export const BAG_PENALTY_AT = 10;

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

export function initGameState(dealer: number): GameState {
  const firstBidder = (dealer + 1) % 4;
  return {
    phase: "bidding",
    hands: dealCards(),
    bids: { 0: null, 1: null, 2: null, 3: null },
    currentTrick: [],
    trickLeader: firstBidder,
    currentTurn: firstBidder,
    tricksWon: { 0: 0, 1: 0, 2: 0, 3: 0 },
    spadeBroken: false,
    trickNumber: 1,
    dealer,
  };
}

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
  team1Bags: number;
  team2Bags: number;
}

/** Ten a trick when a team makes its contract, one a bag over; nil is ±100. */
export function calculateRoundScore(
  bids: Record<number, number | null>,
  tricksWon: Record<number, number>,
): RoundScore {
  const team = (seats: number[]) => {
    let score = 0;
    for (const s of seats) {
      if (bids[s] === 0) score += (tricksWon[s] || 0) === 0 ? 100 : -100;
    }
    const contract = seats.reduce((a, s) => a + (bids[s] !== 0 ? bids[s] || 0 : 0), 0);
    const tricks = seats.reduce((a, s) => a + (tricksWon[s] || 0), 0);
    let bags = 0;
    if (contract > 0) {
      if (tricks >= contract) {
        bags = tricks - contract;
        score += contract * 10 + bags;
      } else {
        score -= contract * 10;
      }
    }
    return { score, bags };
  };

  const t1 = team([0, 2]);
  const t2 = team([1, 3]);
  return { team1Score: t1.score, team2Score: t2.score, team1Bags: t1.bags, team2Bags: t2.bags };
}

/** Apply a round's result to a running total, including the ten-bag penalty. */
export function applyRoundScore(
  totals: { team1: number; team2: number; bags1: number; bags2: number },
  round: RoundScore,
) {
  let team1 = totals.team1 + round.team1Score;
  let team2 = totals.team2 + round.team2Score;
  let bags1 = totals.bags1 + round.team1Bags;
  let bags2 = totals.bags2 + round.team2Bags;
  if (bags1 >= BAG_PENALTY_AT) { team1 -= 100; bags1 -= BAG_PENALTY_AT; }
  if (bags2 >= BAG_PENALTY_AT) { team2 -= 100; bags2 -= BAG_PENALTY_AT; }
  const over = team1 >= WINNING_SCORE || team2 >= WINNING_SCORE
    || team1 <= LOSING_SCORE || team2 <= LOSING_SCORE;
  return {
    team1, team2, bags1, bags2,
    gameOver: over && team1 !== team2,
    winningTeam: team1 > team2 ? 1 : 2,
  };
}

export const nextSeat = (seat: number): number => (seat + 1) % 4;
/** Seats 0 and 2 are team 1; seats 1 and 3 are team 2. */
export const getTeam = (seat: number): number => (seat % 2 === 0 ? 1 : 2);
