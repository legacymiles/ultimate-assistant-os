"use client";

// Small pieces every 24/7 Queue surface shares: the status mark, the
// progress bar (only for a reported number), the history micro-bars, a
// meter, a copy button, the layer that holds a drawer or a sheet, and the
// Escape stack so the top-most layer closes first.

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Icon } from "../icons";
import { vsMono, vsSans } from "@/lib/fonts";
import { TONE_LABEL, type History, type Tone } from "@/lib/queue247/view";

/** Geist + Geist Mono (the Cold Luxury faces, read off disk — no Google fetch). */
export const FONT_VARS = `${vsSans.variable} ${vsMono.variable}`;

export function StatusMark({ tone, title }: { tone: Tone; title?: string }) {
  return <span className="qm" data-tone={tone} role="img" aria-label={title ?? TONE_LABEL[tone]} />;
}

export function StatusChip({ tone, label }: { tone: Tone; label?: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 whitespace-nowrap text-[10.5px] font-medium uppercase tracking-[0.05em]" data-tone-ink={tone}>
      <StatusMark tone={tone} />
      {label ?? TONE_LABEL[tone]}
    </span>
  );
}

/** A bar for a reported percentage. Renders nothing when there is no number. */
export function ProgressBar({ value, tone, live, className = "" }: { value: number | null; tone: Tone; live?: boolean; className?: string }) {
  if (value == null) return null;
  return (
    <div
      className={`q-progress ${className}`}
      data-tone={tone === "always" || tone === "failed" || tone === "done" ? tone : undefined}
      data-live={live ? "true" : undefined}
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={value}
      aria-label={`${value}% done`}
    >
      <i style={{ transform: `scaleX(${value / 100})` }} />
    </div>
  );
}

/** ✓ and ✗ counts with a thin split bar: how often this task's rounds worked. */
export function HistoryBars({ h, compact = false }: { h: History; compact?: boolean }) {
  const label = h.total ? `${h.ok} succeeded, ${h.fail} failed` : "Has not finished a round yet";
  return (
    <div className="flex min-w-0 flex-col gap-1" title={label} aria-label={label}>
      <div className="flex items-center gap-2 text-[11px]" data-num>
        <span className={`inline-flex items-center gap-0.5 ${h.ok ? "text-[var(--q-done)]" : "text-[var(--q-faint)]"}`}>
          <Icon.Check width={10} height={10} aria-hidden />
          {h.ok}
        </span>
        <span className={`inline-flex items-center gap-0.5 ${h.fail ? "text-[var(--q-fail)]" : "text-[var(--q-faint)]"}`}>
          <Icon.Close width={10} height={10} aria-hidden />
          {h.fail}
        </span>
      </div>
      {!compact && (
        <div className="q-hist" aria-hidden>
          {h.total ? (
            <>
              {h.ok > 0 && <i data-k="ok" style={{ flex: h.ok }} />}
              {h.fail > 0 && <i data-k="fail" style={{ flex: h.fail }} />}
            </>
          ) : (
            <i data-k="none" />
          )}
        </div>
      )}
    </div>
  );
}

export function Meter({ pct, label }: { pct: number | null; label: string }) {
  if (pct == null) return <span className="text-[11px] text-[var(--q-faint)]">{label}: not reported</span>;
  const level = pct >= 90 ? "high" : pct >= 70 ? "warn" : undefined;
  return (
    <div className="grid grid-cols-[34px_1fr_32px] items-center gap-2 text-[10.5px]" aria-label={`${label} ${pct}%`}>
      <span className="text-[var(--q-muted)]">{label}</span>
      <div className="q-meter" data-level={level}>
        <i style={{ transform: `scaleX(${Math.max(2, pct) / 100})` }} />
      </div>
      <span className="text-right text-[var(--q-ink)]" data-num>
        {pct}%
      </span>
    </div>
  );
}

