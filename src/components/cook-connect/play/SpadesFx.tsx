"use client";

// The spades table's big moments, all driven by the active Game Play Design
// Styling theme:
//
//   every trick   the winning card strikes with its suit's attack, the rest
//                 are defeated (slash / fire / shards / quake)
//   trump steal   a low spade takes down a picture card — the biggest hype
//   spades broken the table goes dark, thunder cracks, a banner slams down
//   nil shield    a shield around a nil bidder; pulses on every dodged trick,
//                 shatters when they are forced to take one
//   renig call    a knockout stamp the moment a "Call renig" settles —
//                 the theme's RENEGE! when it was true, WRONG CALL when not
//   set / boston  the end-of-hand stamps; a set team's score crumbles
//
// The moments are worked out from how the game state CHANGES, so every screen
// at the table plays them, and nothing replays when the page is reloaded.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import "./spades-fx.css";
import {
  type GameState, type TrickPlay, determineTrickWinner, getRank, getSuit, getTeam,
  trumpSteal, RANK_DISPLAY, SUIT_SYMBOLS,
} from "@/lib/cook-connect/spades";
import type { FxLevel, GameTheme, SuitKey } from "@/lib/cook-connect/gameStyle";

export interface Banner {
  id: number;
  text: string;
  sub?: string;
  color: string;
  stamp?: boolean;
  /** ms */
  dur: number;
  darken?: boolean;
  thunder?: boolean;
  confetti?: string[];
  shake?: "small" | "big";
}

export interface Clash {
  id: number;
  trick: TrickPlay[];
  winner: number;
  phase: "clash" | "sweep";
  /** ms the strike lasts. */
  dur: number;
  steal: ReturnType<typeof trumpSteal>;
}

export type NilFx = "on" | "pulse" | "shatter";

const cardName = (card: string) => `${RANK_DISPLAY[getRank(card)]}${SUIT_SYMBOLS[getSuit(card)]}`;
const SWEEP_MS = 620;
const RENEGE_RED = "#f87171";

let nextId = 1;

