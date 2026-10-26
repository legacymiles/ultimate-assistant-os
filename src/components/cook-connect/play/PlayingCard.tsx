"use client";

// A card. Face up: a cool-white face with a thin inner frame, a bold corner
// index (readable from the left edge alone, which is all a fanned hand shows),
// monogram court cards, and a foil sheen that follows the hand's tilt. Face
// down: a graphite back etched in the table's accent. Each suit is printed in
// its own colour (the theme's four-colour deck), not just red and black.
//
// Every colour that belongs to the table comes from CSS variables set on the
// table (--hx-accent), so a theme swap restyles the backs too.

import "./holo-table.css";
import { getRank, getSuit, RANK_DISPLAY, SUIT_SYMBOLS } from "@/lib/cook-connect/spades";
import { cx } from "../ui";

export type CardSize = "sm" | "md" | "lg" | "xl" | "hand";

interface Props {
  card?: string;
  faceDown?: boolean;
  size?: CardSize;
  playable?: boolean;
  dimmed?: boolean;
  onClick?: () => void;
  className?: string;
  style?: React.CSSProperties;
  /** Hover / focus handlers, for a hand that lifts the card under the pointer. */
  onPointerEnter?: () => void;
  onPointerLeave?: () => void;
  onFocus?: () => void;
  onBlur?: () => void;
}

const SUIT_NAMES: Record<string, string> = { S: "spades", H: "hearts", D: "diamonds", C: "clubs" };

export function PlayingCard({
  card, faceDown, size = "md", playable, dimmed, onClick, className, style,
  onPointerEnter, onPointerLeave, onFocus, onBlur,
}: Props) {
  if (faceDown || !card) {
    return (
      <div className={cx("hx-card hx-card--back", `hx-card--${size}`, className)} style={style} aria-hidden="true">
        <span className="hx-back-etch" />
        <span className="hx-back-emblem">♠</span>
      </div>
    );
  }

  const suit = getSuit(card);
  const rank = getRank(card);
  const label = `${RANK_DISPLAY[rank]} of ${SUIT_NAMES[suit]}`;
  const court = rank === "J" || rank === "Q" || rank === "K";
  const ace = rank === "A";

  const face = (
    <>
      <span className="hx-frame" />
      <span className="hx-index">
        <span className={cx("hx-rank", rank === "T" && "hx-rank--ten")}>{RANK_DISPLAY[rank]}</span>
        <span className="hx-pip">{SUIT_SYMBOLS[suit]}</span>
      </span>
      <span className="hx-index hx-index--flip">
        <span className={cx("hx-rank", rank === "T" && "hx-rank--ten")}>{RANK_DISPLAY[rank]}</span>
        <span className="hx-pip">{SUIT_SYMBOLS[suit]}</span>
      </span>
      {court ? (
        <span className="hx-court">
          <span className="hx-court-letter">{rank}</span>
          <span className="hx-court-pip">{SUIT_SYMBOLS[suit]}</span>
        </span>
      ) : (
        <span className={cx("hx-center", ace && "hx-center--ace", ace && suit === "S" && "hx-center--spade-ace")}>
          {SUIT_SYMBOLS[suit]}
        </span>
      )}
      <span className="hx-sheen" />
    </>
  );

  const shell = cx(
    "hx-card hx-card--face",
    `hx-card--${size}`,
    // Four-colour deck: each suit has its own ink (--hx-suit-S/H/D/C from the theme).
    `hx-suit-${suit}`,
    dimmed && "hx-dimmed",
    className,
  );

  if (!onClick) {
    return (
      <div className={shell} style={style} role="img" aria-label={label}>
        {face}
      </div>
    );
  }

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={!playable}
      aria-label={playable ? `Play the ${label}` : `${label}, not a legal play`}
      className={cx(shell, playable ? "hx-playable" : "hx-locked")}
      style={style}
      onPointerEnter={onPointerEnter}
      onPointerLeave={onPointerLeave}
      onFocus={onFocus}
      onBlur={onBlur}
    >
      {face}
    </button>
  );
}
