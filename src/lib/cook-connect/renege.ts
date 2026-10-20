// Reneging ("renig"): playing a card you were not allowed to.
//
// By default the table only lets you play legal cards. Pressing "Renig"
// unlocks every card in your hand, on your screen only. If you then play a
// card you should not have — a different suit while you still held the suit
// that was led, or a spade lead before spades were broken — nothing happens
// out loud: the game carries on and the play is written down quietly in the
// game state. Any player may "Call renig" on an opponent:
//
//   - they really did renig at some point this game → their team loses;
//   - they did not → the caller was wrong, and the caller's team loses.
//
// Either way the game ends there and then. Computer players never renig, and
// now and then (a fixed chance per trick, from a seeded roll so every browser
// agrees) one notices a person on the other team who did and calls it. They
// never call it on someone who played fair.
//
// Pure functions only; the hook writes what these return.

import { type TrickPlay, getSuit, getTeam, isValidPlay } from "./spades";

/** Chance per finished trick that a computer opponent notices a renig. */
export const BOT_NOTICE_CHANCE = 0.25;

export type RenegeKind = "suit" | "spades";

/** One secret record of an illegal play. Never shown until a call resolves. */
export interface RenegeRecord {
  seat: number;
  userId: string;
  /** The round (hand) of this game it happened in, counting from 1. */
  round: number;
  trickNumber: number;
  card: string;
  /** The suit that was led, or null when the renig was the lead itself. */
  ledSuit: string | null;
  /** "suit": did not follow suit while holding it. "spades": led a spade before they were broken. */
  kind: RenegeKind;
  /** They held the led suit (or a non-spade, for a spade lead) when they played. */
  heldLedSuit: true;
  /** The trick as evidence: what had been played up to the renig, then the whole trick once it is done. */
  trick: TrickPlay[];
}

/** The outcome of a renig call, shown to everyone once it is made. */
export interface RenigCall {
  accuserSeat: number;
  accuserId: string;
  accusedSeat: number;
  accusedId: string;
  byBot: boolean;
  /** True when the accused really did renig. */
  correct: boolean;
  winningTeam: number;
  /** The renig that proved it, when the call was right. */
  evidence: RenegeRecord | null;
  at: number;
}

export interface PlayCheck {
  legal: boolean;
  kind: RenegeKind | null;
  ledSuit: string | null;
}

/** Is this card legal, and if not, what kind of renig would it be? */
export function checkPlay(card: string, hand: string[], trick: TrickPlay[], spadeBroken: boolean): PlayCheck {
  const ledSuit = trick.length ? getSuit(trick[0].card) : null;
  if (isValidPlay(card, hand, trick, spadeBroken)) return { legal: true, kind: null, ledSuit };
  return { legal: false, kind: ledSuit ? "suit" : "spades", ledSuit };
}

/**
 * Whether a play goes through. A locked hand (the default) only plays legal
 * cards; an unlocked one ("Renig" pressed) plays anything it holds.
 */
export function canPlay(card: string, hand: string[], trick: TrickPlay[], spadeBroken: boolean, unlocked: boolean): boolean {
  if (!hand.includes(card)) return false;
  return unlocked || isValidPlay(card, hand, trick, spadeBroken);
}

/** Write down an illegal play. Legal plays leave the list unchanged. */
export function recordPlay(
  records: RenegeRecord[] | undefined,
  play: {
    seat: number; userId: string; round: number; trickNumber: number;
    card: string; hand: string[]; trick: TrickPlay[]; spadeBroken: boolean;
  },
): RenegeRecord[] {
  const list = records ?? [];
  const check = checkPlay(play.card, play.hand, play.trick, play.spadeBroken);
  if (check.legal) return list;
  return [
    ...list,
    {
      seat: play.seat,
      userId: play.userId,
      round: play.round,
      trickNumber: play.trickNumber,
      card: play.card,
      ledSuit: check.ledSuit,
      kind: check.kind!,
      heldLedSuit: true,
      trick: [...play.trick, { seat: play.seat, card: play.card }],
    },
  ];
}

/** Once a trick is finished, keep the whole trick as the evidence. */
export function completeEvidence(
  records: RenegeRecord[] | undefined,
  round: number,
  trickNumber: number,
  trick: TrickPlay[],
): RenegeRecord[] {
  return (records ?? []).map((r) =>
    r.round === round && r.trickNumber === trickNumber ? { ...r, trick: [...trick] } : r);
}

