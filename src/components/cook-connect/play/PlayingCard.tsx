"use client";

// A card. Face up it is a real index — rank and pip in both corners the way a
// deck is printed, so a fanned hand reads from the left edge alone.

import { getRank, getSuit, isRedSuit, RANK_DISPLAY, SUIT_SYMBOLS } from "@/lib/cook-connect/spades";
import { cx } from "../ui";

interface Props {
  card?: string;
  faceDown?: boolean;
  size?: "sm" | "md" | "lg";
  playable?: boolean;
  dimmed?: boolean;
  onClick?: () => void;
  className?: string;
  style?: React.CSSProperties;
}

const SIZES = {
  sm: "h-[38px] w-[27px] text-[10px]",
  md: "h-[56px] w-[40px] text-[12px]",
  lg: "h-[76px] w-[54px] text-[14px]",
};

const PIP = { sm: "text-[13px]", md: "text-[19px]", lg: "text-[26px]" };

export function PlayingCard({
  card, faceDown, size = "md", playable, dimmed, onClick, className, style,
}: Props) {
  if (faceDown || !card) {
    return (
      <div
        className={cx(
          "flex items-center justify-center rounded-md border border-[#2c3550] shadow-[var(--cc-shadow)]",
          SIZES[size],
          className,
        )}
        style={{
          background: "repeating-linear-gradient(45deg,#182034 0 4px,#141a2a 4px 8px)",
          ...style,
        }}
        aria-hidden="true"
      />
    );
  }

  const suit = getSuit(card);
  const rank = getRank(card);
  const red = isRedSuit(suit);
  const label = `${RANK_DISPLAY[rank]} of ${{ S: "spades", H: "hearts", D: "diamonds", C: "clubs" }[suit]}`;

  const face = (
    <>
      <span className={cx("absolute left-[3px] top-[1px] font-bold leading-tight", red ? "text-[#e4526f]" : "text-[#1b2030]")}>
        {RANK_DISPLAY[rank]}
      </span>
      <span className={cx(PIP[size], "leading-none", red ? "text-[#e4526f]" : "text-[#1b2030]")}>
        {SUIT_SYMBOLS[suit]}
      </span>
      <span
        className={cx(
          "absolute bottom-[1px] right-[3px] rotate-180 font-bold leading-tight",
          red ? "text-[#e4526f]" : "text-[#1b2030]",
        )}
      >
        {RANK_DISPLAY[rank]}
      </span>
    </>
  );

  const shell = cx(
    "relative flex items-center justify-center rounded-md border bg-[linear-gradient(170deg,#f6f4ef,#e3ded3)]",
    "shadow-[0_6px_14px_-8px_rgba(0,0,0,0.9)]",
    SIZES[size],
    dimmed && "opacity-40 saturate-50",
    className,
  );

  if (!onClick) {
    return (
      <div className={cx(shell, "border-[#c8c2b4]")} style={style} role="img" aria-label={label}>
        {face}
      </div>
    );
  }

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={!playable}
      aria-label={playable ? `Play the ${label}` : `${label} — not a legal play`}
      className={cx(
        shell,
        "transition-transform duration-150",
        playable
          ? "cursor-pointer border-[#c8c2b4] hover:-translate-y-2 hover:border-[var(--cc-ember)] active:translate-y-0"
          : "cursor-not-allowed border-[#c8c2b4]",
      )}
      style={style}
    >
      {face}
    </button>
  );
}
