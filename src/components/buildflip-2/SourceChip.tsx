"use client";

import { useEffect, useId, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { ArrowUpRight, FlaskConical, ShieldCheck, ShieldQuestion, TriangleAlert } from "lucide-react";
import type { Confidence, Provenance } from "@/lib/buildflip-2/types";
import { ago, cn, ease, hostOf, shortDate } from "@/lib/buildflip-2/ui";

/**
 * Feature 8 — every number shows its source.
 *
 * Wraps any number. Tap or hover and the source blooms out of it: where it came
 * from, the exact date it was checked, how confident we are and why, and a
 * link through to the actual page. An uncertain number is drawn as uncertain
 * (dotted underline, amber) rather than presented as fact.
 *
 * Works on a phone: tap toggles, tap-away or Escape closes, the panel is
 * clamped inside the viewport, and the trigger is a real button so it is
 * reachable by keyboard and announced by a screen reader.
 */

const TONE: Record<Confidence, { line: string; text: string; icon: typeof ShieldCheck; word: string }> = {
  high: { line: "decoration-[var(--line)]", text: "text-[var(--profit)]", icon: ShieldCheck, word: "Confident" },
  medium: { line: "decoration-[var(--ink-4)]", text: "text-[var(--ink-2)]", icon: ShieldQuestion, word: "Fairly sure" },
  low: { line: "decoration-[var(--warn)]", text: "text-[var(--warn)]", icon: TriangleAlert, word: "Uncertain" },
};

export default function SourceChip({
  provenance,
  children,
  className,
  align = "start",
}: {
  provenance: Provenance;
  children: React.ReactNode;
  className?: string;
  align?: "start" | "end";
}) {
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLSpanElement | null>(null);
  const panelId = useId();
  const tone = TONE[provenance.confidence];
  const Icon = provenance.demo ? FlaskConical : tone.icon;

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent | TouchEvent) => {
      if (!wrap.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("touchstart", onDown, { passive: true });
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("touchstart", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const host = hostOf(provenance.url);

  return (
    <span ref={wrap} className="relative inline-flex">
      <button
        type="button"
        aria-expanded={open}
        aria-controls={open ? panelId : undefined}
        onClick={() => setOpen((v) => !v)}
        className={cn(
          "inline-flex items-center gap-1 rounded underline decoration-dotted decoration-1 underline-offset-[3px] transition-colors",
          tone.line,
          provenance.confidence === "low" && "text-[var(--warn)]",
          provenance.demo && "decoration-[var(--accent-line)]",
          "hover:decoration-[var(--accent)] focus-visible:decoration-[var(--accent)]",
          className,
        )}
      >
        {children}
        <Icon
          aria-hidden
          className={cn(
            "h-3 w-3 shrink-0 opacity-70",
            provenance.demo ? "text-[var(--accent)]" : tone.text,
          )}
        />
        <span className="sr-only">
          — {provenance.demo ? "demo catalog" : `source: ${provenance.source}`}, {tone.word.toLowerCase()}. Show details.
        </span>
      </button>

      <AnimatePresence>
        {open && (
          <motion.span
            id={panelId}
            role="dialog"
            aria-label="Where this number came from"
            initial={{ opacity: 0, y: -6, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -4, scale: 0.98 }}
            transition={{ duration: 0.2, ease }}
            className={cn(
              "absolute top-[calc(100%+8px)] z-50 block w-[min(19rem,calc(100vw-2rem))] rounded-[12px] border border-[var(--line)] bg-[var(--surface)] p-3 text-left shadow-[var(--shadow-pop)]",
              align === "end" ? "right-0" : "left-0",
            )}
            style={{ transformOrigin: align === "end" ? "top right" : "top left" }}
          >
            <span className="mb-1.5 flex items-center gap-1.5">
              <Icon
                aria-hidden
                className={cn("h-3.5 w-3.5", provenance.demo ? "text-[var(--accent)]" : tone.text)}
              />
              <span className="text-[11px] font-semibold uppercase tracking-[0.08em] text-[var(--ink-2)]">
                {provenance.demo ? "Demo catalog" : tone.word}
              </span>
            </span>

            <span className="block text-[13px] font-medium leading-snug text-[var(--ink)]">
              {provenance.source}
            </span>

            {provenance.note && (
              <span className="mt-1.5 block text-[12px] leading-relaxed text-[var(--ink-2)]">
                {provenance.note}
              </span>
            )}

            <span className="mt-2.5 flex items-center justify-between gap-2 border-t border-[var(--line-soft)] pt-2 text-[11px] text-[var(--ink-3)]">
              <span className="num">
                checked {shortDate(provenance.checkedAt)} · {ago(provenance.checkedAt)}
              </span>
            </span>

            {provenance.url ? (
              <a
                href={provenance.url}
                target="_blank"
                rel="noopener noreferrer nofollow"
                className="mt-2 inline-flex min-h-9 w-full items-center justify-between gap-2 rounded-[8px] border border-[var(--line)] px-2.5 py-1.5 text-[12px] font-medium text-[var(--ink)] transition hover:border-[var(--accent-line)] hover:bg-[var(--accent-soft)]"
              >
                <span className="truncate">{host || "Open the listing"}</span>
                <ArrowUpRight aria-hidden className="h-3.5 w-3.5 shrink-0 opacity-70" />
              </a>
            ) : (
              <span className="mt-2 block rounded-[8px] border border-dashed border-[var(--line)] px-2.5 py-1.5 text-[11.5px] text-[var(--ink-3)]">
                No listing page behind this one — treat it as an estimate.
              </span>
            )}
          </motion.span>
        )}
      </AnimatePresence>
    </span>
  );
}
