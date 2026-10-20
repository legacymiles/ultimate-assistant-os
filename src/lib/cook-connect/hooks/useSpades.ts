"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  type GameState, initGameState, isValidPlay, determineTrickWinner,
  calculateRoundScore, applyRoundScore, nextSeat, getSuit, getTeam, recapRound,
} from "../spades";
import { botName, chooseBid, chooseCard } from "../spadesBot";
import { sounds } from "../sounds";
import { finishMatch, joinMatch, leaveMatch, loadOpenTables } from "../matches";
import { loadProfiles, type ProfileMap } from "../social";
import {
  HEARTBEAT_MS, awayUsers, castVote, emptyLobby, isClaimFresh, lobbyView, planBotSeats,
  seatResults, tablesToJoin, withdrawVote, type LobbySeat,
} from "../lobby";
import {
  botNotices, canAccuse, canPlay, completeEvidence, recordPlay, resolveCall,
} from "../renege";
import type { Match, MatchPlayer, SpadesGame } from "../types";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Backend = any;

const BOT_DELAY_MS = 1100;
/** Longer before leading, so a finished trick gets its moment on screen. */
const BOT_LEAD_DELAY_MS = BOT_DELAY_MS + 1400;
/** How often a lone searcher looks for an older waiting table to merge into. */
const MERGE_CHECK_MS = 6000;

export interface SeatView {
  seat: number;
  userId: string;
  team: number;
  isBot: boolean;
  name: string;
  avatar: string | null;
  online: boolean;
}

const nowIso = () => new Date().toISOString();

/**
 * Everything a new hand or a new game carries over from the last one. Without
 * this the table would forget who the computers are, where people moved to,
 * and the secret renig record.
 */
function carry(state: GameState, opts: { newGame?: boolean } = {}): Partial<GameState> {
  return {
    bots: state.bots ?? [],
    rematch: [],
    seatOverrides: state.seatOverrides,
    botPartners: state.botPartners ?? [],
    reneges: opts.newGame ? [] : state.reneges ?? [],
    renigCall: null,
    lobby: emptyLobby(),
  };
}

/** A fresh deal for the people listed, with the computer in `botSeats`. */
function freshDeal(s: GameState, botSeats: number[], partner: string | null): GameState {
  return {
    ...initGameState(Math.floor(Math.random() * 4)),
    bots: botSeats,
    rematch: [],
    lobby: emptyLobby(),
    botPartners: partner ? [...(s.botPartners ?? []), partner] : s.botPartners ?? [],
    reneges: [],
    renigCall: null,
  };
}

