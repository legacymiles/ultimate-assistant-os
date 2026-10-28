"use client";

// Your own 1–10 rank for a recipe — "a banana sundae is an 8 in my cookbook".
// Only you see your ranks; they drive the "rank above 4 / 6 / 8" filters.

import { useState } from "react";
import { rankWord } from "@/lib/cook-connect/categories";
import { cx } from "../ui";

const STEPS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];

/** The heat of a rank: cool at 1, ember at 10. */
export const rankHue = (rank: number) => Math.round(200 - (rank - 1) * (180 / 9));

export function RankPicker({
  value, onChange, compact,
}: { value: number | null; onChange: (rank: number | null) => void; compact?: boolean }) {
  const [hover, setHover] = useState<number | null>(null);
  const shown = hover ?? value;
  return (
    <div className="space-y-2">
      <div className="flex items-baseline justify-between gap-2">
        <span className="flex items-baseline gap-1.5">
          <span
            key={shown ?? 0}
            className={cx("cc-num cc-pop font-bold leading-none", compact ? "text-[22px]" : "text-[30px]")}
            style={{ color: shown ? `hsl(${rankHue(shown)} 85% 62%)` : "var(--cc-ink-faint)" }}
          >
            {shown ?? "–"}
          </span>
          <span className="cc-num text-[12px] text-[var(--cc-ink-faint)]">/10</span>
          {shown && <span className="ml-1 text-[12px] font-semibold text-[var(--cc-ink-muted)]">{rankWord(shown)}</span>}
        </span>
        {value && (
          <button
            type="button"
            onClick={() => onChange(null)}
            className="text-[11px] text-[var(--cc-ink-faint)] transition-colors hover:text-[var(--cc-loss)]"
          >
            Clear
          </button>
        )}
      </div>
      <div
        role="radiogroup"
        aria-label="Your rank out of 10"
        className="grid grid-cols-10 gap-1"
        onMouseLeave={() => setHover(null)}
      >
        {STEPS.map((n) => {
          const lit = shown !== null && n <= shown;
          return (
            <button
              key={n}
              type="button"
              role="radio"
              aria-checked={value === n}
              aria-label={`${n} out of 10`}
              onMouseEnter={() => setHover(n)}
              onFocus={() => setHover(n)}
              onBlur={() => setHover(null)}
              onClick={() => onChange(value === n ? null : n)}
              className={cx(
                "cc-num flex items-center justify-center rounded-md border font-semibold",
                "transition-[transform,background-color,border-color,color] duration-150 active:scale-90",
                compact ? "h-7 text-[11px]" : "h-9 text-[13px]",
                lit ? "border-transparent text-[#140a03]" : "border-[var(--cc-line)] text-[var(--cc-ink-faint)] hover:text-[var(--cc-ink)]",
              )}
              style={lit ? { background: `hsl(${rankHue(n)} 80% 58%)` } : undefined}
            >
              {n}
            </button>
          );
        })}
      </div>
    </div>
  );
}

/** A small "8" chip for cards and rows. */
export function RankBadge({ rank, size = "sm" }: { rank: number; size?: "sm" | "md" }) {
  return (
    <span
      title={`You ranked this ${rank}/10`}
      className={cx(
        "cc-num inline-flex items-center gap-0.5 rounded-full font-bold text-[#140a03] shadow-[0_2px_10px_-2px_rgba(0,0,0,0.6)]",
        size === "md" ? "px-2.5 py-1 text-[13px]" : "px-2 py-0.5 text-[11px]",
      )}
      style={{ background: `hsl(${rankHue(rank)} 82% 60%)` }}
    >
      {rank}
      <span className="opacity-60">/10</span>
    </span>
  );
}
