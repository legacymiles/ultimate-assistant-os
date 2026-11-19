"use client";

import { useEffect, useRef } from "react";
import type { ReactNode } from "react";
import { formatMetric, isFresh } from "@/lib/ai-rankings/leaderboard";
import type { Dimension, DimValue, Model, ScoreBreakdown } from "@/lib/ai-rankings/leaderboard";
import { ACCESS_LABEL } from "@/lib/ai-rankings/types";

/**
 * A 0–100 meter. One hue for every bar on the board: the bars are one measure,
 * so colour carries nothing a second hue could add, and the number beside each
 * bar is in ink, never in the bar's colour.
 */
export function ScoreBar({ score, className = "" }: { score: ScoreBreakdown; className?: string }) {
  const total = score.total;
  const top = [...score.dims]
    .filter((v) => v.value !== null)
    .sort((a, b) => b.dim.weight - a.dim.weight)
    .slice(0, 3)
    .map((v) => `${v.dim.label} ${Math.round(v.value!)}`);
  return (
    <div
      className={`flex items-center gap-2 ${className}`}
      title={
        total === null
          ? score.of
            ? "Not scored yet — no benchmark, rating or measurement for it"
            : "Not scored yet"
          : `Score ${total} — blended from ${score.known} of ${score.of} dimensions${top.length ? `, led by ${top.join(", ")}` : ""}`
      }
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

// ----- the score columns ---------------------------------------------------
//
// One 0–100 per dimension, laid out as a table: the same cell width in the
// header and in every row, so a column reads down the page. Colour carries
// nothing a second hue could add — every cell is the same measure — so the
// one thing it does say is where the number came from: a derived value
// (age, openness, a price guessed from "free") is drawn faint, because it is
// weaker evidence than a benchmark, a rating or a measurement.

/** Identical in the header and the rows, which is what makes a column a column. */
const CELL = "w-[30px] shrink-0";

export function dimTitle(v: DimValue): string {
  const where =
    v.from === "metric" && v.raw !== undefined && v.dim.metric
      ? formatMetric(v.raw, v.dim.metric)
      : v.from === "bench"
        ? "from the public leaderboard"
        : v.from === "rated"
          ? "the curator's rating"
          : v.from === "auto"
            ? "worked out from the record"
            : "not scored yet";
  const n = v.value === null ? "—" : Math.round(v.value);
  const share =
    v.from === "auto"
      ? `${v.dim.weight}% of the score, counted at half while it is only worked out from the record`
      : `${v.dim.weight}% of the score`;
  return `${v.dim.label}: ${n} · ${where} · ${share}\n${v.dim.hint}`;
}

/** The column heads: each one sorts the list by that dimension. */
export function DimHeader({
  dims,
  sort,
  onSort,
}: {
  dims: Dimension[];
  sort: string;
  onSort: (id: string) => void;
}) {
  return (
    <span className="hidden items-end gap-0.5 xl:flex">
      {dims.map((d) => (
        <button
          key={d.id}
          type="button"
          onClick={() => onSort(d.id)}
          aria-pressed={sort === d.id}
          title={`Sort by ${d.label} — ${d.hint} · ${d.weight}% of the score`}
          className={`${CELL} rounded py-0.5 text-center font-mono text-[9.5px] uppercase tracking-wider transition ${
            sort === d.id ? "bg-brand/15 text-ink" : "text-ink-muted hover:bg-panel-2 hover:text-ink"
          }`}
        >
          {d.code}
          <span className="sr-only"> — {d.label}</span>
        </button>
      ))}
    </span>
  );
}

/** One row of score cells, aligned under DimHeader. */
export function DimCells({ dims, sort }: { dims: DimValue[]; sort?: string }) {
  return (
    <span className="hidden items-center gap-0.5 xl:flex">
      {dims.map((v) => {
        const n = v.value;
        const faint = v.from === "auto";
        return (
          <span
            key={v.dim.id}
            title={dimTitle(v)}
            className={`${CELL} rounded px-0.5 pb-0.5 pt-1 text-center ${sort === v.dim.id ? "bg-brand/10" : ""}`}
          >
            <span className="sr-only">{v.dim.label}: </span>
            <span className={`block font-mono text-[11px] tabular-nums ${n === null ? "text-ink-faint" : faint ? "text-ink-muted" : "text-ink"}`}>
              {n === null ? <span aria-hidden="true">·</span> : Math.round(n)}
              {n === null && <span className="sr-only">not scored</span>}
            </span>
            <span className="mt-1 block h-[2px] overflow-hidden rounded-full bg-panel-2" aria-hidden="true">
              {n !== null && (
                <span
                  className={`block h-full w-full origin-left rounded-full bg-brand ${faint ? "opacity-40" : ""}`}
                  style={{ transform: `scaleX(${Math.max(0.04, n / 100)})` }}
                />
              )}
            </span>
          </span>
        );
      })}
    </span>
  );
}

/**
 * The same numbers where there is no room for a table.
 *
 * Below the column layout every score still shows, as chips under the model's
 * name — the empty ones left out, because a phone has no column for a reader
 * to notice a gap in. The sheet has the full list either way.
 */
export function DimChips({ dims, max = 6 }: { dims: DimValue[]; max?: number }) {
  const known = dims.filter((v) => v.value !== null);
  if (!known.length) return null;
  const shown = known.slice(0, max);
  const rest = known.length - shown.length;
  return (
    <span className="mt-1.5 flex flex-wrap items-center gap-1 xl:hidden">
      {shown.map((v) => (
        <span
          key={v.dim.id}
          title={dimTitle(v)}
          className="inline-flex items-baseline gap-1 rounded-[4px] border border-line px-1 py-px font-mono text-[10px] leading-4"
        >
          <span className="text-ink-muted">{v.dim.code}</span>
          <span className={v.from === "auto" ? "text-ink-muted" : "text-ink"}>{Math.round(v.value!)}</span>
        </span>
      ))}
      {rest > 0 && <span className="font-mono text-[10px] text-ink-muted">+{rest}</span>}
    </span>
  );
}

/** "6 of 9 scored" — how much of a category's weight this row is actually made of. */
export function Coverage({ score, className = "" }: { score: ScoreBreakdown; className?: string }) {
  if (!score.of) return null;
  const thin = score.coverage < 0.5;
  return (
    <span
      className={`font-mono text-[10.5px] tabular-nums text-ink-muted ${className}`}
      title={`${score.known} of ${score.of} dimensions have a number — ${Math.round(score.coverage * 100)}% of this category's weight.${
        thin ? " A thin row: the score is made of less than most." : ""
      }`}
    >
      {score.known}/{score.of}
    </span>
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
