"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { motion, useReducedMotion } from "motion/react";
import { fmtMoney, fmtPct } from "@/lib/buildflip-2/calc";
import type { Comp } from "@/lib/buildflip-2/types";
import { cn, spring } from "@/lib/buildflip-2/ui";

/**
 * THE MARGIN BEAM — the toy.
 *
 * A rail from cost to the top of the sold range. Behind it, every completed
 * sale we found is plotted as a tick, so the distribution is visible. The notch
 * sits at the comp midpoint; grab it and drag, and profit, margin and $/hour
 * recompute live against the real distribution. Let go and it springs back to
 * the comp-derived estimate with a weighted settle.
 *
 * It exists to make one specific self-deception impossible: picking a price off
 * an asking listing. Here your drag is always plotted against what things
 * actually sold for, and asking prices are drawn hollow and never counted.
 *
 * Content never depends on the toy: the numbers are rendered as text beside it,
 * it is fully keyboard-operable as a slider, and with reduced motion the
 * spring becomes an instant set.
 */

export interface MarginBeamProps {
  cost: number;
  compLow: number;
  compMid: number;
  compHigh: number;
  comps: Comp[];
  hours: number;
  hourlyTarget: number;
  /** The user's own asking price, if they've set one. */
  value: number | null;
  onChange?: (value: number | null) => void;
  /** Read-only on shared plans. */
  readOnly?: boolean;
  className?: string;
}

