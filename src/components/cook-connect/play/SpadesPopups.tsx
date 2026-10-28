"use client";

// The two "what just happened" screens of a spades table:
//   • end of a hand  — bids vs tricks, points, set/nil, what each side still
//                      needs to win, then Next hand (no bags: owner's rule)
//   • end of a game  — who won, the final score, and where it moved you on
//                      the spades leaderboard, then Next game
// Neither one moves on by itself: a player always presses Next (owner's rule,
// Oct 2026). The card floats in, tilts toward your pointer or finger, and its
// foil edge and sparks keep moving while it waits.

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import "./holo-table.css";
import type { GameTheme } from "@/lib/cook-connect/gameStyle";
import { pointsToWin, FINAL_HAND_REACH, WINNING_SCORE, type RoundRecap } from "@/lib/cook-connect/spades";
import { loadMatchResults } from "@/lib/cook-connect/social";
import { rankShift, rankShiftLine, type RankShift } from "@/lib/cook-connect/rankShift";
import { cx } from "../ui";
import { PlayingCard } from "./PlayingCard";

const WIN = "#fcd34d";
const LOSS = "#f87171";

/* ── shared shell ─────────────────────────────────────────────── */

function themeVars(theme: GameTheme): React.CSSProperties {
  return {
    "--hx-accent": theme.accent,
    "--hx-suit-S": theme.deck.S,
    "--hx-suit-H": theme.deck.H,
    "--hx-suit-D": theme.deck.D,
    "--hx-suit-C": theme.deck.C,
  } as React.CSSProperties;
}

function PopShell({
  theme, color, sparks, label, children,
}: {
  theme: GameTheme;
  color: string;
  /** Emoji thrown up behind the card. Empty for none. */
  sparks: string[];
  label: string;
  children: React.ReactNode;
}) {
  const cardRef = useRef<HTMLDivElement>(null);
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  // The card leans toward the pointer (or finger) and its glow follows it.
  const onMove = (e: React.PointerEvent) => {
    const el = cardRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const nx = Math.max(-1, Math.min(1, ((e.clientX - r.left) / r.width) * 2 - 1));
    const ny = Math.max(-1, Math.min(1, ((e.clientY - r.top) / r.height) * 2 - 1));
    el.style.setProperty("--ry", `${(nx * 7).toFixed(2)}deg`);
    el.style.setProperty("--rx", `${(-ny * 6).toFixed(2)}deg`);
    el.style.setProperty("--gx", `${(50 + nx * 40).toFixed(1)}%`);
    el.style.setProperty("--gy", `${(30 + ny * 30).toFixed(1)}%`);
  };
  const onLeave = () => {
    const el = cardRef.current;
    if (!el) return;
    el.style.setProperty("--ry", "0deg");
    el.style.setProperty("--rx", "0deg");
  };

  // Fixed positions so sparks don't jump on every render.
  const sparkSpots = useRef(
    Array.from({ length: 14 }, (_, i) => ({
      x: `${(6 + ((i * 37) % 88)).toFixed(0)}%`,
      d: `${(2 + (i % 5) * 0.35).toFixed(2)}s`,
      delay: `${((i * 0.27) % 2.4).toFixed(2)}s`,
      r: `${(i % 2 ? 1 : -1) * (120 + i * 17)}deg`,
      s: `${12 + (i % 4) * 4}px`,
    })),
  ).current;

  if (!mounted) return null;
  return createPortal(
    <div className="hx-root" style={themeVars(theme)}>
      <div className="hx-pop" role="dialog" aria-modal="true" aria-label={label} onPointerMove={onMove} onPointerLeave={onLeave}>
        <div ref={cardRef} className="hx-pop-card" style={{ "--pop-color": color } as React.CSSProperties}>
          <span className="hx-pop-glow" aria-hidden="true" />
          {sparks.length > 0 && sparkSpots.map((p, i) => (
            <span
              key={i}
              className="hx-pop-spark"
              aria-hidden="true"
              style={{ "--x": p.x, "--d": p.d, "--delay": p.delay, "--r": p.r, "--s": p.s } as React.CSSProperties}
            >
              {sparks[i % sparks.length]}
            </span>
          ))}
          {children}
        </div>
      </div>
    </div>,
    document.body,
  );
}