export function useSpades(sb: Backend, userId: string | null, matchId: string | undefined) {
  const [match, setMatch] = useState<Match | null>(null);
  const [game, setGame] = useState<SpadesGame | null>(null);
  const [rows, setRows] = useState<MatchPlayer[]>([]);
  const [profiles, setProfiles] = useState<ProfileMap>({});
  const [online, setOnline] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [notice, setNotice] = useState<string | null>(null);
  /** "Renig" pressed: every card in my hand is playable. Lives on this screen only. */
  const [unlocked, setUnlocked] = useState(false);
  /** Set when matchmaking moved me to another table. */
  const [movedTo, setMovedTo] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [clock, setClock] = useState(() => Date.now());
  const openedAt = useRef(Date.now());
  const lastSeen = useRef<Record<string, number>>({});

  const state = (game?.state as GameState | undefined)?.phase ? (game!.state as GameState) : null;
  const bots = useMemo(() => state?.bots ?? [], [state]);
  const pending = match?.status === "pending";

  const fetchAll = useCallback(async () => {
    if (!matchId) return;
    const [matchRes, gameRes, seatRes] = await Promise.all([
      sb.from("matches").select("*").eq("id", matchId).maybeSingle(),
      sb.from("spades_games").select("*").eq("match_id", matchId).maybeSingle(),
      sb.from("match_players").select("*").eq("match_id", matchId),
    ]);
    if (matchRes.data) setMatch(matchRes.data as Match);
    if (gameRes.data) setGame(gameRes.data as SpadesGame);
    const list = (seatRes.data ?? []) as MatchPlayer[];
    setRows(list);
    setProfiles(await loadProfiles(sb, list.filter((r) => !r.is_bot).map((r) => r.user_id)));
    setLoading(false);
  }, [sb, matchId]);

  useEffect(() => { void fetchAll(); }, [fetchAll]);

  // Realtime: the board, the seats, and who currently has the table open.
  useEffect(() => {
    if (!matchId || !userId) return;
    const channel = sb
      .channel(`spades:${matchId}`, { config: { presence: { key: userId } } })
      .on(
        "postgres_changes",
        { event: "*", schema: "cook", table: "spades_games", filter: `match_id=eq.${matchId}` },
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (payload: any) => { if (payload.new?.id) setGame(payload.new as SpadesGame); },
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "cook", table: "match_players", filter: `match_id=eq.${matchId}` },
        () => { void fetchAll(); },
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "cook", table: "matches", filter: `id=eq.${matchId}` },
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (payload: any) => { if (payload.new?.id) setMatch(payload.new as Match); },
      )
      .on("presence", { event: "sync" }, () => {
        const ids = Object.keys(channel.presenceState());
        const t = Date.now();
        for (const id of ids) lastSeen.current[id] = t;
        setOnline(new Set(ids));
      })
      .subscribe((status: string) => {
        if (status === "SUBSCRIBED") void channel.track({ at: Date.now() });
      });
    return () => { sb.removeChannel(channel); };
  }, [sb, matchId, userId, fetchAll]);

  // While people are deciding, keep a clock running so "away" and claims expire
  // on their own, and remember when everyone was last connected.
  useEffect(() => {
    if (!pending) return;
    const timer = setInterval(() => {
      const t = Date.now();
      online.forEach((id) => { lastSeen.current[id] = t; });
      setClock(t);
    }, 2000);
    return () => clearInterval(timer);
  }, [pending, online]);

  /**
   * Write a new board. `updated_at` doubles as a version: the write only lands
   * if nobody changed the game since we read it, so two browsers can never both
   * apply a move or both deal a hand.
   */
  const commit = useCallback(async (
    patch: Partial<SpadesGame> & { state?: GameState },
    base: SpadesGame | null = game,
  ): Promise<boolean> => {
    if (!base) return false;
    const { data, error } = await sb.from("spades_games")
      .update({ ...patch, updated_at: nowIso() })
      .eq("id", base.id).eq("updated_at", base.updated_at)
      .select("*");
    if (error) {
      setNotice("That move didn't save. Check your connection and try again.");
      return false;
    }
    const row = (data as SpadesGame[] | null)?.[0];
    if (row) { setGame(row); return true; }

    // Nothing was written: either someone moved first, or this database returns
    // timestamps in a different format than it stores them. Find out which.
    const { data: fresh } = await sb.from("spades_games").select("*").eq("id", base.id).maybeSingle();
    if (fresh && (fresh as SpadesGame).updated_at === base.updated_at) {
      const { data: retry } = await sb.from("spades_games")
        .update({ ...patch, updated_at: nowIso() })
        .eq("id", base.id).select("*");
      const retried = (retry as SpadesGame[] | null)?.[0];
      if (retried) { setGame(retried); return true; }
    }
    if (fresh) setGame(fresh as SpadesGame); // someone beat us to it; resync
    return false;
  }, [sb, game]);

  /**
   * Read the newest board, change it, write it back — retrying if someone else
   * wrote in between. `change` returns null to give up.
   */
  const updateState = useCallback(async (change: (s: GameState) => GameState | null): Promise<boolean> => {
    if (!matchId) return false;
    for (let attempt = 0; attempt < 4; attempt++) {
      const { data } = await sb.from("spades_games").select("*").eq("match_id", matchId).maybeSingle();
      const fresh = data as SpadesGame | null;
      if (!fresh) return false;
      const next = change(fresh.state as GameState);
      if (!next) return false;
      if (await commit({ state: next }, fresh)) return true;
    }
    return false;
  }, [sb, matchId, commit]);

  /* ── Seats ────────────────────────────────────────────────────── */

  const humanRows = rows.filter((s) => !s.is_bot);
  /** Where a person sits now. A rotation between games is written to the game first. */
  const seatOf = useCallback(
    (row: MatchPlayer) => state?.seatOverrides?.[row.user_id] ?? row.seat,
    [state],
  );
  const myRow = humanRows.find((s) => s.user_id === userId);
  const myRowSeat = myRow ? seatOf(myRow) : -1;
  const iLeft = !!myRow && !pending && bots.includes(myRowSeat);
  const mySeat = iLeft ? -1 : myRowSeat;

  /** The table as it is shown: humans in their seats, computers in the rest. */
  const table: SeatView[] = [0, 1, 2, 3].map((seat) => {
    const row = humanRows.find((s) => seatOf(s) === seat);
    if (bots.includes(seat) && !pending) {
      return {
        seat, userId: `bot:${seat}`, team: getTeam(seat), isBot: true,
        name: botName(seat), avatar: null, online: true,
      };
    }
    if (!row) {
      const botRow = rows.find((s) => s.is_bot && s.seat === seat);
      if (botRow && !pending) {
        return { seat, userId: botRow.user_id, team: getTeam(seat), isBot: true, name: botName(seat), avatar: null, online: true };
      }
      return { seat, userId: "", team: getTeam(seat), isBot: false, name: "Open seat", avatar: null, online: false };
    }
    const p = profiles[row.user_id];
    return {
      seat, userId: row.user_id, team: getTeam(seat), isBot: false,
      name: p?.display_name ?? "Member", avatar: p?.avatar_url ?? null,
      online: online.has(row.user_id) || row.user_id === userId,
    };
  });
  const nameOfSeat = useCallback(
    (seat: number) => table.find((t) => t.seat === seat)?.name.split(" ")[0] ?? "Someone",
    [table],
  );

  /* ── The waiting room ─────────────────────────────────────────── */

  const lobbySeats: LobbySeat[] = humanRows.map((r) => ({ userId: r.user_id, seat: r.seat }));
  const away = pending
    ? awayUsers(lobbySeats, online, lastSeen.current, openedAt.current, clock, userId)
    : [];
  const lobby = lobbyView({ humans: lobbySeats, lobby: state?.lobby, away, me: userId });
  const firstName = useCallback(
    (id: string) => (id === userId ? "You" : (profiles[id]?.display_name ?? "Member").split(" ")[0]),
    [profiles, userId],
  );
  const startClaim = state?.lobby?.starting ?? null;
  const starting = pending && isClaimFresh(startClaim, clock);
  /** The one browser that runs the waiting room: the lowest-seated person who is here. */
  const lead = [...lobbySeats]
    .filter((h) => !away.includes(h.userId))
    .sort((a, b) => a.seat - b.seat)[0];
  const iLead = !!userId && lead?.userId === userId;

  /** "Play with bots" / "Play bots now". */
  const agreeToBots = useCallback(async () => {
    if (!userId || !pending) return;
    const ok = await updateState((s) => ({
      ...s, lobby: castVote(s.lobby, userId, humanRows.length),
    }));
    if (!ok) setNotice("Couldn't save your choice. Try again.");
  }, [userId, pending, updateState, humanRows.length]);

  /** "Keep waiting": take back a vote for computer players. */
  const keepWaiting = useCallback(async () => {
    if (!userId || !pending) return;
    await updateState((s) => ((s.lobby?.votes ?? []).some((v) => v.userId === userId)
      ? { ...s, lobby: withdrawVote(s.lobby, userId) }
      : null));
  }, [userId, pending, updateState]);

  /**
   * Flip the table from waiting to live, once. Guarded on it still waiting, so
   * two browsers can never both do it.
   */
  const goLive = useCallback(async (): Promise<boolean> => {
    if (!matchId) return false;
    const { data } = await sb.from("matches")
      .update({ status: "live", updated_at: nowIso() })
      .eq("id", matchId).eq("status", "pending")
      .select("*");
    const row = Array.isArray(data) ? (data[0] as Match | undefined) : (data as Match | null);
    if (row) setMatch(row);
    return !!row;
  }, [sb, matchId]);

  /**
   * Four people are seated: deal a normal game, no computers. Going live is
   * guarded on the table still waiting, so only one browser deals. The board
   * made when the table opened is already a valid deal, so a browser closing
   * between the two steps still leaves a playable game.
   */
  const dealFourHumans = useCallback(async () => {
    if (!matchId) return;
    const { data } = await sb.from("spades_games").select("*").eq("match_id", matchId).maybeSingle();
    const current = (data as SpadesGame | null)?.state as GameState | undefined;
    // Someone else is mid-start; they will see the fourth person and deal for four.
    if (isClaimFresh(current?.lobby?.starting, Date.now()) && current?.lobby?.starting?.by !== userId) return;
    if (await goLive()) await updateState((s) => freshDeal(s, [], null));
  }, [sb, matchId, updateState, userId, goLive]);

  /**
   * Everyone at the table agreed: seat people so that two players are on
   * opposite teams, or three share the table with one computer, and deal.
   * One browser claims the start first, so the table is set up exactly once.
   * The board is dealt before the table goes live, so a browser that closes
   * halfway leaves a table that is simply still waiting.
   */
  const startWithBots = useCallback(async () => {
    if (!userId || !matchId) return;
    const claimed = await updateState((s) => {
      if (isClaimFresh(s.lobby?.starting, Date.now())) return null;
      return { ...s, lobby: { ...(s.lobby ?? emptyLobby()), starting: { by: userId, at: Date.now() } } };
    });
    if (!claimed) return;
    const release = () => updateState((s) => (s.lobby?.starting?.by === userId
      ? { ...s, lobby: { ...s.lobby!, starting: null } }
      : null));

    // Look at who is really here right now, not who was here a moment ago.
    const { data: seatData } = await sb.from("match_players").select("*").eq("match_id", matchId);
    const fresh = ((seatData ?? []) as MatchPlayer[]).filter((r) => !r.is_bot);
    const { data: gameData } = await sb.from("spades_games").select("*").eq("match_id", matchId).maybeSingle();
    const freshState = (gameData as SpadesGame | null)?.state as GameState | undefined;

    if (fresh.length >= 4) {
      // A fourth person sat down while the others were deciding: four people play.
      if (await goLive()) await updateState((s) => freshDeal(s, [], null));
      return;
    }
    const humans = fresh.map((r) => ({ userId: r.user_id, seat: r.seat }));
    const freshAway = awayUsers(humans, online, lastSeen.current, openedAt.current, Date.now(), userId);
    const check = lobbyView({ humans, lobby: freshState?.lobby, away: freshAway, me: userId });
    if (!check.everyoneAgreed) { await release(); return; } // someone new gets a say

    const plan = planBotSeats(humans, freshState?.botPartners ?? []);
    for (const id of plan.moved) {
      const { error } = await sb.from("match_players")
        .update({ seat: plan.seats[id], team: getTeam(plan.seats[id]) })
        .eq("match_id", matchId).eq("user_id", id);
      if (error) {
        await release();
        setNotice("Someone sat down just as the game was starting. Have another look at the table.");
        await fetchAll();
        return;
      }
    }
    // Anyone who stepped away keeps their seat, held by a computer until they come back.
    const heldSeats = check.away.map((id) => plan.seats[id]);
    let botSeats = [...new Set([...plan.botSeats, ...heldSeats])].sort((x, y) => x - y);
    const dealt = await updateState((s) => freshDeal(s, botSeats, plan.botPartner));
    if (!dealt) { await release(); return; }

    // Seat rows for the computers, so the lobby lists the table as full. They
    // only go into seats nobody has: a person who sat down in the last second
    // keeps the seat, and plays it instead of the computer.
    const { data: after } = await sb.from("match_players").select("*").eq("match_id", matchId);
    const afterRows = (after ?? []) as MatchPlayer[];
    const humanAt = new Set(afterRows.filter((r) => !r.is_bot).map((r) => r.seat));
    const taken = new Set(afterRows.map((r) => r.seat));
    for (const seat of plan.botSeats) {
      if (taken.has(seat)) continue;
      await sb.from("match_players").insert({
        match_id: matchId, user_id: `bot:${seat}`, seat, team: getTeam(seat), is_bot: true, result: null,
      });
    }
    const lateJoiners = plan.botSeats.filter((seat) => humanAt.has(seat));
    if (lateJoiners.length) {
      botSeats = botSeats.filter((seat) => !lateJoiners.includes(seat));
      await updateState((s) => ({ ...s, bots: botSeats }));
    }
    await goLive();
    const added = botSeats.length - heldSeats.length;
    if (added > 0) {
      setNotice(added === 1 ? "One computer player joined the table." : `${added} computer players joined the table.`);
    }
    await fetchAll();
  }, [sb, userId, matchId, updateState, online, fetchAll, goLive]);

  // The waiting room runs itself: deal when four are here, start with
  // computers once everyone agrees. Any seated browser may do it — the lead
  // goes first, the rest a moment later in case the lead's tab is asleep — and
  // the claim and the "still waiting" guard make sure it happens once.
  const running = useRef(false);
  const lastAttempt = useRef(0);
  const readySince = useRef<number | null>(null);
  const ready = humanRows.length >= 4 || lobby.everyoneAgreed;
  if (!ready) readySince.current = null;
  else if (readySince.current === null) readySince.current = Date.now();
  useEffect(() => {
    if (!pending || !state || !myRow || running.current) return;
    if (!iLead && Date.now() - (readySince.current ?? Date.now()) < 4000) return;
    if (starting && startClaim?.by !== userId) return;
    // A start that backed off (someone new sat down) waits a beat for the
    // table to catch up instead of trying again in a tight loop.
    if (Date.now() - lastAttempt.current < 2500) return;
    let job: (() => Promise<void>) | null = null;
    if (humanRows.length >= 4) job = dealFourHumans;
    else if (lobby.everyoneAgreed && !starting) job = startWithBots;
    if (!job) return;
    lastAttempt.current = Date.now();
    running.current = true;
    setBusy(true);
    void job().finally(() => { running.current = false; setBusy(false); });
  }, [pending, state, myRow, iLead, starting, startClaim, userId, humanRows.length, lobby.everyoneAgreed, dealFourHumans, startWithBots, clock]);

  // Tell matchmaking this table is still being watched.
  useEffect(() => {
    if (!pending || !iLead || !match) return;
    const beat = () => void sb.from("matches").update({ updated_at: nowIso() }).eq("id", match.id).eq("status", "pending");
    const timer = setInterval(beat, HEARTBEAT_MS);
    return () => clearInterval(timer);
  }, [sb, pending, iLead, match]);

  // Two people who searched at the same moment each open a table. The one
  // with the newer table moves to the older one, so they meet.
  const lonelySearch = pending && humanRows.length === 1 && myRow && !!state?.lobby?.search
    && (state?.lobby?.votes ?? []).length === 0;
  useEffect(() => {
    if (!lonelySearch || !match || !userId) return;
    let cancelled = false;
    const timer = setInterval(async () => {
      const open = await loadOpenTables(sb);
      if (cancelled) return;
      const summaries = open.map((t) => ({
        id: t.match.id, game: t.match.game, status: t.match.status, isPublic: t.match.is_public,
        createdAt: t.match.created_at, updatedAt: t.match.updated_at,
        humanIds: t.players.filter((p) => !p.is_bot).map((p) => p.user_id), seatsFree: t.seatsFree,
      }));
      const older = new Set(summaries
        .filter((t) => t.id !== match.id
          && (t.createdAt < match.created_at || (t.createdAt === match.created_at && t.id < match.id)))
        .map((t) => t.id));
      const target = tablesToJoin(summaries, userId, Date.now()).find((id) => older.has(id));
      if (!target) return;
      if (await joinMatch(sb, target, userId)) {
        await leaveMatch(sb, match.id, userId);
        if (!cancelled) setMovedTo(target);
      }
    }, MERGE_CHECK_MS);
    return () => { cancelled = true; clearInterval(timer); };
  }, [sb, lonelySearch, match, userId]);

  /* ── Playing ──────────────────────────────────────────────────── */

  /** Score the finished game once, from whichever browser gets there first. */
  const closeOut = useCallback(async (winningTeam: number, finalBots: number[]) => {
    if (!matchId) return;
    const winnerRow = humanRows.find((s) => !finalBots.includes(seatOf(s)) && getTeam(seatOf(s)) === winningTeam);
    await finishMatch(sb, matchId, seatResults(table, winningTeam), {
      winnerId: winnerRow?.user_id ?? null, winningTeam,
    });
    if (mySeat >= 0) {
      if (getTeam(mySeat) === winningTeam) sounds.gameWin();
      else sounds.gameLose();
    }
  }, [sb, matchId, humanRows, seatOf, table, mySeat]);

  const bidFor = useCallback(async (seat: number, bid: number) => {
    if (!state || !game || state.currentTurn !== seat || state.phase !== "bidding" || pending) return;
    const bids = { ...state.bids, [seat]: bid };
    const allIn = Object.values(bids).every((b) => b !== null);
    await commit({
      state: {
        ...state,
        bids,
        currentTurn: allIn ? state.trickLeader : nextSeat(state.currentTurn),
        phase: allIn ? "playing" : "bidding",
      },
    });
  }, [state, game, pending, commit]);

  const playFor = useCallback(async (seat: number, card: string, opts: { unlocked?: boolean; userId?: string } = {}) => {
    if (!state || !game || !match || state.currentTurn !== seat || state.phase !== "playing") return;
    const hand = state.hands[seat];
    if (!hand?.includes(card)) return;
    if (!canPlay(card, hand, state.currentTrick, state.spadeBroken, !!opts.unlocked)) {
      setNotice("Follow the suit that was led if you can, and don't lead spades until they're broken.");
      return;
    }

    // An illegal play goes through without a word; it is only written down.
    const round = game.current_round;
    let reneges = recordPlay(state.reneges, {
      seat, userId: opts.userId ?? `bot:${seat}`, round, trickNumber: state.trickNumber,
      card, hand, trick: state.currentTrick, spadeBroken: state.spadeBroken,
    });

    const hands = { ...state.hands, [seat]: hand.filter((c) => c !== card) };
    const trick = [...state.currentTrick, { seat, card }];
    const spadeBroken = state.spadeBroken || getSuit(card) === "S";

    if (trick.length < 4) {
      await commit({
        state: { ...state, hands, currentTrick: trick, currentTurn: nextSeat(seat), spadeBroken, reneges },
      });
      return;
    }

    const winner = determineTrickWinner(trick);
    const tricksWon = { ...state.tricksWon, [winner]: (state.tricksWon[winner] || 0) + 1 };
    const trickNumber = state.trickNumber + 1;
    reneges = completeEvidence(reneges, round, state.trickNumber, trick);

    // Now and then a computer on the other team notices. The roll is seeded by
    // the trick, so every browser would reach the same answer.
    const noticed = reneges.length
      ? botNotices(reneges, state.bots ?? [], `${match.id}:${round}:${state.trickNumber}`)
      : null;
    if (noticed) {
      const accused = table.find((t) => t.seat === noticed.accusedSeat);
      const call = resolveCall(
        reneges,
        { seat: noticed.accuserSeat, userId: `bot:${noticed.accuserSeat}` },
        { seat: noticed.accusedSeat, userId: accused?.userId ?? noticed.record.userId },
        { byBot: true },
      );
      const ok = await commit({
        state: {
          ...state, phase: "gameEnd", hands, currentTrick: [], tricksWon, spadeBroken,
          lastTrick: trick, lastTrickWinner: winner, reneges, renigCall: call, rematch: [],
        },
      });
      if (ok) await closeOut(call.winningTeam, state.bots ?? []);
      return;
    }

    if (trickNumber <= 13) {
      await commit({
        state: {
          ...state, hands, currentTrick: [], trickLeader: winner, currentTurn: winner,
          tricksWon, spadeBroken, trickNumber, lastTrick: trick, lastTrickWinner: winner, reneges,
        },
      });
      return;
    }

    // Thirteen tricks played: score the round. A renig is never revealed here;
    // it stays secret, and callable, for the rest of the game.
    const roundScore = calculateRoundScore(state.bids, tricksWon);
    const lastRound = recapRound(round, state.bids, tricksWon);
    const totals = applyRoundScore(
      { team1: game.team1_score, team2: game.team2_score, bags1: game.team1_bags, bags2: game.team2_bags },
      roundScore,
    );
    const scorePatch = {
      team1_score: totals.team1, team2_score: totals.team2,
      team1_bags: totals.bags1, team2_bags: totals.bags2,
    };

    if (totals.gameOver) {
      const ok = await commit({
        ...scorePatch,
        state: {
          ...state, phase: "gameEnd", hands, currentTrick: [], tricksWon, reneges,
          lastTrick: trick, lastTrickWinner: winner, spadeBroken, trickNumber: 14, rematch: [],
          lastRound,
        },
      });
      if (ok) await closeOut(totals.winningTeam, state.bots ?? []);
    } else {
      sounds.roundEnd();
      await commit({
        ...scorePatch,
        current_round: game.current_round + 1,
        state: {
          ...initGameState((state.dealer + 1) % 4),
          ...carry({ ...state, reneges }),
          lastRound,
          // The last trick of the hand still gets its moment on every screen.
          lastTrick: trick,
          lastTrickWinner: winner,
        },
      });
    }
  }, [state, game, match, table, commit, closeOut]);

  const makeBid = useCallback((bid: number) => {
    sounds.bidSubmit();
    return bidFor(mySeat, bid);
  }, [bidFor, mySeat]);

  const playCard = useCallback((card: string) => {
    sounds.cardPlay();
    return playFor(mySeat, card, { unlocked, userId: userId ?? undefined });
  }, [playFor, mySeat, unlocked, userId]);

  // A fresh deal locks the hand again.
  const dealKey = `${match?.id}:${game?.current_round}:${state?.dealer}:${state?.phase === "gameEnd"}`;
  useEffect(() => { setUnlocked(false); }, [dealKey]);

  /** "Call renig" on an opponent. The game ends either way. */
  const callRenig = useCallback(async (accusedSeat: number) => {
    if (!state || !userId || !match || mySeat < 0 || match.status === "done") return;
    if (state.phase !== "bidding" && state.phase !== "playing") return;
    if (!canAccuse(mySeat, accusedSeat)) {
      setNotice("You can only call renig on someone on the other team.");
      return;
    }
    const accused = table.find((t) => t.seat === accusedSeat);
    const call = resolveCall(state.reneges, { seat: mySeat, userId }, { seat: accusedSeat, userId: accused?.userId ?? "" });
    const ok = await commit({ state: { ...state, phase: "gameEnd", renigCall: call, rematch: [] } });
    if (ok) await closeOut(call.winningTeam, bots);
    else setNotice("The table moved on before your call landed. Try again.");
  }, [state, userId, match, mySeat, table, commit, closeOut, bots]);

  // Computer players. One browser drives them: the lowest-seated human who
  // currently has the table open, so the bots keep going if the host leaves.
  const driver = humanRows
    .filter((s) => !bots.includes(seatOf(s)) && (online.has(s.user_id) || s.user_id === userId))
    .sort((a, b) => seatOf(a) - seatOf(b))[0];
  const iDriveBots = !!userId && driver?.user_id === userId;
  const lastBotMove = useRef("");

  useEffect(() => {
    if (!iDriveBots || !state || !game || !match || pending) return;
    if (match.status === "done" || !bots.includes(state.currentTurn)) return;
    if (state.phase !== "bidding" && state.phase !== "playing") return;
    const key = game.updated_at;
    if (lastBotMove.current === key) return;
    const seat = state.currentTurn;
    const leading = state.phase === "playing" && state.currentTrick.length === 0;
    const timer = window.setTimeout(() => {
      lastBotMove.current = key;
      if (state.phase === "bidding") void bidFor(seat, chooseBid(state.hands[seat] ?? []));
      else {
        // Computers always play legally: chooseCard only picks from legal cards.
        const card = chooseCard(state, seat);
        const hand = state.hands[seat] ?? [];
        const safe = isValidPlay(card, hand, state.currentTrick, state.spadeBroken)
          ? card
          : hand.find((c) => isValidPlay(c, hand, state.currentTrick, state.spadeBroken)) ?? card;
        sounds.cardPlay();
        void playFor(seat, safe);
      }
    }, leading ? BOT_LEAD_DELAY_MS : BOT_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, [iDriveBots, state, game, match, pending, bots, bidFor, playFor]);

  const sit = useCallback(async () => {
    if (!matchId || !userId) return false;
    const ok = await joinMatch(sb, matchId, userId);
    if (ok) { sounds.playerJoin(); await fetchAll(); }
    else setNotice("This table is full.");
    return ok;
  }, [sb, matchId, userId, fetchAll]);

  /** Leave a table that has not started yet. */
  const leaveTable = useCallback(async () => {
    if (!matchId || !userId) return;
    await keepWaiting();
    await leaveMatch(sb, matchId, userId);
    sounds.playerQuit();
  }, [sb, matchId, userId, keepWaiting]);

  /** Leave mid-game: a computer takes the seat so the others can keep playing. */
  const quit = useCallback(async () => {
    if (!game || !state || !myRow || !match) return;
    sounds.playerQuit();
    const nextBots = [...new Set([...bots, myRowSeat])];
    const noHumansLeft = humanRows.every((s) => nextBots.includes(seatOf(s)));
    await commit({
      state: {
        ...state,
        bots: nextBots,
        rematch: (state.rematch ?? []).filter((id) => id !== userId),
      },
    });
    if (noHumansLeft) {
      await sb.from("matches").update({ status: "abandoned", updated_at: nowIso() }).eq("id", match.id);
    }
    setNotice(noHumansLeft ? "The table has closed." : `${botName(myRowSeat)} took your seat.`);
  }, [sb, game, state, myRow, myRowSeat, match, bots, humanRows, seatOf, commit, userId]);

  /** Take your seat back from the computer. */
  const retakeSeat = useCallback(async () => {
    if (!state || !myRow || match?.status === "done") return;
    await commit({ state: { ...state, bots: bots.filter((s) => s !== myRowSeat) } });
  }, [state, myRow, myRowSeat, match, bots, commit]);

  const activeHumans = humanRows.filter((s) => !bots.includes(seatOf(s)));
  const rematchVotes = (state?.rematch ?? []).filter((id) => activeHumans.some((h) => h.user_id === id));
  const votesNeeded = Math.max(1, Math.floor(activeHumans.length / 2) + 1);
  const iVotedRematch = !!userId && rematchVotes.includes(userId);

  const voteRematch = useCallback(async () => {
    if (!userId || !state || !game || !match || iVotedRematch) return;
    const votes = [...rematchVotes, userId];
    if (votes.length >= votesNeeded) {
      // Three people and one computer: the computer gets a new partner each game.
      let next: Partial<GameState> = carry(state, { newGame: true });
      const everyoneHere = humanRows.length === 3 && activeHumans.length === 3;
      if (everyoneHere) {
        const plan = planBotSeats(
          humanRows.map((r) => ({ userId: r.user_id, seat: seatOf(r) })),
          state.botPartners ?? [],
        );
        next = {
          ...next,
          bots: plan.botSeats,
          seatOverrides: plan.seats,
          botPartners: [...(state.botPartners ?? []), plan.botPartner!],
        };
      }
      const ok = await commit({
        team1_score: 0, team2_score: 0, team1_bags: 0, team2_bags: 0, current_round: 1,
        state: { ...initGameState(Math.floor(Math.random() * 4)), ...next },
      });
      if (ok) {
        await sb.from("matches").update({ status: "live", updated_at: nowIso() }).eq("id", match.id);
        const partner = next.botPartners?.[next.botPartners.length - 1];
        setNotice(everyoneHere && partner
          ? `New game. ${partner === userId ? "You partner" : `${firstName(partner)} partners`} the computer this time.`
          : "New game. The table voted for it.");
      }
    } else {
      const ok = await commit({ state: { ...state, rematch: votes } });
      if (ok) setNotice(`${votes.length} of ${votesNeeded} votes for a new game.`);
    }
  }, [sb, userId, state, game, match, iVotedRematch, rematchVotes, votesNeeded, humanRows, activeHumans.length, seatOf, commit, firstName]);

  return {
    match, game, state, table, seats: rows, profiles, loading, notice, setNotice,
    mySeat, iLeft, isSeated: !!myRow, online, busy,
    makeBid, playCard, sit, quit, retakeSeat, leaveTable,
    voteRematch, rematchVotes: rematchVotes.length, votesNeeded, iVotedRematch,
    // The waiting room
    lobby, starting, firstName, agreeToBots, keepWaiting, movedTo,
    // Renig
    unlocked, setUnlocked, callRenig, renigCall: state?.renigCall ?? null, nameOfSeat,
  };
}
