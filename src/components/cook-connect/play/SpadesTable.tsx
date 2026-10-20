"use client";

// The holo table: a tilted oval of WebGL felt on a dark stage, opponents'
// hands held as fans of card backs around it, and your hand held as a curved
// fan at the bottom, as if an invisible hand were holding the cards.
//
// Seats are drawn relative to you (you are always at the bottom) because a
// partnership game is only readable when "across from me" means your partner.
// Every colour comes from the active Game Play Design Styling theme.

import { useEffect, useRef, useState } from "react";
import "./holo-table.css";
import type { GameState } from "@/lib/cook-connect/spades";
import { getSuit, getTeam, isValidPlay, sortHand } from "@/lib/cook-connect/spades";
import type { FxLevel, GameTheme, SuitKey } from "@/lib/cook-connect/gameStyle";
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
  bottom: { x: "0px", y: "34px", r: "-3deg" },
  top: { x: "0px", y: "-34px", r: "4deg" },
  left: { x: "-46px", y: "0px", r: "-9deg" },
  right: { x: "46px", y: "0px", r: "7deg" },
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
  unlocked = false, onToggleUnlock, onCallRenig,
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

  const turnName = table.find((t) => t.seat === state.currentTurn)?.name.split(" ")[0] ?? "Someone";
  const status = state.phase === "gameEnd"
    ? "Game over"
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
      style={{ "--hx-accent": theme.accent } as React.CSSProperties}
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
                          <PlayingCard card={play.card} size="lg" />
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

        {state.spadeBroken && state.phase === "playing" && <span className="hx-badge">♠ Spades broken</span>}
        {status && <p className="hx-status">{status}</p>}

        {table.filter((s) => positionOf(s.seat) !== "bottom" || !seated).map(renderSeat)}
        {seated && renderSeat(table.find((s) => s.seat === mySeat)!)}

        {/* Bidding happens on the table */}
        {seated && state.phase === "bidding" && myTurn && (
          <div className="hx-bid" role="group" aria-label="Your bid">
            <h3>Your call</h3>
            <p>How many tricks will you take? Nil bets you take none: +100 if it holds, -100 if not.</p>
            <div className="hx-bid-grid">
              {Array.from({ length: 14 }, (_, n) => (
                <button key={n} type="button" onClick={() => onBid(n)} className={cx("hx-bid-chip", n === 0 && "is-nil")}>
                  {n === 0 ? "Nil" : n}
                </button>
              ))}
            </div>
          </div>
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
              : "Follow the suit that was led if you can. Cards you can't play are dimmed."}
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

function HandFan({
  cards, fresh, playableOf, dimIllegal, onCard,
}: {
  cards: string[];
  fresh: boolean;
  playableOf: (card: string) => { legal: boolean; renege: boolean };
  dimIllegal: boolean;
  onCard: (card: string) => void;
}) {
  const [hover, setHover] = useState<number | null>(null);
  const [dealing, setDealing] = useState(fresh);
  useEffect(() => {
    if (!dealing) return;
    const t = window.setTimeout(() => setDealing(false), 560 + cards.length * 38);
    return () => window.clearTimeout(t);
  }, [dealing, cards.length]);

  const n = cards.length;
  // A tight fan: the more cards, the closer they sit, like a real hand.
  const spread = n > 1 ? Math.min(6, 54 / (n - 1)) : 0;

  return (
    <div className={cx("hx-fan", dealing && "is-dealing")} onPointerLeave={() => setHover(null)}>
      <div className="hx-fan-shadow" />
      <div className="hx-fan-sway">
        {cards.map((card, i) => {
          const { legal, renege } = playableOf(card);
          const part = hover === null ? 0 : i < hover ? -1.8 : i > hover ? 1.8 : 0;
          const angle = (i - (n - 1) / 2) * spread + part;
          const lift = hover === i && legal ? -26 : hover === i ? -10 : dimIllegal && !legal ? 8 : 0;
          return (
            <div
              key={card}
              className="hx-fan-slot"
              style={{ "--a": `${angle.toFixed(2)}deg`, "--lift": `${lift}px`, "--i": i, zIndex: i } as React.CSSProperties}
            >
              <PlayingCard
                card={card}
                size="xl"
                playable={legal}
                dimmed={dimIllegal && !legal}
                className={cx(renege && "hx-renege-card")}
                onPointerEnter={() => setHover(i)}
                onFocus={() => setHover(i)}
                onBlur={() => setHover(null)}
                onClick={() => onCard(card)}
              />
            </div>
          );
        })}
      </div>
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