/** Counts a number up (or down) to its value when it first shows. */
function useCountTo(target: number, from: number, ms = 900): number {
  const [n, setN] = useState(from);
  useEffect(() => {
    if (typeof window === "undefined" || window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) {
      setN(target);
      return;
    }
    let raf = 0;
    const t0 = performance.now();
    const tick = (t: number) => {
      const k = Math.min(1, (t - t0) / ms);
      const eased = 1 - Math.pow(1 - k, 3);
      setN(Math.round(from + (target - from) * eased));
      if (k < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target, from, ms]);
  return n;
}

function Signed({ n }: { n: number }) {
  return <span className={cx("hx-pop-delta", n > 0 && "is-up", n < 0 && "is-down")}>{n > 0 ? `+${n}` : n}</span>;
}

/* ── end of a hand ────────────────────────────────────────────── */

export interface Totals { team1: number; team2: number }

export function HandOverPopup({
  recap, totals, myTeam, nameOf, theme, onNext, iAmReady, waitingOn, onMinimize,
}: {
  recap: RoundRecap;
  totals: Totals;
  myTeam: number | null;
  nameOf: (seat: number) => string;
  theme: GameTheme;
  onNext: () => void;
  iAmReady: boolean;
  /** First names of people who still have to press Next. */
  waitingOn: string[];
  onMinimize: () => void;
}) {
  const seatsOf = (team: number) => (team === 1 ? [0, 2] : [1, 3]);
  const pointsOf = (team: number) => (team === 1 ? recap.team1Score : recap.team2Score);
  const mine = myTeam ?? 1;
  const mySet = recap.set.includes(mine);
  const myPoints = pointsOf(mine);
  const color = mySet ? LOSS : myPoints > 0 ? theme.accent : LOSS;
  const title = mySet ? "Set!" : recap.set.length ? "Got 'em" : myPoints >= 100 ? "Big hand" : "Hand made";
  // Your side first.
  const order = myTeam === 2 ? [2, 1] : [1, 2];

  return (
    <PopShell theme={theme} color={color} sparks={mySet ? [] : theme.confetti.length ? theme.confetti : ["✦", "✧"]} label="Hand over">
      <p className="hx-pop-kicker">Hand {recap.round} over</p>
      <h2 className="hx-pop-title">{title}</h2>
      <p className="hx-pop-sub">
        {myTeam ? <>You {myPoints >= 0 ? "scored" : "lost"} <b>{Math.abs(myPoints)}</b> this hand.</> : "Here's how it went."}
      </p>

      <div className="hx-pop-teams">
        {order.map((team) => {
          const seats = seatsOf(team);
          const bid = seats.reduce((a, s) => a + (recap.bids[s] || 0), 0);
          const won = seats.reduce((a, s) => a + (recap.tricksWon[s] || 0), 0);
          const nils = recap.nils.filter((n) => seats.includes(n.seat));
          const total = team === 1 ? totals.team1 : totals.team2;
          return (
            <TeamBox
              key={team}
              label={myTeam ? (team === myTeam ? "Us" : "Them") : `Team ${team}`}
              names={seats.map(nameOf).join(" & ")}
              us={team === myTeam}
              total={total}
              delta={pointsOf(team)}
            >
              <p className="hx-pop-team-line"><span>Bid / won</span><b>{bid} / {won}</b></p>
              {recap.set.includes(team) && <span className="hx-pop-tag is-set">Set</span>}
              {nils.map((n) => (
                <span key={n.seat} className="hx-pop-tag is-nil" style={{ marginLeft: 4 }}>
                  {nameOf(n.seat)} nil {n.made ? "held" : "busted"}
                </span>
              ))}
            </TeamBox>
          );
        })}
      </div>

      <NeedLine totals={totals} myTeam={myTeam} theme={theme} />

      <div className="hx-pop-actions">
        <button type="button" className="hx-place hx-pop-next" onClick={onNext} disabled={iAmReady} autoFocus>
          {iAmReady ? `Waiting for ${waitingOn.join(" & ") || "the table"}…` : <>Next hand <span className="chev">›</span></>}
        </button>
        <div className="hx-pop-row">
          <button type="button" className="hx-btn" onClick={onMinimize}>See the table</button>
        </div>
      </div>
    </PopShell>
  );
}

/** "You need 120 to win · They need 80", with the target under it. */
function NeedLine({ totals, myTeam, theme }: { totals: Totals; myTeam: number | null; theme: GameTheme }) {
  const need = pointsToWin(totals, WINNING_SCORE);
  const order = myTeam === 2 ? [2, 1] : [1, 2];
  const who = (team: number) => (!myTeam ? `Team ${team}` : team === myTeam ? "You" : "They");
  return (
    <p className="hx-pop-need" style={{ "--fire": theme.finalHand.color } as React.CSSProperties}>
      {order.map((team, i) => {
        const n = need[team as 1 | 2];
        return (
          <span key={team} className={cx(n <= FINAL_HAND_REACH && "is-close")}>
            {i > 0 && <span style={{ color: "var(--hx-ink-faint)" }}> · </span>}
            {who(team)} need <b>{n}</b> to win
          </span>
        );
      })}
      <small>First to {need.target} wins</small>
    </p>
  );
}

/** "Are you sure you want to play out of turn?" — the confirm before jumping in. */
export function OutOfTurnPopup({
  card, theme, onConfirm, onCancel,
}: {
  card: string;
  theme: GameTheme;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onCancel(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onCancel]);
  return (
    <PopShell theme={theme} color={LOSS} sparks={[]} label="Play out of turn?">
      <p className="hx-pop-kicker">Not your turn</p>
      <h2 className="hx-pop-title" style={{ fontSize: "clamp(24px, 6.5vw, 32px)" }}>Play out of turn?</h2>
      <p className="hx-confirm-text">
        Are you sure you want to play out of turn? It goes on the table now, and it counts as a renig:
        if someone calls it, your team loses.
      </p>
      <div className="hx-confirm-card"><PlayingCard card={card} size="xl" /></div>
      <div className="hx-pop-actions">
        <button type="button" className="hx-place hx-pop-next" onClick={onCancel} autoFocus>
          Cancel
        </button>
        <div className="hx-pop-row">
          <button type="button" className="hx-btn" onClick={onConfirm}>Yes, play it</button>
        </div>
      </div>
    </PopShell>
  );
}

function TeamBox({
  label, names, us, total, delta, children,
}: {
  label: string;
  names: string;
  us: boolean;
  total: number;
  delta: number;
  children?: React.ReactNode;
}) {
  const shown = useCountTo(total, total - delta);
  return (
    <div className={cx("hx-pop-team", us && "is-us")}>
      <p className="hx-pop-team-name">{label}</p>
      <p className="hx-pop-team-score">{shown}</p>
      <p className="hx-pop-team-line"><span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{names}</span><Signed n={delta} /></p>
      {children}
    </div>
  );
}

/* ── end of a game ────────────────────────────────────────────── */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Backend = any;

/**
 * Where this game moved you on the spades board. Results are written a moment
 * after the game ends, so it looks a few times before giving up.
 */
export function useRankShift(sb: Backend, matchId: string, userId: string | null, active: boolean) {
  const [shift, setShift] = useState<RankShift | null>(null);
  const [state, setState] = useState<"idle" | "loading" | "done" | "none">("idle");

  const load = useCallback(async (): Promise<RankShift | null> => {
    if (!userId) return null;
    const results = await loadMatchResults(sb);
    return rankShift(results, matchId, userId, "spades");
  }, [sb, matchId, userId]);

  useEffect(() => {
    if (!active || !userId) { setShift(null); setState("idle"); return; }
    let cancelled = false;
    let tries = 0;
    setState("loading");
    const attempt = async () => {
      tries += 1;
      const found = await load().catch(() => null);
      if (cancelled) return;
      if (found) { setShift(found); setState("done"); return; }
      if (tries < 7) window.setTimeout(() => void attempt(), 1500);
      else setState("none");
    };
    void attempt();
    return () => { cancelled = true; };
  }, [active, userId, load]);

  return { shift, state };
}

export function GameOverPopup({
  won, spectator, finalScore, myTeam, teamNames, headline, theme, rank, rankState,
  onNext, nextLabel, nextDisabled, onLeaderboard, onLobby, onMinimize,
}: {
  won: boolean;
  spectator: boolean;
  finalScore: { team1: number; team2: number };
  myTeam: number | null;
  teamNames: { 1: string; 2: string };
  /** Why it ended, when it wasn't the score (a renig call). */
  headline?: string | null;
  theme: GameTheme;
  rank: RankShift | null;
  rankState: "idle" | "loading" | "done" | "none";
  onNext: () => void;
  nextLabel: string;
  nextDisabled: boolean;
  onLeaderboard: () => void;
  onLobby: () => void;
  onMinimize: () => void;
}) {
  const color = spectator ? theme.accent : won ? WIN : LOSS;
  const order = myTeam === 2 ? [2, 1] : [1, 2];
  const sparks = won ? (theme.confetti.length ? theme.confetti : ["✦", "★", "✧", "♠"]) : [];
  return (
    <PopShell theme={theme} color={color} sparks={sparks} label="Game over">
      <p className="hx-pop-kicker">Game over</p>
      <h2 className="hx-pop-title">{spectator ? "Game over" : won ? "Victory!" : "Defeat"}</h2>
      <p className="hx-pop-sub">
        {headline ?? (spectator
          ? `Team ${finalScore.team1 > finalScore.team2 ? 1 : 2} took the table.`
          : won ? "You and your partner took the table." : "They took this one. Run it back?")}
      </p>

      <div className="hx-pop-teams">
        {order.map((team) => {
          const score = team === 1 ? finalScore.team1 : finalScore.team2;
          return (
            <FinalBox
              key={team}
              label={myTeam ? (team === myTeam ? "Us" : "Them") : `Team ${team}`}
              names={teamNames[team as 1 | 2]}
              us={team === myTeam}
              score={score}
            />
          );
        })}
      </div>

      {!spectator && <RankCard rank={rank} state={rankState} />}

      <div className="hx-pop-actions">
        <button type="button" className="hx-place hx-pop-next" onClick={onNext} disabled={nextDisabled} autoFocus>
          {nextLabel === "Next game" ? <>Next game <span className="chev">›</span></> : nextLabel}
        </button>
        <div className="hx-pop-row">
          <button type="button" className="hx-btn" onClick={onLeaderboard}>Leaderboard</button>
          <button type="button" className="hx-btn" onClick={onMinimize}>See the table</button>
          <button type="button" className="hx-btn" onClick={onLobby}>Lobby</button>
        </div>
      </div>
    </PopShell>
  );
}

function FinalBox({ label, names, us, score }: { label: string; names: string; us: boolean; score: number }) {
  const shown = useCountTo(score, 0, 1100);
  return (
    <div className={cx("hx-pop-team", us && "is-us")}>
      <p className="hx-pop-team-name">{label}</p>
      <p className="hx-pop-team-score">{shown}</p>
      <p className="hx-pop-team-line"><span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{names}</span></p>
    </div>
  );
}

function RankCard({ rank, state }: { rank: RankShift | null; state: "idle" | "loading" | "done" | "none" }) {
  const shown = useCountTo(rank?.after ?? 0, rank?.before ?? rank?.after ?? 0, 1300);
  if (state === "loading" || state === "idle") {
    return (
      <div className="hx-stand" aria-busy="true">
        <span className="hx-stand-arrow is-same">#</span>
        <span className="hx-stand-loading" />
      </div>
    );
  }
  if (!rank) {
    return (
      <div className="hx-stand">
        <span className="hx-stand-arrow is-same">#</span>
        <div className="hx-stand-body">
          <p className="hx-stand-head">Spades leaderboard</p>
          <p className="hx-stand-note">Your ranking will show on the Boards tab in a moment.</p>
        </div>
      </div>
    );
  }
  const dir = rank.before === null ? "new" : rank.moved > 0 ? "up" : rank.moved < 0 ? "down" : "same";
  return (
    <div className="hx-stand">
      <span className={`hx-stand-arrow is-${dir}`} aria-hidden="true">
        {dir === "up" ? "▲" : dir === "down" ? "▼" : dir === "new" ? "★" : "="}
      </span>
      <div className="hx-stand-body">
        <p className="hx-stand-head">Spades leaderboard</p>
        <p className="hx-stand-move">
          {rank.before !== null && rank.before !== rank.after && <span className="from">#{rank.before}</span>}
          <span className="to">#{shown}</span>
          {dir === "up" && <span className="by is-up">+{rank.moved}</span>}
          {dir === "down" && <span className="by is-down">{rank.moved}</span>}
        </p>
        <p className="hx-stand-note">
          {rankShiftLine(rank)}
          {rank.provisional && ` Provisional: ${rank.toQualify} more ${rank.toQualify === 1 ? "game" : "games"} to join the ranked board.`}
        </p>
      </div>
    </div>
  );
}

/** The bar a popup shrinks to, so you can look at the table first. */
export function PopBar({ text, action, onAction, onOpen }: { text: string; action: string; onAction: () => void; onOpen: () => void }) {
  return (
    <div className="hx-root">
      <div className="hx-pop-bar">
        <p>{text}</p>
        <button type="button" className="hx-btn" onClick={onOpen}>Results</button>
        <button type="button" className="hx-place" onClick={onAction}>{action}</button>
      </div>
    </div>
  );
}
