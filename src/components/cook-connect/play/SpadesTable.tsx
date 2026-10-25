"use client";

// The holo table: a tilted oval of WebGL felt on a dark stage, opponents'
// hands held as fans of card backs around it, and your hand held as a curved
// fan at the bottom, as if an invisible hand were holding the cards.
//
// Seats are drawn relative to you (you are always at the bottom) because a
// partnership game is only readable when "across from me" means your partner.
// Every colour comes from the active Game Play Design Styling theme.

import { useCallback, useEffect, useRef, useState } from "react";
import "./holo-table.css";
import type { GameState } from "@/lib/cook-connect/spades";
import { getSuit, getTeam, isValidPlay, sortHand } from "@/lib/cook-connect/spades";
import type { FxLevel, GameTheme, SuitKey } from "@/lib/cook-connect/gameStyle";
import { chooseBid } from "@/lib/cook-connect/spadesBot";
import type { SeatView } from "@/lib/cook-connect/hooks/useSpades";
import { Avatar, cx } from "../ui";
import { BotIcon } from "../icons";
import { PlayingCard } from "./PlayingCard";
import { HoloFelt, type FeltPulse } from "./HoloFelt";
import { Burst, FxStage, clashStyle, useSpadesMoments, type NilFx } from "./SpadesFx";

interface Props {
  state: GameState;
  table: SeatView[];
  mySeat: number;
  onBid: (bid: number) => void;
  onPlay: (card: string) => void;
  /** The active Game Play Design Styling theme. */
  theme: GameTheme;
  fxLevel: FxLevel;
  onFxLevel: (level: FxLevel) => void;
  /** The hand being played, so moments are tied to it. */
  round: number;
  /** The team whose score should crumble (they just got set). */
  onCrumble?: (team: number | null) => void;
  /** "Renig" pressed: every card in your hand can be played. Only you see this. */
  unlocked?: boolean;
  onToggleUnlock?: () => void;
  /** "Call renig": opens the room's opponent picker. */
  onCallRenig?: () => void;
  /** Running game score, shown in the stage's top corners. */
  scores?: { team1: number; team2: number };
}

const FX_LEVELS: { id: FxLevel; label: string }[] = [
  { id: "full", label: "Full" },
  { id: "quick", label: "Quick" },
  { id: "off", label: "Off" },
];

/** Where each seat sits on screen, given which seat is yours. */
const POSITIONS = ["bottom", "left", "top", "right"] as const;
type Position = (typeof POSITIONS)[number];

/** Where each player's card lies in the trick, on the felt. */
const SLOT: Record<Position, { x: string; y: string; r: string }> = {
  bottom: { x: "0px", y: "44px", r: "-3deg" },
  top: { x: "0px", y: "-44px", r: "4deg" },
  left: { x: "-60px", y: "0px", r: "-9deg" },
  right: { x: "60px", y: "0px", r: "7deg" },
};
/** Where a card flies in from: that player's side of the table. */
const FROM: Record<Position, { x: string; y: string; r: string }> = {
  bottom: { x: "0px", y: "240px", r: "-14deg" },
  top: { x: "0px", y: "-200px", r: "12deg" },
  left: { x: "-260px", y: "0px", r: "-30deg" },
  right: { x: "260px", y: "0px", r: "30deg" },
};
/** How far a won trick travels when it sweeps to the seat that took it. */
const SWEEP: Record<Position, { x: string; y: string }> = {
  bottom: { x: "0px", y: "170px" },
  left: { x: "-240px", y: "0px" },
  top: { x: "0px", y: "-150px" },
  right: { x: "240px", y: "0px" },
};
/** Where the felt pulses when that seat wins a trick (uv, y up). */
const PULSE_AT: Record<Position, [number, number]> = {
  bottom: [0.5, 0.22],
  top: [0.5, 0.8],
  left: [0.14, 0.5],
  right: [0.86, 0.5],
};

