// Table talk: the computer players say something now and then — "I think we
// got you this round" after a big bid, "Set!" when they set you. Only on some
// hands, and only some moments of those hands, so it stays a surprise.
//
// Every roll is seeded by the table and the hand, so every screen at the
// table hears the same line from the same seat. The words live in the theme
// (Game Play Design Styling › talk), never here.
//
// Pure: the table works out what happened and draws what this returns.

import { seededRoll } from "./renege";
import { getTeam, teamResult, teamSeats, type FinalHandThreat, type RoundRecap } from "./spades";
import type { TableTalkStyle, TalkCue } from "./gameStyle";

export interface TalkCandidate { seat: number; cue: TalkCue }
export interface TalkLine { seat: number; cue: TalkCue; text: string }

/** Are the computers chatty this hand? About `handChance` of hands. */
export const isChattyHand = (talk: TableTalkStyle, handKey: string): boolean =>
  talk.on && seededRoll(`${handKey}:chatty`) < talk.handChance;

/**
 * One line for one moment of a hand, or nothing. Only computer seats talk.
 * `momentKey` names the moment ("bid:2", "trick:7", "end") so each one rolls
 * on its own.
 */
export function pickTalk(
  talk: TableTalkStyle,
  handKey: string,
  momentKey: string,
  candidates: TalkCandidate[],
  botSeats: number[],
): TalkLine | null {
  if (!isChattyHand(talk, handKey)) return null;
  const pool = candidates.filter((c) => botSeats.includes(c.seat) && (talk.lines[c.cue]?.length ?? 0) > 0);
  if (!pool.length) return null;
  if (seededRoll(`${handKey}:${momentKey}:say`) >= talk.lineChance) return null;
  const pick = pool[Math.floor(seededRoll(`${handKey}:${momentKey}:who`) * pool.length)];
  const lines = talk.lines[pick.cue];
  return { ...pick, text: lines[Math.floor(seededRoll(`${handKey}:${momentKey}:line`) * lines.length)] };
}

/** What a bid is worth talking about. A bid that is neither big nor small says nothing. */
export function bidCue(bid: number, partnerBid: number | null | undefined): TalkCue | null {
  if (bid === 0) return "bidNil";
  const team = bid + (partnerBid && partnerBid > 0 ? partnerBid : 0);
  if (bid >= 5 || team >= 8) return "bidHigh";
  if (bid <= 2 && (partnerBid === null || partnerBid === undefined || team <= 4)) return "bidLow";
  return null;
}

/** Who could say what about a finished hand. */
export function roundCues(recap: RoundRecap): TalkCandidate[] {
  const out: TalkCandidate[] = [];
  for (const team of [1, 2]) {
    const result = teamResult(team, recap.bids, recap.tricksWon);
    const mine = teamSeats(team);
    const theirs = teamSeats(team === 1 ? 2 : 1);
    if (result.set) {
      theirs.forEach((seat) => out.push({ seat, cue: "setThem" }));
      mine.forEach((seat) => out.push({ seat, cue: "gotSet" }));
    } else if (result.contract > 0) {
      mine.forEach((seat) => out.push({ seat, cue: "madeBid" }));
    }
  }
  for (const nil of recap.nils) {
    if (nil.made) out.push({ seat: nil.seat, cue: "nilHeld" });
    else teamSeats(getTeam(nil.seat) === 1 ? 2 : 1).forEach((seat) => out.push({ seat, cue: "nilBusted" }));
  }
  return out;
}

/** At the start of a hand that could end the game. */
export function threatCues(threats: FinalHandThreat[]): TalkCandidate[] {
  const out: TalkCandidate[] = [];
  for (const t of threats) {
    teamSeats(t.team).forEach((seat) => out.push({ seat, cue: "closeOut" }));
    teamSeats(t.team === 1 ? 2 : 1).forEach((seat) => out.push({ seat, cue: "stopThem" }));
  }
  return out;
}
