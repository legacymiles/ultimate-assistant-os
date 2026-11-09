"use client";

import { useEffect, useRef } from "react";
import type { ReactNode } from "react";
import { isFresh } from "@/lib/ai-rankings/leaderboard";
import type { Model, ScoreBreakdown } from "@/lib/ai-rankings/leaderboard";
import { ACCESS_LABEL } from "@/lib/ai-rankings/types";

/**
 * A 0–100 meter. One hue for every bar on the board: the bars are one measure,
 * so colour carries nothing a second hue could add, and the number beside each
 * bar is in ink, never in the bar's colour.
 */
export function ScoreBar({ score, className = "" }: { score: ScoreBreakdown; className?: string }) {
  const total = score.total;
  const parts = [
    score.publicPart !== null ? `public ${Math.round(score.publicPart)}` : null,
    score.ownerPart !== null ? `curator ${Math.round(score.ownerPart)}` : null,
  ].filter(Boolean);
  return (
    <div
      className={`flex items-center gap-2 ${className}`}
      title={total === null ? "Not scored yet" : `Score ${total} — ${parts.join(" · ")}`}
    >
      <div className="relative h-1.5 min-w-0 flex-1 overflow-hidden rounded-full bg-panel-2" aria-hidden="true">
        {total !== null && (
          // scaleX rather than width: a transform is composited, so a list of
          // forty bars doesn't relayout on every render.
          <div
            className="absolute inset-y-0 left-0 w-full origin-left rounded-full bg-brand transition-transform duration-500 ease-out motion-reduce:transition-none"
            style={{ transform: `scaleX(${Math.max(2, total) / 100})` }}
          />
        )}
      </div>
      <span className="w-9 shrink-0 text-right font-mono text-[12px] tabular-nums text-ink">
        {total === null ? <span className="text-ink-muted">—</span> : Math.round(total)}
      </span>
    </div>
  );
}

export function RankMark({ rank, size = "md" }: { rank?: number; size?: "md" | "lg" }) {
  const big = size === "lg";
  if (rank === undefined) {
    return (
      <span className={`font-mono tabular-nums text-ink-muted ${big ? "text-base" : "text-[12px]"}`}>
        <span aria-hidden="true">–</span>
        <span className="sr-only">Unranked</span>
      </span>
    );
  }
  const podium = rank <= 3;
  return (
    // aria-label is ignored on a plain span, so the words are real text.
    <span className={`font-mono font-semibold tabular-nums ${podium ? "text-ink" : "text-ink-muted"} ${big ? "text-base" : "text-[12px]"}`}>
      <span className="sr-only">Rank </span>
      {rank}
    </span>
  );
}

/** Small square flags: state, not decoration, so each one says its word. */
export function Flag({ children, tone = "plain", title }: { children: ReactNode; tone?: "plain" | "open" | "fresh" | "warn"; title?: string }) {
  const tones = {
    plain: "border-line text-ink-muted",
    open: "border-core/40 text-core",
    fresh: "border-accent/40 text-accent",
    warn: "border-rose-400/40 text-rose-300",
  } as const;
  return (
    <span title={title} className={`inline-flex items-center rounded-[4px] border px-1.5 py-px text-[10.5px] font-medium leading-4 ${tones[tone]}`}>
      {children}
    </span>
  );
}

export function ModelFlags({ m, now, compact = false }: { m: Model; now: number; compact?: boolean }) {
  return (
    <span className="flex flex-wrap items-center gap-1">
      {isFresh(m, now) && <Flag tone="fresh" title="Released in the last 14 days">New</Flag>}
      {m.openSource && <Flag tone="open" title="Open source or open weights">Open</Flag>}
      {!compact && m.runsLocally && <Flag title="Weights you can run on your own GPU">Local</Flag>}
      {!compact && m.access !== "paid" && <Flag>{ACCESS_LABEL[m.access]}</Flag>}
      {m.contentRating === "explicit" && <Flag tone="warn" title="No content filter">18+</Flag>}
    </span>
  );
}

/** A two-state chip. Pressed state is announced, not just coloured. */
export function Toggle({ on, onClick, children }: { on: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      aria-pressed={on}
      onClick={onClick}
      className={`inline-flex min-h-8 shrink-0 items-center gap-1.5 rounded-md border px-2.5 py-1 text-[12px] font-medium transition duration-150 active:scale-[0.97] pointer-coarse:min-h-11 ${
        on ? "border-brand bg-brand/15 text-ink" : "border-line text-ink-muted hover:border-ink-faint hover:text-ink"
      }`}
    >
      {on && <span className="h-1.5 w-1.5 rounded-full bg-brand" aria-hidden="true" />}
      {children}
    </button>
  );
}

/** Right-hand slide-over; full width on a phone. Escape and the backdrop close it. */
export function SlideOver({
  open,
  onClose,
  label,
  children,
  wide = false,
}: {
  open: boolean;
  onClose: () => void;
  label: string;
  children: ReactNode;
  wide?: boolean;
}) {
  const panel = useRef<HTMLElement>(null);
  const opener = useRef<Element | null>(null);

  useEffect(() => {
    if (!open) return;
    // Remember the row that opened it, so Escape puts the keyboard back there.
    opener.current = document.activeElement;
    const el = panel.current;
    const first = focusables(el)[0];
    if (first) first.focus();
    else el?.focus();

    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") return onClose();
      if (e.key !== "Tab" || !el) return;
      // aria-modal alone doesn't stop Tab, so the cycle is kept by hand:
      // without this, tabbing walks the page behind the backdrop.
      const items = focusables(el);
      if (items.length === 0) return;
      const first = items[0];
      const last = items[items.length - 1];
      const active = document.activeElement;
      if (!e.shiftKey && active === last) {
        e.preventDefault();
        first.focus();
      } else if (e.shiftKey && (active === first || !el.contains(active))) {
        e.preventDefault();
        last.focus();
      }
    };

    window.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
      (opener.current as HTMLElement | null)?.focus?.();
    };
  }, [open, onClose]);

  if (!open) return null;
  return (
    <div className="fixed inset-0 z-40 flex justify-end bg-black/55 backdrop-blur-[2px]" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <aside
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-label={label}
        tabIndex={-1}
        className={`animate-fade-in flex h-full w-full flex-col border-l border-line bg-elevated ${wide ? "sm:max-w-xl" : "sm:max-w-lg"}`}
      >
        {children}
      </aside>
    </div>
  );
}

const FOCUSABLE =
  'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';

function focusables(root: HTMLElement | null): HTMLElement[] {
  if (!root) return [];
  return [...root.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((el) => el.offsetParent !== null);
}
