// The spades waiting room: who is at a table, what they can choose, and how
// the seats are arranged when the people there decide to start with computer
// players.
//
// Pure functions only. The hook (hooks/useSpades.ts) reads the table, calls
// these, and writes the result; everything here is testable without a
// backend. The lobby's own state lives inside the spades game's JSON state
// (`GameState.lobby`), so it needs no extra column or migration.
//
// Seats follow spades.ts: seats 0 and 2 are team 1, seats 1 and 3 are team 2,
// so a seat's partner is always the seat two along.

import { getTeam } from "./spades";

export const SEATS = [0, 1, 2, 3] as const;

/** A claim to start the game older than this is treated as abandoned. */
export const CLAIM_STALE_MS = 15_000;
/**
 * Someone disconnected from the table this long (tab closed, phone locked) no
 * longer holds up a decision; their seat is kept for them by a computer. Long
 * enough that switching apps on a phone for a moment does not count.
 */
export const AWAY_AFTER_MS = 45_000;
/** A waiting table nobody has looked at for this long is skipped by matchmaking. */
export const FRESH_TABLE_MS = 3 * 60_000;
/** How often a waiting table says "still here" so matchmaking knows it is live. */
export const HEARTBEAT_MS = 30_000;

export interface LobbySeat {
  userId: string;
  seat: number;
}

/**
 * A "play with bots" vote. It records how many people were at the table when
 * it was cast: if someone sits down afterwards the vote no longer counts, so
 * nobody ends up in a game they did not agree to.
 */
export interface LobbyVote {
  userId: string;
  humans: number;
}

/** One browser saying "I am setting up the game", so only one does it. */
export interface StartClaim {
  by: string;
  at: number;
}

export interface LobbyState {
  votes: LobbyVote[];
  starting?: StartClaim | null;
  /** Opened by "Find real players": a lone person here may be moved to an older waiting table. */
  search?: boolean;
}

export const emptyLobby = (): LobbyState => ({ votes: [], starting: null });

export type LobbyStage = "empty" | "alone" | "pair" | "trio" | "full";

export function stageFor(humans: number): LobbyStage {
  if (humans <= 0) return "empty";
  if (humans === 1) return "alone";
  if (humans === 2) return "pair";
  if (humans === 3) return "trio";
  return "full";
}

/** The user ids whose vote still counts: still seated, cast at today's headcount. */
export function countedVotes(lobby: LobbyState | null | undefined, humans: LobbySeat[]): string[] {
  const ids = new Set(humans.map((h) => h.userId));
  const out: string[] = [];
  for (const v of lobby?.votes ?? []) {
    if (ids.has(v.userId) && v.humans === humans.length && !out.includes(v.userId)) out.push(v.userId);
  }
  return out;
}

/** Add (or refresh) one person's vote. */
export function castVote(lobby: LobbyState | null | undefined, userId: string, humans: number): LobbyState {
  const base = lobby ?? emptyLobby();
  return {
    ...base,
    votes: [...base.votes.filter((v) => v.userId !== userId), { userId, humans }],
  };
}

/** "Keep waiting": take a vote back. */
export function withdrawVote(lobby: LobbyState | null | undefined, userId: string): LobbyState {
  const base = lobby ?? emptyLobby();
  return { ...base, votes: base.votes.filter((v) => v.userId !== userId) };
}

export function isClaimFresh(claim: StartClaim | null | undefined, now: number): boolean {
  return !!claim && now - claim.at < CLAIM_STALE_MS;
}

/**
 * Who counts as away: not connected to the table right now, and not seen for
 * AWAY_AFTER_MS. `lastSeen` holds when each person was last connected (or when
 * this browser opened the table, as a grace period while presence syncs).
 */
export function awayUsers(
  humans: LobbySeat[],
  online: ReadonlySet<string>,
  lastSeen: Readonly<Record<string, number>>,
  openedAt: number,
  now: number,
  me: string | null,
): string[] {
  return humans
    .filter((h) => h.userId !== me && !online.has(h.userId))
    .filter((h) => now - Math.max(lastSeen[h.userId] ?? 0, openedAt) > AWAY_AFTER_MS)
    .map((h) => h.userId);
}