export default function MarginBeam({
  cost,
  compLow,
  compMid,
  compHigh,
  comps,
  hours,
  hourlyTarget,
  value,
  onChange,
  readOnly,
  className,
}: MarginBeamProps) {
  const reduced = useReducedMotion();
  const trackRef = useRef<HTMLDivElement | null>(null);
  const [dragging, setDragging] = useState(false);
  const [live, setLive] = useState<number | null>(value);
  const [trackWidth, setTrackWidth] = useState(0);

  // The rail's real width, so label collision is measured rather than guessed.
  useEffect(() => {
    const el = trackRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(([entry]) => {
      setTrackWidth(entry?.contentRect.width ?? 0);
    });
    ro.observe(el);
    setTrackWidth(el.getBoundingClientRect().width);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    if (!dragging) setLive(value);
  }, [value, dragging]);

  const sold = useMemo(() => comps.filter((c) => c.sold && c.price > 0), [comps]);
  const asking = useMemo(() => comps.filter((c) => !c.sold && c.price > 0), [comps]);

  // The rail spans from "you lose money" up past the top of the market, so the
  // break-even point always has a visible position on it.
  const { min, max } = useMemo(() => {
    const prices = [...sold, ...asking].map((c) => c.price);
    const top = Math.max(compHigh, cost * 1.6, ...prices, 1);
    const lo = Math.max(0, Math.min(cost * 0.5, compLow * 0.6));
    return { min: lo, max: top * 1.08 };
  }, [sold, asking, compHigh, compLow, cost]);

  const toPct = useCallback(
    (v: number) => ((v - min) / Math.max(1e-6, max - min)) * 100,
    [min, max],
  );
  const fromPct = useCallback(
    (pct: number) => min + (Math.min(100, Math.max(0, pct)) / 100) * (max - min),
    [min, max],
  );

  const current = live ?? compMid;
  const profit = current - cost;
  const margin = current > 0 ? profit / current : 0;
  const hourly = hours > 0 ? profit / hours : profit;
  const clearsTarget = hourly >= hourlyTarget;

  const notchPct = toPct(current);
  const costPct = toPct(cost);
  const noMarket = sold.length === 0;

  /**
   * The rail's labels. `cost` always wins because break-even is the one number
   * that must be readable; the band ends are dropped when they would collide
   * with it or with each other. A label a user has to decode is worse than a
   * label that isn't there — the exact figures are all in the list below.
   */
  const ticks = useMemo(() => {
    // Mono at 10.5px is about 6.3px per character. Measuring the rail rather
    // than assuming a width means this behaves the same on a 320px phone as on
    // a wide desktop card.
    const railPx = trackWidth || 640;
    const widthPct = (text: string) => ((text.length * 6.3 + 10) / railPx) * 100;

    const candidates: { key: string; pct: number; label: string; align: "left" | "center" | "right"; priority: number }[] = [
      {
        key: "cost",
        pct: costPct,
        label: `cost ${fmtMoney(cost, { cents: false })}`,
        align: "left",
        priority: 0,
      },
    ];
    if (!noMarket) {
      candidates.push(
        {
          key: "high",
          pct: toPct(compHigh),
          label: fmtMoney(compHigh, { cents: false }),
          align: "right",
          priority: 1,
        },
        {
          key: "low",
          pct: toPct(compLow),
          label: fmtMoney(compLow, { cents: false }),
          align: "center",
          priority: 2,
        },
      );
    }

    const kept: typeof candidates = [];
    for (const c of [...candidates].sort((a, b) => a.priority - b.priority)) {
      const fits = kept.every(
        (k) =>
          Math.abs(k.pct - c.pct) >= widthPct(k.label) / 2 + widthPct(c.label) / 2,
      );
      if (fits) kept.push(c);
    }
    return kept.sort((a, b) => a.pct - b.pct);
  }, [costPct, cost, compHigh, compLow, noMarket, toPct, trackWidth]);

  /* ----------------------------------------------------------- interaction */

  const setFromClientX = useCallback(
    (clientX: number) => {
      const el = trackRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      const pct = ((clientX - rect.left) / Math.max(1, rect.width)) * 100;
      const next = Math.round(fromPct(pct));
      setLive(next);
    },
    [fromPct],
  );

  const onPointerDown = (e: React.PointerEvent) => {
    if (readOnly) return;
    e.preventDefault();
    (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
    setDragging(true);
    setFromClientX(e.clientX);
  };

  const onPointerMove = (e: React.PointerEvent) => {
    if (!dragging || readOnly) return;
    setFromClientX(e.clientX);
  };

  const endDrag = () => {
    if (!dragging) return;
    setDragging(false);
    // Letting go springs back to the comp-derived estimate unless they moved it
    // meaningfully — a nudge is not a decision.
    if (live != null && Math.abs(live - compMid) < Math.max(2, compMid * 0.015)) {
      setLive(null);
      onChange?.(null);
    } else {
      onChange?.(live);
    }
  };

  /**
   * Keyboard commits are debounced, exactly like the drag commits on release.
   *
   * Without this, holding an arrow key fires one PATCH per key-repeat — about
   * 30 a second — which burns the account's hourly write quota in ten seconds
   * and then 429s every other write on the plan.
   */
  const commitTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const commit = useCallback(
    (next: number | null, delay = 400) => {
      if (commitTimer.current) clearTimeout(commitTimer.current);
      commitTimer.current = setTimeout(() => {
        commitTimer.current = null;
        onChange?.(next);
      }, delay);
    },
    [onChange],
  );

  // Flush a pending commit rather than losing it when this unmounts.
  useEffect(
    () => () => {
      if (commitTimer.current) clearTimeout(commitTimer.current);
    },
    [],
  );

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (readOnly) return;
    const stepBig = Math.max(5, Math.round((max - min) / 20));
    const step = Math.max(1, Math.round((max - min) / 200));
    let next: number | null = null;
    if (e.key === "ArrowRight" || e.key === "ArrowUp") next = current + (e.shiftKey ? stepBig : step);
    else if (e.key === "ArrowLeft" || e.key === "ArrowDown") next = current - (e.shiftKey ? stepBig : step);
    else if (e.key === "Home") next = Math.round(min);
    else if (e.key === "End") next = Math.round(max);
    else if (e.key === "Escape" || e.key === "0") {
      setLive(null);
      commit(null, 0);
      e.preventDefault();
      return;
    }
    if (next == null) return;
    e.preventDefault();
    const clamped = Math.round(Math.min(max, Math.max(min, next)));
    setLive(clamped);
    // Arrowing back onto the market price clears the override, matching what
    // letting go of the drag does.
    const atMarket = Math.abs(clamped - compMid) < Math.max(2, compMid * 0.015);
    commit(atMarket ? null : clamped);
    if (atMarket) setLive(null);
  };

  return (
    <div className={cn("select-none", className)}>
      {/* ---------------------------------------------------- the numbers */}
      <div className="mb-3 flex flex-wrap items-end justify-between gap-x-5 gap-y-2">
        <div>
          <div className="text-[11px] font-medium uppercase tracking-[0.1em] text-[var(--ink-3)]">
            {live != null ? "Your asking price" : "Typical sale price"}
          </div>
          <div className="num text-[clamp(1.75rem,6vw,2.5rem)] font-semibold leading-none text-[var(--ink)]">
            {fmtMoney(current, { cents: false })}
          </div>
        </div>
        <div className="flex flex-wrap items-end gap-x-5 gap-y-2">
          <Stat label="Profit" value={fmtMoney(profit, { cents: false })} tone={profit > 0 ? "profit" : "loss"} />
          <Stat label="Margin" value={fmtPct(margin)} tone={margin >= 0.4 ? "profit" : margin > 0 ? "neutral" : "loss"} />
          <Stat
            label="Per hour"
            value={hours > 0 ? `${fmtMoney(hourly, { cents: false })}/hr` : "—"}
            tone={clearsTarget && profit > 0 ? "profit" : profit > 0 ? "neutral" : "loss"}
          />
        </div>
      </div>

      {/* ------------------------------------------------------- the rail */}
      <div className="relative pt-7 pb-9">
        {/* sold-price distribution behind the rail */}
        <div className="pointer-events-none absolute inset-x-0 top-0 h-7">
          {sold.map((c) => (
            <span
              key={c.id}
              title={`${c.title} — sold ${fmtMoney(c.price, { cents: false })}`}
              className="absolute bottom-0 w-px bg-[var(--profit)] opacity-60"
              style={{ left: `${toPct(c.price)}%`, height: "14px" }}
            />
          ))}
          {asking.map((c) => (
            <span
              key={c.id}
              title={`${c.title} — ASKING ${fmtMoney(c.price, { cents: false })}, not a sale`}
              className="absolute bottom-0 w-px border-l border-dashed border-[var(--ink-4)] opacity-70"
              style={{ left: `${toPct(c.price)}%`, height: "8px" }}
            />
          ))}
        </div>

        <div
          ref={trackRef}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={endDrag}
          onPointerCancel={endDrag}
          className={cn(
            "relative h-3 rounded-full border border-[var(--line)] bg-[var(--surface-2)]",
            !readOnly && "cursor-ew-resize",
          )}
          style={{ touchAction: "pan-y" }}
        >
          {/* cost block, from the left edge to what it costs to build */}
          <div
            className="absolute inset-y-0 left-0 rounded-l-full bg-[var(--loss-soft)]"
            style={{ width: `${Math.max(0, costPct)}%` }}
          />
          {/* the sold band */}
          {!noMarket && (
            <div
              className="absolute inset-y-0 bg-[var(--profit-soft)]"
              style={{
                left: `${toPct(compLow)}%`,
                width: `${Math.max(1, toPct(compHigh) - toPct(compLow))}%`,
              }}
            />
          )}
          {/* profit fill from cost to the current price */}
          <motion.div
            className={cn(
              "absolute inset-y-0",
              profit >= 0 ? "bg-[var(--profit)]" : "bg-[var(--loss)]",
            )}
            style={{
              left: `${Math.min(costPct, notchPct)}%`,
            }}
            animate={{ width: `${Math.abs(notchPct - costPct)}%` }}
            transition={dragging || reduced ? { duration: 0 } : spring.beam}
          />

          {/* break-even marker */}
          <div
            className="absolute -top-1.5 bottom-[-6px] w-px bg-[var(--ink-2)]"
            style={{ left: `${costPct}%` }}
            aria-hidden
          />

          {/* the notch */}
          <motion.div
            role="slider"
            tabIndex={readOnly ? -1 : 0}
            aria-label="Asking price — drag to see how it changes your profit per hour"
            aria-valuemin={Math.round(min)}
            aria-valuemax={Math.round(max)}
            aria-valuenow={Math.round(current)}
            aria-valuetext={`${fmtMoney(current, { cents: false })}, ${fmtMoney(profit, { cents: false })} profit, ${
              hours > 0 ? `${fmtMoney(hourly, { cents: false })} per hour` : "no hours set"
            }`}
            aria-readonly={readOnly}
            onKeyDown={onKeyDown}
            className={cn(
              "absolute top-1/2 z-10 grid h-9 w-9 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full border-2 border-[var(--accent)] bg-[var(--surface)] shadow-[0_2px_12px_#0007]",
              !readOnly && "cursor-grab active:cursor-grabbing",
              dragging && "scale-110",
              !dragging && !reduced && "breathe",
            )}
            style={{ left: `${notchPct}%` }}
            animate={{ left: `${notchPct}%` }}
            transition={dragging || reduced ? { duration: 0 } : spring.beam}
          >
            <span className="h-3.5 w-[3px] rounded-full bg-[var(--accent)]" />
          </motion.div>
        </div>

        {/* Labels under the rail. Crowded ticks get dropped rather than
            overlapping — an unreadable number is worse than no number. */}
        <div className="relative mt-2.5 h-5 text-[10.5px] text-[var(--ink-3)]">
          {ticks.map((t) => (
            <Tick key={t.key} pct={t.pct} label={t.label} align={t.align} />
          ))}
        </div>
      </div>

      {/* --------------------------------------------------------- caption */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-[11.5px] text-[var(--ink-3)]">
        {noMarket ? (
          <span className="text-[var(--warn)]">
            No completed sales found, so there is no market to plot. The rail shows cost only.
          </span>
        ) : (
          <>
            <Legend swatch="bg-[var(--profit)]" text={`${sold.length} completed sale${sold.length === 1 ? "" : "s"}`} />
            {asking.length > 0 && (
              <Legend dashed text={`${asking.length} asking price${asking.length === 1 ? "" : "s"} — shown, never counted`} />
            )}
            {!readOnly && (
              <span className="hidden sm:inline">
                Drag the notch to test a price · <kbd className="rounded border border-[var(--line)] px-1 py-px text-[10px]">Esc</kbd> to reset
              </span>
            )}
            {live != null && (
              <button
                type="button"
                onClick={() => {
                  setLive(null);
                  onChange?.(null);
                }}
                className="rounded-full border border-[var(--line)] px-2 py-0.5 text-[11px] text-[var(--ink-2)] transition hover:border-[var(--accent-line)] hover:text-[var(--ink)]"
              >
                Back to the market price
              </button>
            )}
          </>
        )}
      </div>
    </div>
  );
}

function Stat({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone: "profit" | "loss" | "neutral";
}) {
  return (
    <div>
      <div className="text-[10.5px] font-medium uppercase tracking-[0.09em] text-[var(--ink-3)]">
        {label}
      </div>
      <div
        className={cn(
          "num text-[1.05rem] font-semibold leading-tight",
          tone === "profit" && "text-[var(--profit)]",
          tone === "loss" && "text-[var(--loss)]",
          tone === "neutral" && "text-[var(--ink)]",
        )}
      >
        {value}
      </div>
    </div>
  );
}

function Tick({
  pct,
  label,
  align = "center",
}: {
  pct: number;
  label: string;
  align?: "left" | "center" | "right";
}) {
  const clamped = Math.min(98, Math.max(2, pct));
  return (
    <span
      className="num absolute whitespace-nowrap"
      style={{
        left: `${clamped}%`,
        transform:
          align === "left"
            ? "translateX(-10%)"
            : align === "right"
              ? "translateX(-90%)"
              : "translateX(-50%)",
      }}
    >
      {label}
    </span>
  );
}

function Legend({
  swatch,
  dashed,
  text,
}: {
  swatch?: string;
  dashed?: boolean;
  text: string;
}) {
  return (
    <span className="inline-flex items-center gap-1.5">
      {dashed ? (
        <span className="h-3 w-0 border-l border-dashed border-[var(--ink-4)]" />
      ) : (
        <span className={cn("h-3 w-px", swatch)} />
      )}
      {text}
    </span>
  );
}
