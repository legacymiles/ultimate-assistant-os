"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Chess } from "chess.js";
import type { EngineMove, Level } from "../chessAi";
import { sounds } from "../sounds";
import { finishMatch, START_FEN } from "../matches";
import { loadProfiles, type ProfileMap } from "../social";
import type { ChessGame, Match, MatchPlayer } from "../types";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Backend = any;

export interface MoveInput { from: string; to: string; promotion?: string }

const BOT_ID = "bot:1";
/** Long enough that the reply reads as a decision rather than a reflex. */
const BOT_MIN_THINK_MS = 450;

function outcome(game: Chess): { result: string; reason: string } | null {
  if (game.isCheckmate()) return { result: game.turn() === "w" ? "0-1" : "1-0", reason: "checkmate" };
  if (game.isStalemate()) return { result: "1/2-1/2", reason: "stalemate" };
  if (game.isThreefoldRepetition()) return { result: "1/2-1/2", reason: "repetition" };
  if (game.isInsufficientMaterial()) return { result: "1/2-1/2", reason: "insufficient material" };
  if (game.isDraw()) return { result: "1/2-1/2", reason: "the fifty-move rule" };
  return null;
}

/** Runs the engine in a worker, falling back to this thread if one won't start. */
function useEngine() {
  const workerRef = useRef<Worker | null>(null);
  const pending = useRef(new Map<number, (move: EngineMove | null) => void>());
  const nextId = useRef(1);

  useEffect(() => {
    try {
      const worker = new Worker(new URL("../chessAi.worker.ts", import.meta.url));
      worker.onmessage = (e: MessageEvent<{ id: number; move: EngineMove | null }>) => {
        pending.current.get(e.data.id)?.(e.data.move);
        pending.current.delete(e.data.id);
      };
      workerRef.current = worker;
    } catch {
      workerRef.current = null; // no worker here; we'll think on the main thread
    }
    return () => { workerRef.current?.terminate(); workerRef.current = null; };
  }, []);

  return useCallback(async (fen: string, level: Level): Promise<EngineMove | null> => {
    const worker = workerRef.current;
    if (!worker) {
      const { findBestMove } = await import("../chessAi");
      return findBestMove(fen, level);
    }
    const id = nextId.current++;
    return new Promise((resolve) => {
      pending.current.set(id, resolve);
      worker.postMessage({ id, fen, level });
    });
  }, []);
}