export interface LobbyView {
  stage: LobbyStage;
  humans: number;
  /** Computer players that would join if the table started now. */
  botCount: number;
  /** People whose agreement is needed: everyone seated who is not away. */
  required: string[];
  /** People who have agreed to start with computer players. */
  agreed: string[];
  /** Required people who have not agreed yet. */
  waitingOn: string[];
  away: string[];
  everyoneAgreed: boolean;
  iAgreed: boolean;
}

export function lobbyView(opts: {
  humans: LobbySeat[];
  lobby: LobbyState | null | undefined;
  away?: string[];
  me: string | null;
}): LobbyView {
  const { humans, lobby, me } = opts;
  const awaySet = new Set(opts.away ?? []);
  const required = humans.map((h) => h.userId).filter((id) => !awaySet.has(id));
  const agreed = countedVotes(lobby, humans);
  const waitingOn = required.filter((id) => !agreed.includes(id));
  const stage = stageFor(humans.length);
  return {
    stage,
    humans: humans.length,
    botCount: Math.max(0, 4 - humans.length),
    required,
    agreed,
    waitingOn,
    away: humans.map((h) => h.userId).filter((id) => awaySet.has(id)),
    everyoneAgreed:
      humans.length >= 1 && humans.length <= 3 && required.length > 0 && waitingOn.length === 0,
    iAgreed: !!me && agreed.includes(me),
  };
}

/* ── Seating ───────────────────────────────────────────────────── */

/**
 * Who partners the computer this game, when three people share a table with
 * one computer player. Never the same person twice in a row (when there is a
 * choice), favouring whoever has had it least, and random among the rest.
 */
export function pickBotPartner(
  humanIds: string[],
  history: string[],
  rand: () => number = Math.random,
): string | null {
  if (humanIds.length === 0) return null;
  const last = history[history.length - 1];
  const fresh = humanIds.filter((id) => id !== last);
  const candidates = fresh.length ? fresh : humanIds;
  const count = (id: string) => history.filter((h) => h === id).length;
  const least = Math.min(...candidates.map(count));
  const pool = candidates.filter((id) => count(id) === least);
  const i = Math.min(pool.length - 1, Math.floor(rand() * pool.length));
  return pool[i];
}

export interface SeatPlan {
  /** Where every person sits once the game starts. */
  seats: Record<string, number>;
  /** Seats the computer plays. */
  botSeats: number[];
  /** The person sitting across from the computer (three-person tables only). */
  botPartner: string | null;
  /** People who have to change seat. */
  moved: string[];
}

/** Any seat outside 0–3, or doubled up, is moved into a free seat first. */
function normalise(humans: LobbySeat[]): LobbySeat[] {
  const taken = new Set<number>();
  const ok: LobbySeat[] = [];
  const misplaced: LobbySeat[] = [];
  for (const h of humans.slice(0, 4)) {
    if ((SEATS as readonly number[]).includes(h.seat) && !taken.has(h.seat)) {
      taken.add(h.seat);
      ok.push({ ...h });
    } else misplaced.push({ ...h });
  }
  for (const h of misplaced) {
    const free = SEATS.find((s) => !taken.has(s))!;
    taken.add(free);
    ok.push({ userId: h.userId, seat: free });
  }
  return ok;
}

/**
 * Arrange a table for a game with computer players, moving as few people as
 * possible:
 *  - one person: they keep their seat; the computer takes the other three.
 *  - two people: they play AGAINST each other, each with a computer partner.
 *  - three people: the computer takes the fourth seat, and its partner comes
 *    from `pickBotPartner`, so it changes from one game to the next.
 *  - four people: no computer at all.
 */
