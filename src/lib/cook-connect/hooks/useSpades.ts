"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  type GameState, initGameState, isValidPlay, determineTrickWinner,
  calculateRoundScore, applyRoundScore, nextSeat, getSuit, getTeam,
} from "../spades";
import { botName, chooseBid, chooseCard } from "../spadesBot";
import { sounds } from "../sounds";
import { finishMatch, joinMatch } from "../matches";
import { loadProfiles, type ProfileMap } from "../social";
import type { Match, MatchPlayer, SpadesGame } from "../types";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Backend = any;

const BOT_DELAY_MS = 1100;
/** A little longer before leading, so a finished trick is readable. */
const BOT_LEAD_DELAY_MS = BOT_DELAY_MS + 900;

export interface SeatView {
  seat: number;
  userId: string;
  team: number;
  isBot: boolean;
  name: string;
  avatar: string | null;
  online: boolean;
}

export function useSpades(sb: Backend, userId: string | null, matchId: string | undefined) {
  const [match, setMatch] = useState<Match | null>(null);
  const [game, setGame] = useState<SpadesGame | null>(null);
  const [seats, setSeats] = useState<MatchPlayer[]>([]);
  const [profiles, setProfiles] = useState<ProfileMap>({});
  const [online, setOnline] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [notice, setNotice] = useState<string | null>(null);

  const state = (game?.state as GameState | undefined)?.phase ? (game!.state as GameState) : null;
  const bots = state?.bots ?? [];

  const fetchAll = useCallback(async () => {
    if (!matchId) return;
    const [matchRes, gameRes, seatRes] = await Promise.all([
      sb.from("matches").select("*").eq("id", matchId).maybeSingle(),
      sb.from("spades_games").select("*").eq("match_id", matchId).maybeSingle(),
      sb.from("match_players").select("*").eq("match_id", matchId),
    ]);
    if (matchRes.data) setMatch(matchRes.data as Match);
    if (gameRes.data) setGame(gameRes.data as SpadesGame);
    const rows = (seatRes.data ?? []) as MatchPlayer[];
    setSeats(rows);
    setProfiles(await loadProfiles(sb, rows.filter((r) => !r.is_bot).map((r) => r.user_id)));
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
        setOnline(new Set(Object.keys(channel.presenceState())));
      })
      .subscribe((status: string) => {
        if (status === "SUBSCRIBED") void channel.track({ at: Date.now() });
      });
    return () => { sb.removeChannel(channel); };
  }, [sb, matchId, userId, fetchAll]);

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
      .update({ ...patch, updated_at: new Date().toISOString() })
      .eq("id", base.id).eq("updated_at", base.updated_at)
      .select("*");
    if (error) {
      setNotice(`Couldn't save that move: ${error.message}`);
      return false;
    }
    const row = (data as SpadesGame[] | null)?.[0];
    if (row) { setGame(row); return true; }

    // Nothing was written: either someone moved first, or this database returns
    // timestamps in a different format than it stores them. Find out which.
    const { data: fresh } = await sb.from("spades_games").select("*").eq("id", base.id).maybeSingle();
    if (fresh && (fresh as SpadesGame).updated_at === base.updated_at) {
      const { data: retry } = await sb.from("spades_games")
        .update({ ...patch, updated_at: new Date().toISOString() })
        .eq("id", base.id).select("*");
      const retried = (retry as SpadesGame[] | null)?.[0];
      if (retried) { setGame(retried); return true; }
    }
    if (fresh) setGame(fresh as SpadesGame); // someone beat us to it; resync
    return false;
  }, [sb, game]);

  const humanSeats = seats.filter((s) => !s.is_bot);
  const myRow = humanSeats.find((s) => s.user_id === userId);
  const iLeft = !!myRow && bots.includes(myRow.seat);
  const mySeat = iLeft ? -1 : myRow?.seat ?? -1;

  /** The table as it is shown: humans in their seats, computers in the rest. */
  const table: SeatView[] = [0, 1, 2, 3].map((seat) => {
    if (bots.includes(seat)) {
      return {
        seat, userId: `bot:${seat}`, team: getTeam(seat), isBot: true,
        name: botName(seat), avatar: null, online: true,
      };
    }
    const row = seats.find((s) => s.seat === seat);
    if (!row) {
      return { seat, userId: "", team: getTeam(seat), isBot: false, name: "Open seat", avatar: null, online: false };
    }
    if (row.is_bot) {
      return { seat, userId: row.user_id, team: getTeam(seat), isBot: true, name: botName(seat), avatar: null, online: true };
    }
    const p = profiles[row.user_id];
    return {
      seat, userId: row.user_id, team: getTeam(seat), isBot: false,
      name: p?.display_name ?? "Member", avatar: p?.avatar_url ?? null,
      online: online.has(row.user_id),
    };
  });

  /** Score the finished game once, from whichever browser gets there first. */
  const closeOut = useCallback(async (winningTeam: number, finalBots: number[]) => {
    if (!matchId) return;
    const winnerRow = seats.find((s) => !s.is_bot && !finalBots.includes(s.seat) && getTeam(s.seat) === winningTeam);
    await finishMatch(
      sb,
      matchId,
      table.map((t) => ({
        userId: t.userId,
        isBot: t.isBot,
        result: (t.team === winningTeam ? "win" : "loss") as "win" | "loss",
      })).filter((t) => t.userId),
      { winnerId: winnerRow?.user_id ?? null, winningTeam },
    );
    if (mySeat >= 0) {
      if (getTeam(mySeat) === winningTeam) sounds.gameWin();
      else sounds.gameLose();
    }
  }, [sb, matchId, seats, table, mySeat]);

  // Deal as soon as four seats are filled. Any seated player may do it; the
  // version check inside commit makes sure only one deal wins.
  useEffect(() => {
    if (!game || !match || !myRow || match.status !== "pending") return;
    if (seats.length < 4) return;
    void (async () => {
      await sb.from("matches").update({ status: "live", updated_at: new Date().toISOString() }).eq("id", match.id);
      await commit({ state: { ...initGameState(0), bots: [], rematch: [] } });
    })();
  }, [sb, game, match, seats.length, myRow, commit]);

  const bidFor = useCallback(async (seat: number, bid: number) => {
    if (!state || !game || state.currentTurn !== seat || state.phase !== "bidding") return;
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
  }, [state, game, commit]);

  const playFor = useCallback(async (seat: number, card: string) => {
    if (!state || !game || !match || state.currentTurn !== seat || state.phase !== "playing") return;
    const hand = state.hands[seat];
    if (!hand?.includes(card)) return;
    if (!isValidPlay(card, hand, state.currentTrick, state.spadeBroken)) {
      setNotice("Follow the suit that was led if you can, and don't lead spades until they're broken.");
      return;
    }

    const hands = { ...state.hands, [seat]: hand.filter((c) => c !== card) };
    const trick = [...state.currentTrick, { seat, card }];
    const spadeBroken = state.spadeBroken || getSuit(card) === "S";

    if (trick.length < 4) {
      await commit({
        state: { ...state, hands, currentTrick: trick, currentTurn: nextSeat(seat), spadeBroken },
      });
      return;
    }

    const winner = determineTrickWinner(trick);
    const tricksWon = { ...state.tricksWon, [winner]: (state.tricksWon[winner] || 0) + 1 };
    const trickNumber = state.trickNumber + 1;

    if (trickNumber <= 13) {
      await commit({
        state: {
          ...state, hands, currentTrick: [], trickLeader: winner, currentTurn: winner,
          tricksWon, spadeBroken, trickNumber, lastTrick: trick, lastTrickWinner: winner,
        },
      });
      return;
    }

    // Thirteen tricks played: score the round.
    const round = calculateRoundScore(state.bids, tricksWon);
    const totals = applyRoundScore(
      { team1: game.team1_score, team2: game.team2_score, bags1: game.team1_bags, bags2: game.team2_bags },
      round,
    );
    const scorePatch = {
      team1_score: totals.team1, team2_score: totals.team2,
      team1_bags: totals.bags1, team2_bags: totals.bags2,
    };

    if (totals.gameOver) {
      const ok = await commit({
        ...scorePatch,
        state: {
          ...state, phase: "gameEnd", hands, currentTrick: [], tricksWon,
          lastTrick: trick, lastTrickWinner: winner, spadeBroken, trickNumber: 14, rematch: [],
        },
      });
      if (ok) await closeOut(totals.winningTeam, state.bots ?? []);
    } else {
      sounds.roundEnd();
      await commit({
        ...scorePatch,
        current_round: game.current_round + 1,
        state: { ...initGameState((state.dealer + 1) % 4), bots: state.bots ?? [], rematch: [] },
      });
    }
  }, [state, game, match, commit, closeOut]);

  const makeBid = useCallback((bid: number) => {
    sounds.bidSubmit();
    return bidFor(mySeat, bid);
  }, [bidFor, mySeat]);

  const playCard = useCallback((card: string) => {
    sounds.cardPlay();
    return playFor(mySeat, card);
  }, [playFor, mySeat]);

  // Computer players. One browser drives them: the lowest-seated human who
  // currently has the table open, so the bots keep going if the host leaves.
  const driver = humanSeats
    .filter((s) => !bots.includes(s.seat) && online.has(s.user_id))
    .sort((a, b) => a.seat - b.seat)[0];
  const iDriveBots = !!userId && driver?.user_id === userId;
  const lastBotMove = useRef("");

  useEffect(() => {
    if (!iDriveBots || !state || !game || !match) return;
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
        sounds.cardPlay();
        void playFor(seat, chooseCard(state, seat));
      }
    }, leading ? BOT_LEAD_DELAY_MS : BOT_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, [iDriveBots, state, game, match, bots, bidFor, playFor]);

  const sit = useCallback(async () => {
    if (!matchId || !userId) return false;
    const ok = await joinMatch(sb, matchId, userId);
    if (ok) { sounds.playerJoin(); await fetchAll(); }
    else setNotice("This table is full.");
    return ok;
  }, [sb, matchId, userId, fetchAll]);

  /** Fill the empty seats with computer players and start now. */
  const startWithBots = useCallback(async () => {
    if (!game || !match || match.status !== "pending") return;
    const taken = new Set(seats.map((s) => s.seat));
    const botSeats = [0, 1, 2, 3].filter((s) => !taken.has(s));
    for (const seat of botSeats) {
      await sb.from("match_players").insert({
        match_id: match.id, user_id: `bot:${seat}`, seat, team: getTeam(seat), is_bot: true, result: null,
      });
    }
    await sb.from("matches").update({ status: "live", updated_at: new Date().toISOString() }).eq("id", match.id);
    const ok = await commit({ state: { ...initGameState(0), bots: botSeats, rematch: [] } });
    if (ok) {
      setNotice(
        botSeats.length === 1
          ? "One computer player joined the table."
          : `${botSeats.length} computer players joined the table.`,
      );
      await fetchAll();
    }
  }, [sb, game, match, seats, commit, fetchAll]);

  /** Leave mid-game: a computer takes the seat so the others can keep playing. */
  const quit = useCallback(async () => {
    if (!game || !state || !myRow || !match) return;
    sounds.playerQuit();
    const nextBots = [...new Set([...bots, myRow.seat])];
    const noHumansLeft = humanSeats.every((s) => nextBots.includes(s.seat));
    await commit({
      state: {
        ...state,
        bots: nextBots,
        rematch: (state.rematch ?? []).filter((id) => id !== userId),
      },
    });
    if (noHumansLeft) {
      await sb.from("matches").update({ status: "abandoned", updated_at: new Date().toISOString() }).eq("id", match.id);
    }
    setNotice(noHumansLeft ? "The table has closed." : `${botName(myRow.seat)} took your seat.`);
  }, [sb, game, state, myRow, match, bots, humanSeats, commit, userId]);

  /** Take your seat back from the computer. */
  const retakeSeat = useCallback(async () => {
    if (!state || !myRow || match?.status === "done") return;
    await commit({ state: { ...state, bots: bots.filter((s) => s !== myRow.seat) } });
  }, [state, myRow, match, bots, commit]);

  const activeHumans = humanSeats.filter((s) => !bots.includes(s.seat));
  const rematchVotes = (state?.rematch ?? []).filter((id) => activeHumans.some((h) => h.user_id === id));
  const votesNeeded = Math.max(1, Math.floor(activeHumans.length / 2) + 1);
  const iVotedRematch = !!userId && rematchVotes.includes(userId);

  const voteRematch = useCallback(async () => {
    if (!userId || !state || !game || !match || iVotedRematch) return;
    const votes = [...rematchVotes, userId];
    if (votes.length >= votesNeeded) {
      const ok = await commit({
        team1_score: 0, team2_score: 0, team1_bags: 0, team2_bags: 0, current_round: 1,
        state: { ...initGameState(Math.floor(Math.random() * 4)), bots, rematch: [] },
      });
      if (ok) {
        await sb.from("matches").update({ status: "live", updated_at: new Date().toISOString() }).eq("id", match.id);
        setNotice("New game. The table voted for it.");
      }
    } else {
      const ok = await commit({ state: { ...state, rematch: votes } });
      if (ok) setNotice(`${votes.length} of ${votesNeeded} votes for a new game.`);
    }
  }, [sb, userId, state, game, match, iVotedRematch, rematchVotes, votesNeeded, bots, commit]);

  return {
    match, game, state, table, seats, profiles, loading, notice, setNotice,
    mySeat, iLeft, isSeated: !!myRow, online,
    makeBid, playCard, sit, startWithBots, quit, retakeSeat,
    voteRematch, rematchVotes: rematchVotes.length, votesNeeded, iVotedRematch,
  };
}