export function useChess(sb: Backend, userId: string | null, matchId: string | undefined) {
  const [match, setMatch] = useState<Match | null>(null);
  const [row, setRow] = useState<ChessGame | null>(null);
  const [seats, setSeats] = useState<MatchPlayer[]>([]);
  const [profiles, setProfiles] = useState<ProfileMap>({});
  const [loading, setLoading] = useState(true);
  const [notice, setNotice] = useState<string | null>(null);
  const [thinking, setThinking] = useState(false);
  const think = useEngine();

  const load = useCallback(async () => {
    if (!matchId) return;
    const [matchRes, gameRes, seatRes] = await Promise.all([
      sb.from("matches").select("*").eq("id", matchId).maybeSingle(),
      sb.from("chess_games").select("*").eq("match_id", matchId).maybeSingle(),
      sb.from("match_players").select("*").eq("match_id", matchId),
    ]);
    if (matchRes.data) setMatch(matchRes.data as Match);
    if (gameRes.data) setRow(gameRes.data as ChessGame);
    const rows = (seatRes.data ?? []) as MatchPlayer[];
    setSeats(rows);
    setProfiles(await loadProfiles(sb, rows.filter((r) => !r.is_bot).map((r) => r.user_id)));
    setLoading(false);
  }, [sb, matchId]);

  useEffect(() => { void load(); }, [load]);

  useEffect(() => {
    if (!matchId) return;
    const channel = sb.channel(`chess:${matchId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "cook", table: "chess_games", filter: `match_id=eq.${matchId}` },
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (payload: any) => { if (payload.new?.id) setRow(payload.new as ChessGame); },
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "cook", table: "matches", filter: `id=eq.${matchId}` },
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (payload: any) => { if (payload.new?.id) setMatch(payload.new as Match); },
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "cook", table: "match_players", filter: `match_id=eq.${matchId}` },
        () => { void load(); },
      )
      .subscribe();
    return () => { sb.removeChannel(channel); };
  }, [sb, matchId, load]);

  const game = useMemo(() => new Chess(row?.fen ?? START_FEN), [row?.fen]);

  // The move list has to come from the PGN: a board rebuilt from a FEN alone
  // knows the position but has no history behind it.
  const moves = useMemo(() => {
    if (!row?.pgn) return [];
    try {
      const replay = new Chess();
      replay.loadPgn(row.pgn);
      return replay.history();
    } catch {
      return [];
    }
  }, [row?.pgn]);
  const myColor: "w" | "b" | null = !row || !userId
    ? null
    : row.white_id === userId ? "w" : row.black_id === userId ? "b" : null;
  const isOver = match?.status === "done";
  const vsBot = !!row?.bot_level;

  const nameFor = useCallback((id: string | null): string => {
    if (!id) return "Open seat";
    if (id.startsWith("bot:")) return `Computer${row?.bot_level ? ` · ${row.bot_level}` : ""}`;
    return profiles[id]?.display_name ?? "Member";
  }, [profiles, row?.bot_level]);

  /** Guarded write: only lands if the board hasn't changed since we saw it. */
  const write = useCallback(async (patch: Partial<ChessGame>, expectFen?: string): Promise<boolean> => {
    if (!row) return false;
    let query = sb.from("chess_games")
      .update({ ...patch, updated_at: new Date().toISOString() })
      .eq("id", row.id);
    if (expectFen) query = query.eq("fen", expectFen);
    const { data, error } = await query.select("*");
    if (error) {
      setNotice(`Couldn't save that move: ${error.message}`);
      return false;
    }
    const saved = (data as ChessGame[] | null)?.[0];
    if (saved) { setRow(saved); return true; }
    void load(); // somebody moved first
    return false;
  }, [sb, row, load]);

  /** Close the match once, writing one result per seat. */
  const closeOut = useCallback(async (result: string) => {
    if (!matchId || !row) return;
    const white = row.white_id;
    const black = row.black_id;
    const resultFor = (id: string | null): "win" | "loss" | "draw" => {
      if (result === "1/2-1/2") return "draw";
      const whiteWon = result === "1-0";
      return (whiteWon ? id === white : id === black) ? "win" : "loss";
    };
    const seatList = [white, black].filter(Boolean).map((id) => ({
      userId: id as string,
      isBot: (id as string).startsWith("bot:"),
      result: resultFor(id),
    }));
    const winnerId = result === "1/2-1/2" ? null : result === "1-0" ? white : black;
    await finishMatch(sb, matchId, seatList, {
      winnerId: winnerId && !winnerId.startsWith("bot:") ? winnerId : null,
    });
    if (myColor) {
      const mine = resultFor(myColor === "w" ? white : black);
      if (mine === "win") sounds.gameWin();
      else if (mine === "loss") sounds.gameLose();
    }
  }, [sb, matchId, row, myColor]);

  // The optimistic update below puts a row in state whose fen has moved on but
  // whose pgn has not, and a later call must not rebuild the game from that.
  // The ref always holds the newest row, and the write result overwrites it
  // with the authoritative one.
  const rowRef = useRef<ChessGame | null>(null);
  rowRef.current = row;

  /** Apply a move from either a person or the engine. */
  const applyMove = useCallback(async (m: MoveInput, asColor: "w" | "b"): Promise<boolean> => {
    const current = rowRef.current;
    if (!current || isOver) return false;
    // Rebuild from the PGN so repetition draws see the whole game.
    const next = new Chess();
    try {
      if (current.pgn) next.loadPgn(current.pgn);
      else next.load(current.fen);
    } catch {
      next.load(current.fen);
    }
    // A pgn that has fallen behind the fen would replay to the wrong position.
    if (next.fen() !== current.fen) next.load(current.fen);
    if (next.turn() !== asColor) return false;

    let played;
    try {
      played = next.move({ from: m.from, to: m.to, promotion: m.promotion });
    } catch {
      return false;
    }
    if (!played) return false;

    const end = outcome(next);
    const patch = {
      fen: next.fen(),
      pgn: next.pgn(),
      last_move: { from: played.from, to: played.to, san: played.san },
      draw_offer: null,
      ...(end ? { result: end.result, end_reason: end.reason } : {}),
    };

    sounds.pieceMove();
    // Optimistic: show it now, the write confirms it. The pgn goes in too, so
    // the row in hand never describes two different positions at once.
    const optimistic = { ...current, ...patch } as ChessGame;
    rowRef.current = optimistic;
    setRow(optimistic);

    const ok = await write(patch, current.fen);
    if (!ok) { void load(); return false; }
    if (end) await closeOut(end.result);
    return true;
  }, [isOver, write, load, closeOut]);

  const move = useCallback((m: MoveInput): boolean => {
    if (!row || isOver || !myColor || game.turn() !== myColor) return false;
    void applyMove(m, myColor);
    return true;
  }, [row, isOver, myColor, game, applyMove]);

  // The computer's turn. Only the person sitting opposite it drives the engine,
  // so a spectator never moves for it.
  const lastBotFen = useRef("");
  useEffect(() => {
    if (!row || !vsBot || isOver || !myColor) return;
    const botColor = row.white_id === BOT_ID ? "w" : row.black_id === BOT_ID ? "b" : null;
    if (!botColor || game.turn() !== botColor) return;
    const askedAbout = row.fen;
    if (lastBotFen.current === askedAbout) return;
    lastBotFen.current = askedAbout;

    setThinking(true);
    const started = Date.now();
    // No cleanup cancel here on purpose. The confirmed write re-renders with
    // the same position, and cancelling on every re-render would throw away
    // the reply we are waiting for. Staleness is decided by the board itself:
    // the move is played only if nothing has moved since we asked.
    void think(askedAbout, (row.bot_level ?? "medium") as Level).then(async (best) => {
      const wait = Math.max(0, BOT_MIN_THINK_MS - (Date.now() - started));
      await new Promise((r) => setTimeout(r, wait));
      if (best && rowRef.current?.fen === askedAbout) await applyMove(best, botColor);
      setThinking(false);
    });
  }, [row, vsBot, isOver, myColor, game, think, applyMove]);

  const resign = useCallback(async () => {
    if (!row || !myColor || isOver) return;
    const result = myColor === "w" ? "0-1" : "1-0";
    const ok = await write({ result, end_reason: "resignation" });
    if (ok) await closeOut(result);
  }, [row, myColor, isOver, write, closeOut]);

  const offerDraw = useCallback(async () => {
    if (!row || !userId || isOver) return;
    await write({ draw_offer: userId });
    setNotice("Draw offered. Your opponent can accept or play on.");
  }, [row, userId, isOver, write]);

  const answerDraw = useCallback(async (accept: boolean) => {
    if (!row || isOver) return;
    if (!accept) { await write({ draw_offer: null }); return; }
    const ok = await write({ result: "1/2-1/2", end_reason: "agreement", draw_offer: null });
    if (ok) await closeOut("1/2-1/2");
  }, [row, isOver, write, closeOut]);

  const status = (() => {
    if (!row) return "";
    if (isOver || row.result) {
      const who = row.result === "1-0" ? nameFor(row.white_id)
        : row.result === "0-1" ? nameFor(row.black_id) : null;
      if (!who) return `Drawn by ${row.end_reason ?? "agreement"}.`;
      return `${who} won by ${row.end_reason ?? "resignation"}.`;
    }
    if (!row.white_id || !row.black_id) return "Waiting for an opponent.";
    const turnName = game.turn() === "w" ? nameFor(row.white_id) : nameFor(row.black_id);
    const check = game.inCheck() ? " — in check" : "";
    return myColor && game.turn() === myColor ? `Your move${check}.` : `${turnName} to move${check}.`;
  })();

  return {
    match, row, game, moves, seats, profiles, loading, notice, setNotice, thinking,
    myColor, isOver, vsBot, status, nameFor,
    move, resign, offerDraw, answerDraw, reload: load,
  };
}