export function planBotSeats(
  humans: LobbySeat[],
  history: string[] = [],
  rand: () => number = Math.random,
): SeatPlan {
  const placed = normalise(humans);
  const seats: Record<string, number> = Object.fromEntries(placed.map((h) => [h.userId, h.seat]));
  const occupied = () => new Set(Object.values(seats));
  const freeSeats = () => SEATS.filter((s) => !occupied().has(s));
  let botPartner: string | null = null;

  if (placed.length === 2) {
    const [a, b] = [...placed].sort((x, y) => x.seat - y.seat);
    if (getTeam(a.seat) === getTeam(b.seat)) {
      // Partners by accident of who sat where: move the later seat across.
      const target = freeSeats().find((s) => getTeam(s) !== getTeam(a.seat))!;
      seats[b.userId] = target;
    }
  } else if (placed.length === 3) {
    botPartner = pickBotPartner(placed.map((h) => h.userId), history, rand);
    const partnerSeat = seats[botPartner!];
    const botSeat = (partnerSeat + 2) % 4;
    const sitting = Object.entries(seats).find(([, s]) => s === botSeat)?.[0];
    if (sitting) seats[sitting] = freeSeats()[0];
  }

  const botSeats = freeSeats();
  const original = Object.fromEntries(humans.map((h) => [h.userId, h.seat]));
  const moved = Object.keys(seats).filter((id) => original[id] !== seats[id]);
  return { seats, botSeats, botPartner, moved };
}

/** The person across from a seat, i.e. their partner. */
export const partnerSeat = (seat: number): number => (seat + 2) % 4;

/* ── Matchmaking ───────────────────────────────────────────────── */

export interface TableSummary {
  id: string;
  game: "spades" | "chess";
  status: string;
  isPublic: boolean;
  createdAt: string;
  updatedAt: string;
  humanIds: string[];
  seatsFree: number;
}

/**
 * Which waiting spades tables to try, best first: public, still being watched
 * by somebody, with room, not already ours. The fullest table goes first so
 * games fill up quickly; among equals the one that has waited longest.
 */
export function tablesToJoin(tables: TableSummary[], me: string, now: number): string[] {
  return tables
    .filter((t) => t.game === "spades" && t.status === "pending" && t.isPublic)
    .filter((t) => t.seatsFree > 0 && t.humanIds.length > 0 && !t.humanIds.includes(me))
    .filter((t) => now - Date.parse(t.updatedAt) <= FRESH_TABLE_MS)
    .sort((a, b) =>
      b.humanIds.length - a.humanIds.length || a.createdAt.localeCompare(b.createdAt))
    .map((t) => t.id);
}

/* ── Words ─────────────────────────────────────────────────────── */

/** "Sam", "Sam and Jo", "Sam, Jo and Al". */
export function joinNames(names: string[]): string {
  if (names.length <= 1) return names[0] ?? "";
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

export function waitingLine(names: string[]): string {
  if (names.length === 0) return "";
  return `Waiting for ${joinNames(names)} to agree…`;
}

/** What starting now would mean, in one sentence, for each headcount. */
export function stageExplainer(stage: LobbyStage): string {
  switch (stage) {
    case "alone":
      return "You're the first one here. Anyone who searches for players gets seated at this table. Or start now: you and a computer partner against two computer players.";
    case "pair":
      return "Two of you are here. Wait for more people, or start now: you two play on opposite teams, each with a computer partner.";
    case "trio":
      return "Three of you are here. Wait for a fourth, or start now: a computer takes the last seat. Its partner is picked at random and changes every game.";
    case "full":
      return "Four players are here. Dealing now.";
    default:
      return "Nobody is seated yet.";
  }
}

/* ── Results ───────────────────────────────────────────────────── */

/** One result per seat for finishMatch. Computer seats are marked so the leaderboard skips them. */
export function seatResults(
  table: { userId: string; isBot: boolean; team: number }[],
  winningTeam: number,
): { userId: string; isBot: boolean; result: "win" | "loss" }[] {
  return table
    .filter((t) => t.userId)
    .map((t) => ({ userId: t.userId, isBot: t.isBot, result: t.team === winningTeam ? "win" : "loss" }));
}