export function ScoreBar({ value }: { value: number | null }) {
  if (value == null) return <span className="text-[11px] text-[var(--q-faint)]">—</span>;
  const v = Math.max(0, Math.min(100, Math.round(value)));
  return (
    <span className="q-score" aria-label={`${v} of 100`}>
      <span>
        <i style={{ width: `${v}%` }} />
      </span>
      <span className="text-right text-[11px]" data-num>
        {v}
      </span>
    </span>
  );
}

export function CopyButton({ text, label = "Copy" }: { text: string; label?: string }) {
  const [done, setDone] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setDone(true);
      setTimeout(() => setDone(false), 1400);
    } catch {
      /* clipboard blocked: the text is selectable on screen */
    }
  };
  return (
    <button type="button" className="q-btn h-[26px] min-h-0 px-2 text-[11px]" onClick={copy} aria-live="polite">
      {done ? <Icon.Check width={11} height={11} aria-hidden /> : <Icon.Copy width={11} height={11} aria-hidden />}
      {done ? "Copied" : label}
    </button>
  );
}

// --- Escape: the top-most layer closes first ------------------------------

const stack: (() => void)[] = [];
let listening = false;

function onKey(e: KeyboardEvent) {
  if (e.key !== "Escape" || !stack.length) return;
  e.stopPropagation();
  e.preventDefault();
  stack[stack.length - 1]();
}

export function useEscape(active: boolean, close: () => void) {
  const ref = useRef(close);
  ref.current = close;
  useEffect(() => {
    if (!active) return;
    const fn = () => ref.current();
    stack.push(fn);
    if (!listening) {
      window.addEventListener("keydown", onKey, true);
      listening = true;
    }
    return () => {
      const i = stack.lastIndexOf(fn);
      if (i >= 0) stack.splice(i, 1);
      if (!stack.length && listening) {
        window.removeEventListener("keydown", onKey, true);
        listening = false;
      }
    };
  }, [active]);
}

/**
 * A full-viewport layer, portalled to <body> so no ancestor's overflow or
 * transform clips it. Carries the .q247 scope and the fonts with it.
 */
export function Layer({ children, onClose, label, kind = "drawer" }: { children: ReactNode; onClose: () => void; label: string; kind?: "drawer" | "sheet" }) {
  const [host, setHost] = useState<HTMLElement | null>(null);
  useEffect(() => setHost(document.body), []);
  useEscape(true, onClose);
  // Keep the page behind from scrolling while a layer is open.
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, []);
  const panel = useCallback((el: HTMLDivElement | null) => {
    if (el && !el.contains(document.activeElement)) el.focus({ preventScroll: true });
  }, []);
  if (!host) return null;
  return createPortal(
    <div className={`q247 q-layer ${FONT_VARS}`} role="presentation">
      <div className="q-scrim" onClick={onClose} aria-hidden />
      <div ref={panel} tabIndex={-1} role="dialog" aria-modal="true" aria-label={label} className={kind === "sheet" ? "q-sheet outline-none" : "q-drawer outline-none"}>
        {children}
      </div>
    </div>,
    host,
  );
}

export function Notice({ text, onDismiss }: { text: string | null; onDismiss?: () => void }) {
  if (!text) return null;
  return (
    <div role="alert" className="flex items-start gap-2 rounded-md border border-[color-mix(in_oklab,var(--q-fail-fill)_40%,var(--q-line))] bg-[color-mix(in_oklab,var(--q-fail-fill)_8%,transparent)] px-3 py-2 text-[12px] text-[var(--q-ink)]">
      <span className="qm mt-1" data-tone="failed" aria-hidden />
      <span className="min-w-0 flex-1">{text}</span>
      {onDismiss && (
        <button type="button" onClick={onDismiss} className="q-icon-btn -my-1 h-6 w-6" aria-label="Dismiss">
          <Icon.Close width={12} height={12} />
        </button>
      )}
    </div>
  );
}

export function Empty({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="px-3 py-6">
      <p className="text-[13px] font-semibold text-[var(--q-ink)]">{title}</p>
      {children && <div className="mt-1 max-w-[60ch] text-[12.5px] leading-relaxed text-[var(--q-muted)]">{children}</div>}
    </div>
  );
}