/** You can only call renig on someone on the other team. */
export const canAccuse = (accuserSeat: number, accusedSeat: number): boolean =>
  accuserSeat >= 0 && accusedSeat >= 0 && accuserSeat <= 3 && accusedSeat <= 3
  && getTeam(accuserSeat) !== getTeam(accusedSeat);

/** The other team's seats: the people a player may call renig on. */
export const accusableSeats = (accuserSeat: number): number[] =>
  [0, 1, 2, 3].filter((s) => canAccuse(accuserSeat, s));

/** Settle a call. The game ends either way; this says who won. */
export function resolveCall(
  records: RenegeRecord[] | undefined,
  accuser: { seat: number; userId: string },
  accused: { seat: number; userId: string },
  opts: { byBot?: boolean; at?: number } = {},
): RenigCall {
  const evidence = (records ?? []).find((r) => r.seat === accused.seat) ?? null;
  const correct = !!evidence;
  const accuserTeam = getTeam(accuser.seat);
  return {
    accuserSeat: accuser.seat,
    accuserId: accuser.userId,
    accusedSeat: accused.seat,
    accusedId: accused.userId,
    byBot: !!opts.byBot,
    correct,
    winningTeam: correct ? accuserTeam : accuserTeam === 1 ? 2 : 1,
    evidence,
    at: opts.at ?? Date.now(),
  };
}

/** A repeatable number in [0, 1) from a string, so every browser rolls the same. */
export function seededRoll(key: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < key.length; i++) {
    h ^= key.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  // One extra mix so neighbouring keys do not give neighbouring numbers.
  h ^= h >>> 16;
  h = Math.imul(h, 0x85ebca6b) >>> 0;
  h ^= h >>> 13;
  return (h >>> 0) / 4294967296;
}

/**
 * After a trick, does a computer player call out a renig? Only a computer on
 * the other team from the person who reneged, only for a renig that really
 * happened, and only when the roll comes in under the chance.
 */
export function botNotices(
  records: RenegeRecord[] | undefined,
  botSeats: number[],
  rollKey: string,
  chance: number = BOT_NOTICE_CHANCE,
  roll: (key: string) => number = seededRoll,
): { accuserSeat: number; accusedSeat: number; record: RenegeRecord } | null {
  // Computers never renig, so every record is a person's. Skip anyone whose
  // seat a computer has since taken over: you call out the person, not the seat.
  for (const record of (records ?? []).filter((r) => !botSeats.includes(r.seat))) {
    const watcher = [...botSeats].sort((a, b) => a - b).find((b) => canAccuse(b, record.seat));
    if (watcher === undefined) continue;
    if (roll(rollKey) < chance) return { accuserSeat: watcher, accusedSeat: record.seat, record };
    return null; // one roll per trick, however many renigs are on record
  }
  return null;
}

const SUIT_NAMES: Record<string, string> = { S: "spade", H: "heart", D: "diamond", C: "club" };
const SUIT_PLURALS: Record<string, string> = { S: "Spades", H: "Hearts", D: "Diamonds", C: "Clubs" };

/** The headline everybody sees when a call is settled. */
export function callHeadline(call: RenigCall, nameOf: (seat: number) => string): string {
  const accuser = nameOf(call.accuserSeat);
  const accused = nameOf(call.accusedSeat);
  return call.correct
    ? `${accused} reneged — caught by ${accuser}. ${accuser}'s team wins.`
    : `Wrong call — ${accused} didn't renig. ${accuser}'s team loses.`;
}

/** One sentence of evidence: what was led, and what they played while holding it. */
export function evidenceLine(record: RenegeRecord, nameOf: (seat: number) => string, rankName: (card: string) => string): string {
  const who = nameOf(record.seat);
  const card = rankName(record.card);
  const where = `round ${record.round}, trick ${record.trickNumber}`;
  if (record.kind === "spades" || !record.ledSuit) {
    return `${who} led the ${card} before spades were broken, while still holding other suits (${where}).`;
  }
  return `${SUIT_PLURALS[record.ledSuit]} were led and ${who} played the ${card} while still holding a ${SUIT_NAMES[record.ledSuit]} (${where}).`;
}
