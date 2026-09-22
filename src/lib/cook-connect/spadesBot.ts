// Computer players. They fill empty seats so a table can start with fewer than
// four people, and take over the seat of anyone who leaves mid-game.
import {
  type GameState, type TrickPlay, getSuit, getRank, RANK_VALUES,
  isValidPlay, determineTrickWinner,
} from "./spades";

export const BOT_NAMES = ["Ace", "Jack", "Queenie", "Rook"];

export const botName = (seat: number): string => `${BOT_NAMES[seat % BOT_NAMES.length]} (computer)`;
export const botShortName = (seat: number): string => BOT_NAMES[seat % BOT_NAMES.length];

const value = (card: string) => RANK_VALUES[getRank(card)];
const lowest = (cards: string[]) => [...cards].sort((a, b) => value(a) - value(b))[0];

/** Count likely tricks: aces, protected kings, high spades and long spades. */
export function chooseBid(hand: string[]): number {
  let tricks = 0;
  const bySuit: Record<string, string[]> = { S: [], H: [], D: [], C: [] };
  hand.forEach((c) => bySuit[getSuit(c)].push(c));

  for (const suit of ["H", "D", "C"]) {
    const cards = bySuit[suit];
    if (cards.some((c) => getRank(c) === "A")) tricks += 1;
    if (cards.some((c) => getRank(c) === "K") && cards.length >= 2 && cards.length <= 5) tricks += 0.75;
    // A void or singleton is a ruffing chance, but only with spades to ruff with.
    if (cards.length <= 1 && bySuit.S.length >= 3) tricks += 0.5;
  }
  const spades = bySuit.S;
  spades.forEach((c) => {
    if (value(c) >= 12) tricks += 1;
    else if (value(c) === 11 && spades.length >= 3) tricks += 0.5;
  });
  tricks += Math.max(0, spades.length - 3) * 0.8;

  return Math.min(13, Math.max(1, Math.round(tricks)));
}

export function chooseCard(state: GameState, seat: number): string {
  const hand = state.hands[seat] ?? [];
  const legal = hand.filter((c) => isValidPlay(c, hand, state.currentTrick, state.spadeBroken));
  if (legal.length <= 1) return legal[0] ?? hand[0];

  const trick = state.currentTrick;
  if (trick.length === 0) {
    // Lead a winning ace if we have one, otherwise our lowest non-spade.
    const aces = legal.filter((c) => getRank(c) === "A" && getSuit(c) !== "S");
    if (aces.length) return aces[0];
    const nonSpades = legal.filter((c) => getSuit(c) !== "S");
    return lowest(nonSpades.length ? nonSpades : legal);
  }

  const winnerNow = determineTrickWinner(trick);
  const partner = (seat + 2) % 4;
  const beats = (card: string) =>
    determineTrickWinner([...trick, { seat, card } as TrickPlay]) === seat;

  // Partner already has it and is likely to keep it: throw our cheapest away.
  const partnerPlay = trick.find((t) => t.seat === partner);
  if (winnerNow === partner && partnerPlay && (trick.length === 3 || value(partnerPlay.card) >= 13)) {
    const nonSpades = legal.filter((c) => getSuit(c) !== "S");
    return lowest(nonSpades.length ? nonSpades : legal);
  }

  const winners = legal.filter(beats);
  if (winners.length) {
    // Last to play: win as cheaply as possible. Otherwise win with the highest
    // card of the led suit (harder to overtake), or the cheapest trump.
    if (trick.length === 3) return lowest(winners);
    const lead = getSuit(trick[0].card);
    const inSuit = winners.filter((c) => getSuit(c) === lead);
    if (inSuit.length) return [...inSuit].sort((a, b) => value(b) - value(a))[0];
    return lowest(winners);
  }

  const nonSpades = legal.filter((c) => getSuit(c) !== "S");
  return lowest(nonSpades.length ? nonSpades : legal);
}