export function useSpadesMoments({
  state, round, theme, level, nameOf,
}: {
  state: GameState;
  round: number;
  theme: GameTheme;
  level: FxLevel;
  nameOf: (seat: number) => string;
}) {
  // Only a settled call is read here. The secret renig record itself
  // (state.reneges) is never looked at, so no moment can give one away.
  const speed = level === "quick" ? 0.55 : 1;
  const whose = (seat: number) => (nameOf(seat) === "You" ? "Your" : `${nameOf(seat)}'s`);
  const show = level !== "off";

  const [queue, setQueue] = useState<Banner[]>([]);
  const [clash, setClash] = useState<Clash | null>(null);
  const [nilFx, setNilFx] = useState<Record<number, NilFx>>({});
  const [shake, setShake] = useState<"" | "fx-shake" | "fx-shake-big">("");
  const [crumbleTeam, setCrumbleTeam] = useState<number | null>(null);
  const timers = useRef<number[]>([]);

  const later = useCallback((ms: number, fn: () => void) => {
    timers.current.push(window.setTimeout(fn, ms));
  }, []);
  useEffect(() => () => timers.current.forEach((t) => window.clearTimeout(t)), []);

  const announce = useCallback((b: Omit<Banner, "id">) => {
    if (!show) return;
    setQueue((q) => [...q, { ...b, dur: Math.round(b.dur * speed), id: nextId++ }]);
  }, [show, speed]);

  const quake = useCallback((kind: "small" | "big") => {
    if (!show) return;
    setShake("");
    requestAnimationFrame(() => setShake(kind === "big" ? "fx-shake-big" : "fx-shake"));
    later(kind === "big" ? 760 : 500, () => setShake(""));
  }, [show, later]);

  // One banner at a time; the next one waits its turn.
  const current = queue[0] ?? null;
  useEffect(() => {
    if (!current) return;
    if (current.shake) quake(current.shake);
    const t = window.setTimeout(() => setQueue((q) => q.slice(1)), current.dur);
    return () => window.clearTimeout(t);
  }, [current?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // --- watching the game change ---------------------------------------------
  const prev = useRef<{
    trickKey: string;
    round: number;
    spadeBroken: boolean;
    call: number;
    tricks: Record<number, number>;
    recap: number;
  } | null>(null);

  useEffect(() => {
    const trickKey = `${round}:${state.trickNumber}`;
    const callAt = state.renigCall?.at ?? 0;
    const now = {
      trickKey,
      round,
      spadeBroken: state.spadeBroken,
      call: callAt,
      tricks: { ...state.tricksWon },
      recap: state.lastRound?.round ?? -1,
    };
    const p = prev.current;
    prev.current = now;
    if (!p) return; // first look at this table: nothing to replay

    const trickEnded = trickKey !== p.trickKey
      && state.currentTrick.length === 0
      && (state.lastTrick?.length ?? 0) === 4
      && state.lastTrickWinner !== undefined;

    // Every trick is a fight.
    let clashMs = 0;
    if (trickEnded) {
      const trick = state.lastTrick!;
      const winner = determineTrickWinner(trick);
      const steal = theme.trumpSteal.on ? trumpSteal(trick) : null;
      const base = theme.clash.on && show ? [0, 650, 950, 1250][theme.clash.intensity] : 0;
      clashMs = Math.round((steal && show ? base * 1.7 + 300 : base) * speed);
      const id = nextId++;
      setClash({ id, trick, winner, phase: clashMs ? "clash" : "sweep", dur: clashMs, steal });
      if (clashMs) later(clashMs, () => setClash((c) => (c?.id === id ? { ...c, phase: "sweep" } : c)));
      later(clashMs + SWEEP_MS + 280, () => setClash((c) => (c?.id === id ? null : c)));
      if (show && theme.clash.on && theme.clash.intensity === 3 && !steal) later(Math.round(clashMs * 0.35), () => quake("small"));

      if (steal && show) {
        announce({
          text: theme.trumpSteal.text,
          sub: `${whose(steal.winner.seat)} ${cardName(steal.winner.card)} took down the ${cardName(steal.victim.card)}`,
          color: theme.suits.S.color,
          dur: 2000,
          confetti: theme.confetti,
          shake: "big",
        });
      }

      // Nil shields: pulse for every dodge, shatter when one gets through.
      const sameHand = round === p.round;
      for (const seat of [0, 1, 2, 3]) {
        if (state.bids[seat] !== 0 || !theme.nilShield.on || !show) continue;
        if (!sameHand) continue;
        if (seat === winner && (p.tricks[seat] ?? 0) === 0) {
          setNilFx((f) => ({ ...f, [seat]: "shatter" }));
          later(1200, () => setNilFx((f) => { const n = { ...f }; delete n[seat]; return n; }));
          announce({ text: "SHIELD SHATTERED", sub: `${whose(seat)} nil is broken`, color: theme.nilShield.color, dur: 1500, shake: "small" });
        } else if (seat !== winner && (state.tricksWon[seat] ?? 0) === 0) {
          setNilFx((f) => ({ ...f, [seat]: "pulse" }));
          later(950, () => setNilFx((f) => (f[seat] === "pulse" ? (() => { const n = { ...f }; delete n[seat]; return n; })() : f)));
        }
      }
    }

    // Spades broken.
    if (round === p.round && !p.spadeBroken && state.spadeBroken && theme.spadesBroken.on) {
      announce({
        text: theme.spadesBroken.text,
        color: theme.suits.S.color,
        dur: 2300,
        darken: true,
        thunder: theme.spadesBroken.thunder,
        confetti: theme.confetti,
        shake: "big",
      });
    }

    // A "Call renig" settled: the game is over, and everyone sees how.
    const call = state.renigCall;
    if (call && callAt !== p.call && theme.renege.on) {
      announce({
        text: call.correct ? theme.renege.text : theme.renege.wrong,
        sub: call.correct
          ? `${nameOf(call.accuserSeat)} caught ${nameOf(call.accusedSeat)} — Team ${call.winningTeam} wins`
          : `${nameOf(call.accusedSeat)} played fair — Team ${call.winningTeam} wins`,
        color: RENEGE_RED,
        stamp: true,
        dur: 2400,
        shake: "big",
      });
    }

    // The hand is over: stamp it. (A renig is never revealed here — it stays
    // secret and callable for the rest of the game.)
    const recap = state.lastRound;
    if (recap && recap.round !== p.recap) {
      later(clashMs + SWEEP_MS, () => {
        for (const team of [1, 2]) {
          const seats = team === 1 ? [0, 2] : [1, 3];
          const took = seats.reduce((a, s) => a + (recap.tricksWon[s] ?? 0), 0);
          if (took === 13 && theme.boston.on) {
            announce({ text: theme.boston.text, sub: `Team ${team} took all 13`, color: "#fcd34d", dur: 2400, confetti: theme.confetti.length ? theme.confetti : ["✨"], shake: "big" });
          }
        }
        for (const n of recap.nils) {
          if (!theme.nilShield.on) break;
          announce({
            text: n.made ? "NIL HELD!" : "NIL BUSTED",
            sub: nameOf(n.seat),
            color: theme.nilShield.color,
            dur: 1400,
            confetti: n.made ? theme.confetti : undefined,
          });
        }
        for (const team of recap.set) {
          if (!theme.set.on) break;
          announce({ text: theme.set.text, sub: `Team ${team} got set`, color: RENEGE_RED, stamp: true, dur: 2100, shake: "big" });
          setCrumbleTeam(team);
          later(1400, () => setCrumbleTeam(null));
        }
      });
    }
  }, [state, round]); // eslint-disable-line react-hooks/exhaustive-deps

  /** Shields currently up: nil bidders who have not taken a trick this hand. */
  const shields = useMemo(() => {
    const out: Record<number, NilFx> = {};
    if (!show || !theme.nilShield.on) return out;
    for (const seat of [0, 1, 2, 3]) {
      if (state.bids[seat] === 0 && (state.tricksWon[seat] ?? 0) === 0 && state.phase !== "gameEnd") out[seat] = "on";
      if (nilFx[seat]) out[seat] = nilFx[seat];
    }
    return out;
  }, [show, theme.nilShield.on, state.bids, state.tricksWon, state.phase, nilFx]);

  return { banner: current, clash, shields, shake, crumbleTeam };
}

// --- drawing ----------------------------------------------------------------

/** The overlay: darkness, lightning, the banner and its confetti. */
export function FxStage({ banner }: { banner: Banner | null }) {
  if (!banner) return null;
  const vars = { "--fx-color": banner.color, "--fx-dur": `${banner.dur}ms` } as React.CSSProperties;
  return (
    <div className="fx-stage" style={vars} key={banner.id} aria-live="polite">
      {banner.darken && <div className="fx-darken" />}
      {banner.thunder && (
        <>
          <div className="fx-flash" />
          <Bolt left="18%" />
          <Bolt left="68%" flip />
        </>
      )}
      <Burst count={banner.shake === "big" ? 26 : 14} emoji={banner.confetti} />
      <div className={banner.stamp ? "fx-banner fx-stamp" : "fx-banner"}>
        <span className="fx-banner-text">{banner.text}</span>
        {banner.sub && <span className="fx-banner-sub">{banner.sub}</span>}
      </div>
      <span className="sr-only">{banner.text}{banner.sub ? `. ${banner.sub}` : ""}</span>
    </div>
  );
}

function Bolt({ left, flip }: { left: string; flip?: boolean }) {
  return (
    <svg className="fx-bolt" style={{ left, transform: flip ? "scaleX(-1)" : undefined }} viewBox="0 0 70 200" aria-hidden="true">
      <path d="M40 0 L22 70 L44 72 L18 150 L36 152 L14 200" />
    </svg>
  );
}

/** A burst of sparks (and the theme's emoji, if any) from the middle of the table. */
export function Burst({ count, emoji, color }: { count: number; emoji?: string[]; color?: string }) {
  const parts = useMemo(() => Array.from({ length: count }, (_, i) => {
    const angle = (i / count) * Math.PI * 2 + Math.random() * 0.5;
    const dist = 60 + Math.random() * 140;
    const useEmoji = !!emoji?.length && i % 3 === 0;
    return {
      key: i,
      dx: `${Math.cos(angle) * dist}px`,
      dy: `${Math.sin(angle) * dist * 0.7}px`,
      r: `${Math.round(Math.random() * 360)}deg`,
      d: `${Math.round(Math.random() * 120)}ms`,
      s: (0.6 + Math.random() * 0.9).toFixed(2),
      emoji: useEmoji ? emoji![i % emoji!.length] : null,
    };
  }), [count, emoji]);
  return (
    <>
      {parts.map((p) => (
        <span
          key={p.key}
          className={p.emoji ? "fx-particle is-emoji" : "fx-particle"}
          style={{ "--dx": p.dx, "--dy": p.dy, "--r": p.r, "--d": p.d, "--s": p.s, ...(color ? { "--fx-color": color } : {}) } as React.CSSProperties}
          aria-hidden="true"
        >
          {p.emoji}
        </span>
      ))}
    </>
  );
}

/** Classes and variables for one card in a resolving trick. */
export function clashStyle(
  clash: Clash | null,
  play: TrickPlay,
  theme: GameTheme,
): { className: string; style: React.CSSProperties; hit: string | null; callout: string | null } {
  if (!clash || clash.phase !== "clash" || !clash.dur) return { className: "", style: {}, hit: null, callout: null };
  const winnerPlay = clash.trick.find((t) => t.seat === clash.winner)!;
  const suit = theme.suits[getSuit(winnerPlay.card) as SuitKey];
  const base = { "--fx-color": suit.color, "--fx-dur": `${clash.dur}ms` } as Record<string, string>;
  if (play.seat === clash.winner) {
    return {
      className: clash.steal ? "fx-sneak" : "fx-strike",
      style: base as React.CSSProperties,
      hit: null,
      callout: suit.attack,
    };
  }
  const tilt = ((play.seat * 37) % 15) - 7;
  return {
    className: clash.steal && clash.steal.victim.seat === play.seat ? "fx-fall" : "fx-defeat",
    style: { ...base, "--fx-tilt": `${tilt}deg`, "--fx-kx": `${tilt / 2}px` } as React.CSSProperties,
    hit: `fx-hit fx-hit-${suit.kind}`,
    callout: null,
  };
}
