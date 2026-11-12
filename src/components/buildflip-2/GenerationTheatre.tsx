"use client";

import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { Check, Loader2 } from "lucide-react";
import type { Progress, Stage } from "@/lib/buildflip-2/ai/generate";
import { cn, ease } from "@/lib/buildflip-2/ui";

/**
 * The plan assembling itself.
 *
 * The one surprise moment the whole flow is built around: instead of a spinner,
 * the user watches the machine work — the link opening, the dimensions being
 * worked out, the materials counted, the prices and the sold listings coming in
 * at the same time. It says what it's doing and how far along (R5), and because
 * the stages are real server events it is never a fake progress bar.
 */

const STAGES: { id: Stage; label: string }[] = [
  { id: "reading", label: "Reading the build" },
  { id: "sizing", label: "Working out dimensions" },
  { id: "materials", label: "Counting materials" },
  { id: "pricing", label: "Searching live prices" },
  { id: "comps", label: "Finding what they sold for" },
  { id: "verdict", label: "Working out the profit" },
];

const ORDER: Record<Stage, number> = {
  reading: 0,
  sizing: 1,
  materials: 2,
  pricing: 3,
  comps: 4,
  verdict: 5,
  done: 6,
};

export default function GenerationTheatre({
  progress,
  elapsedMs,
}: {
  progress: Progress | null;
  elapsedMs: number;
}) {
  const current = progress?.stage ?? "reading";
  const currentIdx = ORDER[current] ?? 0;
  const pct = Math.round((progress?.pct ?? 0.04) * 100);
  const [detailLog, setDetailLog] = useState<string[]>([]);
  const lastDetail = useRef<string | null>(null);

  useEffect(() => {
    const line = progress?.detail?.trim();
    if (!line || line === lastDetail.current) return;
    lastDetail.current = line;
    setDetailLog((prev) => [line, ...prev].slice(0, 4));
  }, [progress?.detail]);

  const seconds = Math.floor(elapsedMs / 1000);

  return (
    <div
      role="status"
      aria-live="polite"
      aria-label={`Building your plan, ${pct} percent — ${progress?.label ?? "starting"}`}
      className="rounded-[var(--radius-card)] border border-[var(--line)] bg-[var(--surface)] p-5 shadow-[var(--shadow-card)]"
    >
      <div className="mb-4 flex items-baseline justify-between gap-3">
        <h2 className="text-[16px] font-semibold text-[var(--ink)]">
          {progress?.label ?? "Starting up"}
        </h2>
        <span className="num shrink-0 text-[12px] text-[var(--ink-3)]">
          {pct}% · {seconds}s
        </span>
      </div>

      {/* the bar */}
      <div className="mb-5 h-1.5 overflow-hidden rounded-full bg-[var(--surface-3)]">
        <motion.div
          className="h-full rounded-full bg-[var(--accent)]"
          initial={{ width: "4%" }}
          animate={{ width: `${Math.max(4, pct)}%` }}
          transition={{ duration: 0.6, ease }}
        />
      </div>

      {/* stages snapping into place */}
      <ol className="space-y-0.5">
        {STAGES.map((stage, i) => {
          const done = i < currentIdx;
          const active = i === currentIdx;
          return (
            <motion.li
              key={stage.id}
              initial={{ opacity: 0, x: -6 }}
              animate={{
                opacity: done ? 0.55 : active ? 1 : 0.32,
                x: 0,
              }}
              transition={{ duration: 0.35, ease, delay: i * 0.03 }}
              className="flex items-center gap-2.5 py-1"
            >
              <span
                className={cn(
                  "grid h-5 w-5 shrink-0 place-items-center rounded-full border transition-colors",
                  done && "border-[var(--profit)] bg-[var(--profit-soft)] text-[var(--profit)]",
                  active && "border-[var(--accent)] text-[var(--accent)]",
                  !done && !active && "border-[var(--line)] text-[var(--ink-4)]",
                )}
              >
                {done ? (
                  <Check aria-hidden className="h-3 w-3" strokeWidth={3} />
                ) : active ? (
                  <Loader2 aria-hidden className="h-3 w-3 spin" />
                ) : (
                  <span className="h-1 w-1 rounded-full bg-current" />
                )}
              </span>
              <span
                className={cn(
                  "text-[13.5px]",
                  active ? "font-medium text-[var(--ink)]" : "text-[var(--ink-2)]",
                )}
              >
                {stage.label}
              </span>
              {/* Pricing and comps genuinely run at the same time — say so. */}
              {stage.id === "comps" && currentIdx === 3 && (
                <span className="text-[11px] text-[var(--ink-4)]">· at the same time</span>
              )}
            </motion.li>
          );
        })}
      </ol>

      {/* the live log */}
      <AnimatePresence>
        {detailLog.length > 0 && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.3, ease }}
            className="mt-4 space-y-1 overflow-hidden border-t border-[var(--line-soft)] pt-3"
          >
            {detailLog.map((line, i) => (
              <motion.p
                key={line}
                initial={{ opacity: 0, y: -4 }}
                animate={{ opacity: 1 - i * 0.26, y: 0 }}
                transition={{ duration: 0.3, ease }}
                className="truncate font-mono text-[11.5px] text-[var(--ink-3)]"
              >
                {line}
              </motion.p>
            ))}
          </motion.div>
        )}
      </AnimatePresence>

      {seconds > 70 && (
        <p className="mt-4 rounded-[10px] bg-[var(--surface-2)] px-3 py-2 text-[12px] leading-relaxed text-[var(--ink-3)]">
          Taking longer than usual — the price search is being thorough. You can close this
          tab; the plan keeps building and will be on your board.
        </p>
      )}
    </div>
  );
}
