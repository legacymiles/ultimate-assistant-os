"use client";

import type { Feature } from "@/lib/ai-rankings/types";

const TONE: Record<string, string> = {
  green: "border-emerald-500/25 bg-emerald-500/10 text-emerald-300",
  amber: "border-amber-500/25 bg-amber-500/10 text-amber-300",
  rose: "border-rose-500/25 bg-rose-500/10 text-rose-300",
  sky: "border-sky-500/25 bg-sky-500/10 text-sky-300",
  violet: "border-violet-500/25 bg-violet-500/10 text-violet-300",
  slate: "border-line bg-elevated text-ink-faint",
};

export type Tone = keyof typeof TONE;

/** A small factual badge — price, licence, hosting, key state. */
export function MetaPill({
  children,
  tone = "slate",
  title,
}: {
  children: React.ReactNode;
  tone?: Tone;
  title?: string;
}) {
  return (
    <span
      title={title}
      className={
        "inline-flex shrink-0 items-center gap-1 rounded border px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide " +
        TONE[tone]
      }
    >
      {children}
    </span>
  );
}

export function TagPill({
  tag,
  active = false,
  onClick,
}: {
  tag: string;
  active?: boolean;
  onClick?: (tag: string) => void;
}) {
  const cls =
    "shrink-0 rounded px-1.5 py-0.5 font-mono text-[10px] transition " +
    (active
      ? "bg-brand/20 text-brand"
      : "bg-elevated text-ink-faint" + (onClick ? " hover:bg-brand/15 hover:text-brand" : ""));

  if (!onClick) return <span className={cls}>{tag}</span>;

  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        onClick(tag);
      }}
      className={cls}
      aria-pressed={active}
    >
      {tag}
    </button>
  );
}

/** How a feature note reads at a glance. Love is the one that earns a rank. */
export const VERDICT_STYLE: Record<Feature["verdict"], { tone: Tone; mark: string; label: string }> =
  {
    love: { tone: "green", mark: "★", label: "Why I keep it" },
    good: { tone: "sky", mark: "+", label: "Good" },
    miss: { tone: "amber", mark: "−", label: "Missing" },
    dealbreaker: { tone: "rose", mark: "✕", label: "Dealbreaker" },
  };
