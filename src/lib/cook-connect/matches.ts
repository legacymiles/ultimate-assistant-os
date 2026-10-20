"use client";

// Creating, joining and finishing matches.
//
// A match row is the record that the players leaderboard is computed from, so
// every game — spades or chess, against people or the computer — opens one and
// closes it exactly once. The live board state lives in spades_games or
// chess_games alongside it.

import { initGameState } from "./spades";
import { recordActivity } from "./social";
import { emptyLobby, tablesToJoin } from "./lobby";
import type { GameKind, Match, MatchPlayer, SeatResult } from "./types";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Backend = any;

const now = () => new Date().toISOString();
const newId = () =>
  typeof crypto !== "undefined" && crypto.randomUUID
    ? crypto.randomUUID()
    : `id-${Math.random().toString(36).slice(2)}${Date.now()}`;

export const START_FEN = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";

export interface OpenTable {
  match: Match;
  players: MatchPlayer[];
  seatsFree: number;
}

/** Tables still waiting for people, newest first. */
export async function loadOpenTables(sb: Backend): Promise<OpenTable[]> {
  const { data: matches } = await sb
    .from("matches").select("*").eq("status", "pending").eq("is_public", true)
    .order("created_at", { ascending: false }).limit(30);
  const rows = (matches ?? []) as Match[];
  if (!rows.length) return [];
  const { data: seatRows } = await sb.from("match_players").select("*").in("match_id", rows.map((m) => m.id));
  const seats = (seatRows ?? []) as MatchPlayer[];
  return rows.map((match) => {
    const players = seats.filter((s) => s.match_id === match.id);
    const capacity = match.game === "spades" ? 4 : 2;
    return { match, players, seatsFree: capacity - players.length };
  }).filter((t) => t.seatsFree > 0);
}

export async function loadLiveMatches(sb: Backend, userId: string): Promise<OpenTable[]> {
  const { data: seatRows } = await sb.from("match_players").select("*").eq("user_id", userId);
  const mine = (seatRows ?? []) as MatchPlayer[];
  if (!mine.length) return [];
  const { data: matchRows } = await sb.from("matches").select("*").in("id", mine.map((s) => s.match_id));
  const rows = ((matchRows ?? []) as Match[]).filter((m) => m.status === "pending" || m.status === "live");
  const { data: allSeats } = rows.length
    ? await sb.from("match_players").select("*").in("match_id", rows.map((m) => m.id))
    : { data: [] };
  const seats = (allSeats ?? []) as MatchPlayer[];
  return rows.map((match) => {
    const players = seats.filter((s) => s.match_id === match.id);
    const capacity = match.game === "spades" ? 4 : 2;
    return { match, players, seatsFree: capacity - players.length };
  });
}

export interface CreateOptions {
  game: GameKind;
  userId: string;
  /** A private table is not listed in the lobby; share the link instead. */
  isPublic?: boolean;
  /** Seats to fill with the computer straight away. */
  withBots?: boolean;
  /** Chess only. */
  botLevel?: "easy" | "medium" | "hard";
  /** Spades only: opened by "Find real players", so matchmaking may merge it into an older table. */
  search?: boolean;
}

export async function createMatch(sb: Backend, opts: CreateOptions): Promise<string> {
  const matchId = newId();
  await sb.from("matches").insert({
    id: matchId,
    game: opts.game,
    status: opts.withBots ? "live" : "pending",
    created_by: opts.userId,
    winner_id: null,
    winning_team: null,
    is_public: opts.isPublic ?? true,
    created_at: now(),
    updated_at: now(),
    finished_at: null,
  });

  if (opts.game === "spades") {
    await sb.from("match_players").insert({
      match_id: matchId, user_id: opts.userId, seat: 0, team: 1, is_bot: false, result: null,
    });
    const botSeats = opts.withBots ? [1, 2, 3] : [];
    for (const seat of botSeats) {
      await sb.from("match_players").insert({
        match_id: matchId, user_id: `bot:${seat}`, seat, team: seat % 2 === 0 ? 1 : 2,
        is_bot: true, result: null,
      });
    }
    await sb.from("spades_games").insert({
      id: newId(), match_id: matchId,
      state: opts.withBots
        ? { ...initGameState(0), bots: botSeats, rematch: [] }
        : {
          ...initGameState(0), bots: [], rematch: [], phase: "bidding",
          lobby: { ...emptyLobby(), search: !!opts.search },
        },
      team1_score: 0, team2_score: 0, team1_bags: 0, team2_bags: 0,
      current_round: 1, updated_at: now(),
    });
  } else {
    const iAmWhite = Math.random() < 0.5;
    await sb.from("match_players").insert({
      match_id: matchId, user_id: opts.userId, seat: iAmWhite ? 0 : 1, team: null, is_bot: false, result: null,
    });
    if (opts.withBots) {
      await sb.from("match_players").insert({
        match_id: matchId, user_id: "bot:1", seat: iAmWhite ? 1 : 0, team: null, is_bot: true, result: null,
      });
    }
    await sb.from("chess_games").insert({
      id: newId(), match_id: matchId,
      white_id: iAmWhite ? opts.userId : opts.withBots ? "bot:1" : null,
      black_id: iAmWhite ? (opts.withBots ? "bot:1" : null) : opts.userId,
      fen: START_FEN, pgn: "", last_move: null, draw_offer: null,
      bot_level: opts.withBots ? (opts.botLevel ?? "medium") : null,
      result: null, end_reason: null, updated_at: now(),
    });
  }
  return matchId;
}