export function SpadesTable({
  state, table, mySeat, onBid, onPlay, theme, fxLevel, onFxLevel, round, onCrumble,
  unlocked = false, onToggleUnlock, onCallRenig, scores,
}: Props) {
  const seated = mySeat >= 0;
  const viewFrom = seated ? mySeat : 0;
  const positionOf = (seat: number): Position => POSITIONS[(seat - viewFrom + 4) % 4];

  const myHand = seated ? sortHand(state.hands[mySeat] ?? []) : [];
  const myTurn = seated && state.currentTurn === mySeat;
  const nameOf = (seat: number) =>
    seat === mySeat ? "You" : table.find((t) => t.seat === seat)?.name.split(" ")[0] ?? "Someone";

  // The moments read only a settled call (state.renigCall), never the secret record.
  const fx = useSpadesMoments({ state, round, theme, level: fxLevel, nameOf });
  const { clash } = fx;

  useEffect(() => { onCrumble?.(fx.crumbleTeam); }, [fx.crumbleTeam]); // eslint-disable-line react-hooks/exhaustive-deps

  // The felt pulses out from whoever just won the trick.
  const [pulse, setPulse] = useState<FeltPulse | null>(null);
  useEffect(() => {
    if (!clash) return;
    const [x, y] = PULSE_AT[positionOf(clash.winner)];
    setPulse({ id: clash.id, x, y });
  }, [clash?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // A finished trick is held while it fights, then swept to the winner.
  const shownTrick = clash && state.currentTrick.length === 0 ? clash.trick : state.currentTrick;
  const sweeping = !!clash && clash.phase === "sweep" && state.currentTrick.length === 0;
  const sweepTo = sweeping ? SWEEP[positionOf(clash!.winner)] : null;
  const clashColor = clash ? theme.suits[getSuit(clash.trick.find((t) => t.seat === clash.winner)!.card) as SuitKey].color : "";

  // The hand leans toward the pointer and the foil follows it. Written to
  // CSS variables directly so moving the mouse never re-renders the table.
  const rootRef = useRef<HTMLDivElement>(null);
  const onPointerMove = (e: React.PointerEvent) => {
    const el = rootRef.current;
    if (!el || e.pointerType === "touch") return;
    const r = el.getBoundingClientRect();
    const nx = Math.max(-1, Math.min(1, ((e.clientX - r.left) / r.width) * 2 - 1));
    const ny = Math.max(-1, Math.min(1, ((e.clientY - r.top) / r.height) * 2 - 1));
    el.style.setProperty("--tx", `${(nx * 6).toFixed(2)}deg`);
    el.style.setProperty("--ty", `${(-ny * 4).toFixed(2)}deg`);
    el.style.setProperty("--sx", `${(50 + nx * 45).toFixed(1)}%`);
  };

  // Phones get "tap", laptops get "click".
  const [coarse, setCoarse] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia?.("(pointer: coarse)");
    if (!mq) return;
    setCoarse(mq.matches);
    const on = () => setCoarse(mq.matches);
    mq.addEventListener?.("change", on);
    return () => mq.removeEventListener?.("change", on);
  }, []);

  const turnName = table.find((t) => t.seat === state.currentTurn)?.name.split(" ")[0] ?? "Someone";
  const status = state.phase === "gameEnd"
    ? "Game over"
    : state.phase === "roundEnd"
      ? "Hand over"
    : state.phase === "bidding"
      ? myTurn ? "" : `${turnName} is calling a bid`
      : shownTrick.length === 0
        ? myTurn ? "Your lead" : `${turnName} to lead`
        : "";

  const renderSeat = (seat: SeatView) => {
    const position = positionOf(seat.seat);
    const isMe = seat.seat === mySeat;
    const cardsLeft = (state.hands[seat.seat] ?? []).length;
    return (
      <div key={seat.seat} className={`hx-seat hx-seat--${position}`}>
        <SeatPod
          seat={seat}
          isMe={isMe}
          bid={state.bids[seat.seat]}
          tricks={state.tricksWon[seat.seat] ?? 0}
          turn={state.currentTurn === seat.seat && state.phase !== "gameEnd"}
          dealer={state.dealer === seat.seat}
          nil={fx.shields[seat.seat]}
          nilColor={theme.nilShield.color}
          nilText={theme.nilShield.text}
        />
        {!isMe && seat.userId && state.phase !== "gameEnd" && cardsLeft > 0 && <BackFan count={cardsLeft} />}
      </div>
    );
  };

  return (
    <div
      ref={rootRef}
      className="hx-root"
      style={{
        "--hx-accent": theme.accent,
        "--hx-suit-S": theme.deck.S,
        "--hx-suit-H": theme.deck.H,
        "--hx-suit-D": theme.deck.D,
        "--hx-suit-C": theme.deck.C,
      } as React.CSSProperties}
      onPointerMove={onPointerMove}
    >
      <div className={cx("hx-stage", fx.shake)}>
        {/* The table, tilted away from you */}
        <div className="hx-table">
          <div className="hx-plane">
            <HoloFelt accent={theme.accent} felt={theme.felt} pulse={pulse} enabled={fxLevel !== "off"} />
            <div className={cx("hx-rim", (myTurn || !!clash) && "is-hot")} />

            {shownTrick.length > 0 && (
              <div
                className={cx("hx-trick", sweeping && "cc-trick-sweep")}
                style={sweepTo ? ({ "--cc-sweep-x": sweepTo.x, "--cc-sweep-y": sweepTo.y } as React.CSSProperties) : undefined}
              >
                {shownTrick.map((play) => {
                  const pos = positionOf(play.seat);
                  const look = clashStyle(state.currentTrick.length === 0 ? clash : null, play, theme);
                  return (
                    <div
                      key={`${play.seat}-${play.card}`}
                      className="hx-slot"
                      style={{ "--px": SLOT[pos].x, "--py": SLOT[pos].y, "--pr": SLOT[pos].r } as React.CSSProperties}
                    >
                      <div
                        className="hx-slot-in"
                        style={{ "--fx0": FROM[pos].x, "--fy0": FROM[pos].y, "--fr0": FROM[pos].r } as React.CSSProperties}
                      >
                        <div className={look.className} style={look.style}>
                          <PlayingCard card={play.card} size="xl" />
                          {look.hit && <span className={look.hit} aria-hidden="true" />}
                          {look.callout && <span className="fx-callout">{look.callout}</span>}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        {scores && (
          <>
            <div className="hx-total hx-total--us">
              <span>{seated ? "Us" : "Team 1"}</span>
              <b>{seated && getTeam(mySeat) === 2 ? scores.team2 : scores.team1}</b>
            </div>
            <div className="hx-total hx-total--them">
              <span>{seated ? "Them" : "Team 2"}</span>
              <b>{seated && getTeam(mySeat) === 2 ? scores.team1 : scores.team2}</b>
            </div>
          </>
        )}
        {state.spadeBroken && state.phase === "playing" && <span className="hx-badge">♠ Spades broken</span>}
        {status && <p className="hx-status">{status}</p>}

        {table.filter((s) => positionOf(s.seat) !== "bottom" || !seated).map(renderSeat)}
        {seated && renderSeat(table.find((s) => s.seat === mySeat)!)}

        {/* Bidding happens on the table */}
        {seated && state.phase === "bidding" && myTurn && (
          <BidWheel
            key={`${round}-bid`}
            hand={state.hands[mySeat] ?? []}
            partnerBid={state.bids[(mySeat + 2) % 4]}
            partnerName={nameOf((mySeat + 2) % 4)}
            onBid={onBid}
          />
        )}

        {clash?.phase === "clash" && clash.dur > 0 && state.currentTrick.length === 0 && (
          <div
            key={clash.id}
            className="fx-stage"
            style={{ "--fx-dur": `${clash.dur}ms`, "--fx-color": clashColor } as React.CSSProperties}
            aria-hidden="true"
          >
            <Burst count={6 + theme.clash.intensity * 5} emoji={clash.steal ? theme.confetti : undefined} />
          </div>
        )}
        <FxStage banner={fx.banner} />
      </div>

      {/* Your hand, held */}
      {seated && (
        <div className="hx-hand-zone">
          <div className="hx-hand-bar">
            <span className={cx("hx-turnline", myTurn && state.phase === "playing" && "is-mine")}>
              {state.phase === "playing" ? (myTurn ? "Your turn" : `${turnName} to play`) : ""}
            </span>
            {onToggleUnlock && (state.phase === "playing" || state.phase === "bidding") && myHand.length > 0 && (
              <button
                type="button"
                onClick={onToggleUnlock}
                aria-pressed={unlocked}
                title={unlocked ? "Back to following suit" : "Unlock every card in your hand"}
                className={cx("hx-btn hx-renig", unlocked && "is-on")}
              >
                Renig
              </button>
            )}
          </div>
          <HandFan
            key={`${round}-${myHand.length === 13 ? "fresh" : "held"}`}
            cards={myHand}
            fresh={myHand.length === 13}
            playableOf={(card) => {
              const live = myTurn && state.phase === "playing";
              const legal = live && isValidPlay(card, state.hands[mySeat] ?? [], state.currentTrick, state.spadeBroken);
              const playable = legal || (unlocked && live);
              // A faint red edge on an unlocked illegal card: only you see it.
              return { legal: playable, renege: playable && !legal };
            }}
            dimIllegal={myTurn && state.phase === "playing"}
            myTurn={myTurn && state.phase === "playing"}
            onCard={(card) => onPlay(card)}
          />
        </div>
      )}

      {!seated && (
        <p className="hx-hint" style={{ marginTop: 10 }}>You are watching this table. Take a free seat to play.</p>
      )}

      <div className="hx-controls">
        {seated && onCallRenig && (state.phase === "playing" || state.phase === "bidding") ? (
          <button type="button" className="hx-btn" onClick={onCallRenig} title="Accuse an opponent. Right and their team loses; wrong and yours does.">
            Call renig
          </button>
        ) : <span />}
        {seated && myTurn && state.phase === "playing" && (
          <p className="hx-hint hx-hint--inline">
            {unlocked
              ? "Every card is unlocked. Play anything, but if someone calls renig on you and you broke the rules, your team loses."
              : coarse
                ? "Tap a card to pick it, then tap it again or swipe it up to play. Dimmed cards can't be played."
                : "Click a card to pick it, then click it again to play. Dimmed cards can't be played."}
          </p>
        )}
        <div className="hx-seg">
          <span title={`Theme: ${theme.name}`}>{theme.icon} Effects</span>
          <div className="hx-seg-group">
            {FX_LEVELS.map((l) => (
              <button key={l.id} type="button" onClick={() => onFxLevel(l.id)} aria-pressed={fxLevel === l.id}>
                {l.label}
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

// --- your hand ----------------------------------------------------------------
//
// Playing a card takes two steps so nobody misplays (owner's rule, Oct 2026):
//   laptop  first click picks the card (it lifts and glows), the second plays it
//   phone   tap picks it, tap again (a double tap) plays it, or swipe it up
// Sliding a finger along the hand picks whichever card is under it.

const SWIPE_PLAY_PX = 56;
const MOVE_SLOP_PX = 10;

type Press = {
  id: number;
  x0: number;
  y0: number;
  card: string;
  /** The card was already picked when this press began. */
  wasPicked: boolean;
  mode: "tap" | "scrub" | "drag";
  touch: boolean;
};

function HandFan({
  cards, fresh, playableOf, dimIllegal, myTurn, onCard,
}: {
  cards: string[];
  fresh: boolean;
  playableOf: (card: string) => { legal: boolean; renege: boolean };
  dimIllegal: boolean;
  myTurn: boolean;
  onCard: (card: string) => void;
}) {
  const [hover, setHover] = useState<number | null>(null);
  const [picked, setPicked] = useState<string | null>(null);
  const [nope, setNope] = useState<string | null>(null);
  const [drag, setDrag] = useState<{ card: string; dy: number } | null>(null);
  const [touchy, setTouchy] = useState(false);
  const [dealing, setDealing] = useState(fresh);
  const press = useRef<Press | null>(null);
  const fanRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!dealing) return;
    const t = window.setTimeout(() => setDealing(false), 560 + cards.length * 38);
    return () => window.clearTimeout(t);
  }, [dealing, cards.length]);

  // A card left the hand: nothing stays picked.
  const handKey = cards.join(",");
  useEffect(() => { setPicked(null); setDrag(null); }, [handKey]);

  // Esc, or a click anywhere off the hand, puts the card back.
  useEffect(() => {
    if (!picked) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setPicked(null); };
    const onDown = (e: PointerEvent) => {
      if (fanRef.current && !fanRef.current.contains(e.target as Node)) setPicked(null);
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("pointerdown", onDown);
    return () => { window.removeEventListener("keydown", onKey); window.removeEventListener("pointerdown", onDown); };
  }, [picked]);

  const shake = useCallback((card: string) => {
    setNope(card);
    window.setTimeout(() => setNope((c) => (c === card ? null : c)), 360);
  }, []);

  /** The second step: play it if it can be played, otherwise shake it. */
  const attempt = useCallback((card: string) => {
    if (myTurn && playableOf(card).legal) {
      setPicked(null);
      setDrag(null);
      onCard(card);
    } else {
      setPicked(card);
      shake(card);
    }
  }, [myTurn, playableOf, onCard, shake]);

  // Which card is under a point. The hand is tilted in 3D, where the
  // browser's hit test and elementFromPoint can disagree, so this reads the
  // cards' own boxes: the top-most (right-most) card whose box holds the point.
  // `xOnly` is for sliding along the hand, where the finger drifts up and down.
  const cardAt = (x: number, y: number, xOnly = false): string | null => {
    const slots = fanRef.current?.querySelectorAll<HTMLElement>("[data-card]");
    if (!slots) return null;
    for (let i = slots.length - 1; i >= 0; i--) {
      const r = slots[i].getBoundingClientRect();
      if (x >= r.left && x <= r.right && (xOnly || (y >= r.top && y <= r.bottom))) return slots[i].dataset.card ?? null;
    }
    return null;
  };

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    const card = (e.target as HTMLElement).closest<HTMLElement>("[data-card]")?.dataset.card
      ?? cardAt(e.clientX, e.clientY);
    if (!card) return;
    const touch = e.pointerType !== "mouse";
    setTouchy(touch);
    press.current = { id: e.pointerId, x0: e.clientX, y0: e.clientY, card, wasPicked: picked === card, mode: "tap", touch };
    try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* old browsers */ }
    if (touch) setPicked(card); // a finger shows the card straight away
  };

  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const p = press.current;
    if (!p || p.id !== e.pointerId) return;
    const dx = e.clientX - p.x0;
    const dy = e.clientY - p.y0;
    if (p.mode === "tap") {
      if (dy < -MOVE_SLOP_PX && Math.abs(dy) > Math.abs(dx)) {
        p.mode = "drag";
        p.card = picked && p.touch ? picked : p.card;
        setPicked(p.card);
      } else if (p.touch && Math.abs(dx) > MOVE_SLOP_PX) {
        p.mode = "scrub";
      }
    }
    if (p.mode === "scrub") {
      const under = cardAt(e.clientX, e.clientY, true);
      if (under) { p.card = under; setPicked(under); }
      // Changing your mind mid-slide and flicking up still plays.
      if (dy < -MOVE_SLOP_PX * 2 && Math.abs(dy) > Math.abs(dx) / 2) {
        p.mode = "drag";
        p.y0 = e.clientY + MOVE_SLOP_PX;
      }
    }
    if (p.mode === "drag") setDrag({ card: p.card, dy: Math.min(0, e.clientY - p.y0) });
  };

  const onPointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    const p = press.current;
    if (!p || p.id !== e.pointerId) return;
    press.current = null;
    if (p.mode === "drag") {
      const dy = e.clientY - p.y0;
      setDrag(null);
      if (dy <= -SWIPE_PLAY_PX) attempt(p.card);
      return;
    }
    if (p.mode === "scrub") return; // the slide picked a card; it waits for a second tap
    if (p.wasPicked) attempt(p.card);
    else setPicked(p.card);
  };

  const onPointerCancel = () => { press.current = null; setDrag(null); };

  const n = cards.length;
  const mid = (n - 1) / 2;
  const pickedState = picked ? playableOf(picked) : null;
  const tag = !picked
    ? null
    : drag && drag.dy <= -SWIPE_PLAY_PX && myTurn && pickedState?.legal
      ? { text: "Let go to play", wait: false }
      : !myTurn
        ? { text: "Wait for your turn", wait: true }
        : !pickedState?.legal
          ? { text: "Follow the suit that was led", wait: true }
          : { text: touchy ? "Tap again or swipe up" : "Click again to play", wait: false };

  return (
    <div
      ref={fanRef}
      className={cx("hx-fan", dealing && "is-dealing")}
      style={{ "--n": n, "--mid": mid } as React.CSSProperties}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerCancel}
      onPointerLeave={() => setHover(null)}
    >
      <div className="hx-fan-shadow" />
      <div className="hx-fan-sway">
        {cards.map((card, i) => {
          const { legal, renege } = playableOf(card);
          const d = i - mid;
          const isPicked = picked === card;
          const isDragging = drag?.card === card;
          const lift = isPicked
            ? (legal && myTurn ? -40 : -18)
            : hover === i && !touchy
              ? (legal ? -16 : -6)
              : dimIllegal && !legal ? 10 : 0;
          return (
            <div
              key={card}
              data-card={card}
              className={cx("hx-fan-slot", isPicked && "is-picked", isDragging && "is-dragging", nope === card && "is-nope")}
              style={{
                "--i": i,
                "--arc": `${(d * d * 0.9).toFixed(1)}px`,
                "--rot": `${(d * 1.7).toFixed(2)}deg`,
                "--lift": `${lift}px`,
                "--drag": isDragging ? `${drag!.dy}px` : "0px",
                "--pop": isPicked ? 1.06 : 1,
                zIndex: isDragging ? 60 : isPicked ? 40 : i,
              } as React.CSSProperties}
              onPointerEnter={() => setHover(i)}
            >
              <button
                type="button"
                className={cx("hx-fan-hit", !legal && dimIllegal && "is-locked")}
                aria-label={`${cardLabel(card)}${legal ? "" : ", can't be played now"}${isPicked ? ". Picked: press again to play" : ""}`}
                aria-pressed={isPicked}
                onClick={(e) => {
                  // Keyboard only: pointer presses are handled on the fan.
                  if (e.detail !== 0) return;
                  if (picked === card) attempt(card);
                  else setPicked(card);
                }}
              >
                <PlayingCard
                  card={card}
                  size="hand"
                  dimmed={dimIllegal && !legal}
                  className={cx(renege && "hx-renege-card")}
                />
              </button>
              {isPicked && tag && <span className={cx("hx-pick-tag", tag.wait && "is-wait")}>{tag.text}</span>}
            </div>
          );
        })}
      </div>
    </div>
  );
}

const SUIT_WORD: Record<string, string> = { S: "spades", H: "hearts", D: "diamonds", C: "clubs" };
const RANK_WORD: Record<string, string> = { A: "Ace", K: "King", Q: "Queen", J: "Jack", T: "10" };
const cardLabel = (card: string) => {
  const rank = card.slice(0, -1);
  return `${RANK_WORD[rank] ?? rank} of ${SUIT_WORD[card.slice(-1)]}`;
};

// --- your bid -----------------------------------------------------------------
//
// One number at a time on a wheel (Nil, 1…13), arrows either side, and nothing
// is sent until you press Place Bid (owner's rule, Oct 2026). It opens on what
// the computer would bid with your hand, so a new player always has a sane start.

function BidWheel({
  hand, partnerBid, partnerName, onBid,
}: {
  hand: string[];
  partnerBid: number | null | undefined;
  partnerName: string;
  onBid: (bid: number) => void;
}) {
  const suggested = Math.max(0, Math.min(13, chooseBid(hand)));
  const [value, setValue] = useState(suggested);
  const [from, setFrom] = useState<"left" | "right" | null>(null);
  const [sent, setSent] = useState(false);
  const swipe = useRef<{ x: number; id: number } | null>(null);

  const step = (by: number) => {
    setValue((v) => {
      const next = Math.max(0, Math.min(13, v + by));
      if (next !== v) setFrom(by > 0 ? "right" : "left");
      return next;
    });
  };
  const place = () => {
    if (sent) return;
    setSent(true);
    onBid(value);
  };

  const label = (n: number) => (n === 0 ? "Nil" : String(n));
  const partnerIn = partnerBid !== null && partnerBid !== undefined;
  const team = value + (partnerIn ? partnerBid! : 0);

  return (
    <div className="hx-bid" role="group" aria-label="Your bid">
      <h3>How many of your cards do you think will win?</h3>
      <div
        className="hx-wheel"
        tabIndex={0}
        role="spinbutton"
        aria-valuemin={0}
        aria-valuemax={13}
        aria-valuenow={value}
        aria-valuetext={value === 0 ? "Nil" : `${value} tricks`}
        onKeyDown={(e) => {
          if (e.key === "ArrowRight" || e.key === "ArrowUp") { e.preventDefault(); step(1); }
          else if (e.key === "ArrowLeft" || e.key === "ArrowDown") { e.preventDefault(); step(-1); }
          else if (e.key === "Enter") { e.preventDefault(); place(); }
        }}
        onPointerDown={(e) => { swipe.current = { x: e.clientX, id: e.pointerId }; }}
        onPointerUp={(e) => {
          const s0 = swipe.current;
          swipe.current = null;
          if (!s0 || s0.id !== e.pointerId) return;
          const dx = e.clientX - s0.x;
          if (Math.abs(dx) > 30) step(dx < 0 ? 1 : -1);
        }}
      >
        <button type="button" className="hx-wheel-arrow" onClick={() => step(-1)} disabled={value === 0} aria-label="Bid lower">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round"><path d="M15 18l-6-6 6-6" /></svg>
        </button>
        <div className="hx-wheel-track">
          <span className={cx("hx-wheel-side", value === 0 && "is-empty")} onClick={() => step(-1)} aria-hidden="true">
            {value > 0 ? label(value - 1) : ""}
          </span>
          <span className="hx-wheel-now">
            <span key={value} className={cx("hx-wheel-num", value === 0 && "is-nil", from && `from-${from}`)}>
              {label(value)}
            </span>
            {value === suggested && <span className="hx-wheel-tip">Suggested</span>}
          </span>
          <span className={cx("hx-wheel-side", value === 13 && "is-empty")} onClick={() => step(1)} aria-hidden="true">
            {value < 13 ? label(value + 1) : ""}
          </span>
        </div>
        <button type="button" className="hx-wheel-arrow" onClick={() => step(1)} disabled={value === 13} aria-label="Bid higher">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round"><path d="M9 18l6-6-6-6" /></svg>
        </button>
      </div>
      {value === 0 && <p style={{ marginTop: 8 }}>Nil: take no tricks at all. +100 if it holds, −100 if it doesn&apos;t.</p>}
      <button type="button" className="hx-place" onClick={place} disabled={sent}>
        {sent ? "Bid placed" : "Place Bid"}
      </button>
      <p className="hx-bid-team">
        {partnerIn
          ? <>Your total team bid is <b>{team}</b> <span style={{ opacity: 0.7 }}>({partnerName} {label(partnerBid!)})</span></>
          : <>{partnerName} hasn&apos;t bid yet</>}
      </p>
    </div>
  );
}

// --- the other players --------------------------------------------------------

/** An opponent's hand: their cards held face down, in a small fan. */
function BackFan({ count }: { count: number }) {
  const n = Math.min(count, 13);
  const spread = n > 1 ? Math.min(8, 60 / (n - 1)) : 0;
  return (
    <div className="hx-backfan" aria-label={`${count} cards`}>
      {Array.from({ length: n }, (_, i) => (
        <PlayingCard
          key={i}
          faceDown
          size="sm"
          style={{ transform: `rotate(${((i - (n - 1) / 2) * spread).toFixed(2)}deg)` }}
        />
      ))}
    </div>
  );
}

function SeatPod({
  seat, isMe, bid, tricks, turn, dealer, nil, nilColor, nilText,
}: {
  seat: SeatView;
  isMe: boolean;
  bid: number | null;
  tricks: number;
  turn: boolean;
  dealer: boolean;
  nil?: NilFx;
  nilColor: string;
  nilText: string;
}) {
  const empty = !seat.userId;
  return (
    <div
      className={cx(
        "hx-pod",
        turn && "is-turn",
        empty && "is-empty",
        nil && "fx-nil",
        nil === "pulse" && "is-pulse",
        nil === "shatter" && "is-shatter",
      )}
      style={nil ? ({ "--fx-color": nilColor } as React.CSSProperties) : undefined}
    >
      {nil && nil !== "shatter" && <span className="fx-nil-label">{nilText}</span>}
      <span className="hx-avatar">
        {turn && <span className="hx-turn-ring" />}
        {empty ? null : seat.isBot ? (
          <BotIcon size={15} />
        ) : (
          <Avatar id={seat.userId} name={seat.name} url={seat.avatar} size={30} online={seat.online} />
        )}
      </span>
      <span className="flex min-w-0 flex-col">
        <span className={cx("hx-pod-name", isMe && "is-me")}>
          {empty ? "Open seat" : isMe ? "You" : seat.name.split(" ")[0]}
        </span>
        <span className="hx-team">
          T{getTeam(seat.seat)}
          {dealer && <span className="hx-chip" style={{ marginLeft: 5 }} title="Dealer">D</span>}
        </span>
      </span>
      {!empty && (
        <span className="flex flex-col items-end" title="Tricks taken / bid">
          <span className="hx-score">
            {tricks}
            <small>/{bid === null ? "?" : bid === 0 ? "nil" : bid}</small>
          </span>
          <span className="hx-score-label">won/bid</span>
        </span>
      )}
    </div>
  );
}
