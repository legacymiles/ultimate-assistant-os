"use client";

// The pieces of a spades hand that happen around the cards, not with them:
//
//   DealPanel        your deal: a big "Shuffle" button riffles a deck in the
//                    middle of the felt, then "Stop & deal" deals at once.
//                    Someone else's deal: a small "Ace is dealing" card.
//   DealBurst        the deal itself: cards fly from the middle to each seat
//                    and a blur clears into the new hand. Under a second.
//   FinalHandRibbon  this hand could end the game, with what each side needs.
//   TalkBubble       a computer player's speech bubble at their seat.
//
// Words come from the theme (Game Play Design Styling); every animation stops
// for reduced motion.

import { useEffect, useRef, useState } from "react";
import type { FinalHandThreat } from "@/lib/cook-connect/spades";
import type { GameTheme } from "@/lib/cook-connect/gameStyle";
import { sounds } from "@/lib/cook-connect/sounds";
import { cx } from "../ui";
import { PlayingCard } from "./PlayingCard";

type Position = "bottom" | "left" | "top" | "right";

/** How long the shuffle runs before it stops and deals by itself. */
const AUTO_DEAL_MS = 2600;

export function DealPanel({
  mine, dealerName, firstName, onDeal,
}: {
  /** It is your deal. */
  mine: boolean;
  dealerName: string;
  /** Who sits to the dealer's left: bids first and leads. */
  firstName: string;
  onDeal?: () => void;
}) {
  const [shuffling, setShuffling] = useState(false);
  const [dealt, setDealt] = useState(false);
  const timer = useRef<number | null>(null);
  const riffle = useRef<number | null>(null);

  useEffect(() => () => {
    if (timer.current) window.clearTimeout(timer.current);
    if (riffle.current) window.clearInterval(riffle.current);
  }, []);

  const deal = () => {
    if (dealt) return;
    setDealt(true);
    if (timer.current) window.clearTimeout(timer.current);
    if (riffle.current) window.clearInterval(riffle.current);
    onDeal?.();
  };

  const shuffle = () => {
    if (shuffling || dealt) return;
    setShuffling(true);
    sounds.cardDeal();
    riffle.current = window.setInterval(() => sounds.cardDeal(), 260);
    // Never block the game: a shuffle left running deals by itself.
    timer.current = window.setTimeout(deal, AUTO_DEAL_MS);
  };

  if (!mine) {
    return (
      <div className="hx-deal is-watch" role="status">
        <Deck shuffling />
        <p className="hx-deal-line"><b>{dealerName}</b> {dealerName === "You" ? "are" : "is"} dealing…</p>
        <p className="hx-deal-sub">{firstName} bids first and leads.</p>
      </div>
    );
  }

  return (
    <div className="hx-deal" role="group" aria-label="Your deal">
      <p className="hx-deal-kicker">Your deal</p>
      <Deck shuffling={shuffling} />
      {!shuffling ? (
        <button type="button" className="hx-shuffle" onClick={shuffle}>
          <span className="hx-shuffle-glow" aria-hidden="true" />
          <span className="hx-shuffle-icon" aria-hidden="true">⇄</span>
          Shuffle
        </button>
      ) : (
        <button type="button" className="hx-shuffle is-deal" onClick={deal} disabled={dealt}>
          <span className="hx-shuffle-glow" aria-hidden="true" />
          {dealt ? "Dealing…" : <>Stop &amp; deal <span className="chev">›</span></>}
          {!dealt && <span className="hx-shuffle-timer" aria-hidden="true" />}
        </button>
      )}
      <p className="hx-deal-sub">{firstName} bids first and leads.</p>
    </div>
  );
}

/** A small deck in the middle of the table; split and riffle while shuffling. */
function Deck({ shuffling }: { shuffling: boolean }) {
  return (
    <div className={cx("hx-deck", shuffling && "is-shuffling")} aria-hidden="true">
      {Array.from({ length: 6 }, (_, i) => (
        <span key={i} className="hx-deck-card" style={{ "--k": i } as React.CSSProperties}>
          <PlayingCard faceDown size="md" />
        </span>
      ))}
    </div>
  );
}

const TO: Record<Position, { x: string; y: string }> = {
  bottom: { x: "0px", y: "190px" },
  top: { x: "0px", y: "-170px" },
  left: { x: "-210px", y: "0px" },
  right: { x: "210px", y: "0px" },
};

/** Cards fly out to every seat, then a blur clears into the hand. */
export function DealBurst({ to, reduced }: { to: Position[]; reduced: boolean }) {
  const [on, setOn] = useState(true);
  useEffect(() => {
    const t = window.setTimeout(() => setOn(false), reduced ? 200 : 900);
    return () => window.clearTimeout(t);
  }, [reduced]);
  if (!on) return null;
  return (
    <div className="hx-dealburst" aria-hidden="true">
      <span className="hx-dealblur" />
      {!reduced && Array.from({ length: 16 }, (_, i) => {
        const pos = to[i % 4];
        return (
          <span
            key={i}
            className="hx-dealfly"
            style={{
              "--dx": TO[pos].x, "--dy": TO[pos].y, "--d": `${i * 28}ms`, "--r": `${((i * 47) % 50) - 25}deg`,
            } as React.CSSProperties}
          >
            <PlayingCard faceDown size="md" />
          </span>
        );
      })}
    </div>
  );
}

/** The hand that could end it, and what each side needs. */
export function FinalHandRibbon({
  theme, threats, myTeam,
}: {
  theme: GameTheme;
  threats: FinalHandThreat[];
  myTeam: number | null;
}) {
  const teams = threats.map((t) => t.team);
  const words = teams.length > 1 || !myTeam
    ? theme.finalHand.both
    : teams[0] === myTeam ? theme.finalHand.us : theme.finalHand.text;
  const who = (team: number) => (!myTeam ? `Team ${team}` : team === myTeam ? "You" : "They");
  return (
    <div className="hx-final" style={{ "--fire": theme.finalHand.color } as React.CSSProperties} role="status">
      <span className="hx-final-dot" aria-hidden="true" />
      <b>{words}</b>
      <span>
        {threats
          .map((t) => theme.finalHand.need.replace("{who}", who(t.team)).replace("{n}", String(t.need)))
          .join(" · ")}
      </span>
    </div>
  );
}

/** A computer player's line, at their seat. Short-lived, never in the way. */
export function TalkBubble({ text, position }: { text: string; position: Position }) {
  return (
    <span className={`hx-talk hx-talk--${position}`} role="status" aria-live="polite">
      {text}
    </span>
  );
}