/** Take the next free seat. Returns false when someone got there first. */
export async function joinMatch(sb: Backend, matchId: string, userId: string): Promise<boolean> {
  const { data: matchRow } = await sb.from("matches").select("*").eq("id", matchId).maybeSingle();
  const match = matchRow as Match | null;
  if (!match) return false;

  const { data: seatRows } = await sb.from("match_players").select("*").eq("match_id", matchId);
  const seats = (seatRows ?? []) as MatchPlayer[];
  if (seats.some((s) => s.user_id === userId)) return true; // already sitting here

  const capacity = match.game === "spades" ? 4 : 2;
  const taken = new Set(seats.map((s) => s.seat));
  const seat = Array.from({ length: capacity }, (_, i) => i).find((s) => !taken.has(s));
  if (seat === undefined) return false;

  const { error } = await sb.from("match_players").insert({
    match_id: matchId, user_id: userId, seat,
    team: match.game === "spades" ? (seat % 2 === 0 ? 1 : 2) : null,
    is_bot: false, result: null,
  });
  if (error) return false;

  const full = seats.length + 1 >= capacity;
  if (match.game === "chess") {
    const { data: gameRow } = await sb.from("chess_games").select("*").eq("match_id", matchId).maybeSingle();
    if (gameRow) {
      const column = gameRow.white_id ? "black_id" : "white_id";
      await sb.from("chess_games").update({ [column]: userId, updated_at: now() }).eq("id", gameRow.id);
    }
  }
  // A full spades table stays "pending" for a moment: the waiting room deals a
  // fresh four-person game and marks it live (hooks/useSpades.ts). Chess has
  // nothing to decide, so it goes live at once.
  if (full && match.game === "chess") {
    await sb.from("matches").update({ status: "live", updated_at: now() }).eq("id", matchId);
  } else {
    await sb.from("matches").update({ updated_at: now() }).eq("id", matchId);
  }
  return true;
}

/**
 * "Find real players": sit at the best waiting spades table, or open one and
 * wait there. Returns the table's id either way.
 */
export async function findSpadesTable(sb: Backend, userId: string): Promise<{ matchId: string; joined: boolean }> {
  const open = await loadOpenTables(sb);
  const order = tablesToJoin(open.map((t) => ({
    id: t.match.id,
    game: t.match.game,
    status: t.match.status,
    isPublic: t.match.is_public,
    createdAt: t.match.created_at,
    updatedAt: t.match.updated_at,
    humanIds: t.players.filter((p) => !p.is_bot).map((p) => p.user_id),
    seatsFree: t.seatsFree,
  })), userId, Date.now());
  for (const id of order) {
    if (await joinMatch(sb, id, userId)) return { matchId: id, joined: true };
  }
  const matchId = await createMatch(sb, { game: "spades", userId, isPublic: true, search: true });
  return { matchId, joined: false };
}

export interface FinishSeat {
  userId: string;
  isBot: boolean;
  result: SeatResult;
}

/**
 * Close a match and write one result per seat. Guarded on the match still
 * being open, so two browsers finishing the same game cannot double-count it
 * on the leaderboard.
 */
export async function finishMatch(
  sb: Backend,
  matchId: string,
  seats: FinishSeat[],
  opts: { winnerId?: string | null; winningTeam?: number | null } = {},
): Promise<boolean> {
  const finishedAt = now();
  const { data } = await sb.from("matches")
    .update({
      status: "done",
      winner_id: opts.winnerId ?? null,
      winning_team: opts.winningTeam ?? null,
      finished_at: finishedAt,
      updated_at: finishedAt,
    })
    .eq("id", matchId).neq("status", "done")
    .select("*");

  const closed = Array.isArray(data) ? data.length > 0 : !!data;
  if (!closed) return false; // somebody else already scored it

  for (const seat of seats) {
    await sb.from("match_players").update({ result: seat.result })
      .eq("match_id", matchId).eq("user_id", seat.userId);
  }

  const winner = seats.find((s) => s.result === "win" && !s.isBot);
  if (winner) {
    const { data: matchRow } = await sb.from("matches").select("*").eq("id", matchId).maybeSingle();
    await recordActivity(sb, {
      kind: "match_won",
      actor_id: winner.userId,
      subject_id: matchId,
      summary: `won a game of ${(matchRow as Match | null)?.game ?? "cards"}`,
    });
  }
  return true;
}

/** Leaving a table that never started just frees the seat. */
export async function leaveMatch(sb: Backend, matchId: string, userId: string) {
  await sb.from("match_players").delete().eq("match_id", matchId).eq("user_id", userId);
  const { data: seatRows } = await sb.from("match_players").select("*").eq("match_id", matchId);
  const remaining = ((seatRows ?? []) as MatchPlayer[]).filter((s) => !s.is_bot);
  if (remaining.length === 0) {
    await sb.from("matches").update({ status: "abandoned", updated_at: now() }).eq("id", matchId);
  }
}
