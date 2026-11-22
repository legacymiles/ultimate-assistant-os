// ---------------------------------------------------------------------------
// The small pieces this dashboard is built from.
//
// Direction: the hub's own "Night Console" (DESIGN.md) — near-black canvas,
// four tonal surface steps separated by hairlines, no shadows, no card grid.
// Every machine fact is monospace with tabular figures; every human sentence
// is sans. Colour reports state and never decorates.
//
// The state hues are the ones DESIGN.md declares (state-waiting #f59e0b,
// state-failed #ef4444 / ink #f87171). They are written as literals here
// rather than Tailwind tokens because globals.css never exported them, and
// adding theme tokens to a shared sheet mid-flight is a bigger change than
// this app needs.
// ---------------------------------------------------------------------------

"use client";

import type { ReactNode } from "react";

export const STATE = {
  up: "#22c55e",
  waiting: "#f59e0b",
  failed: "#ef4444",
  failedInk: "#f87171",
  /** Served live by a provider. The brand indigo. */
  live: "#6366f1",
  /** Served from cache. accent-cyan-2 — validated against the panel surface. */
  cached: "#00a5b8",
} as const;

/** A bordered strip, which is how this system groups things. Never a card. */
export function Panel({
  title,
  hint,
  actions,
  children,
  className = "",
}: {
  title: string;
  hint?: string;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={`rounded-[10px] border border-line bg-panel ${className}`}>
      <header className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-line-soft px-3 py-2">
        <h2 className="text-[14px] font-semibold leading-tight text-ink">{title}</h2>
        {hint ? <p className="min-w-0 flex-1 text-[12px] leading-snug text-ink-faint">{hint}</p> : null}
        {actions ? <div className="ml-auto flex items-center gap-1.5">{actions}</div> : null}
      </header>
      {children}
    </section>
  );
}

/** 7px status dot — the system's one-glance state mark. Always beside a word. */
export function Dot({ color, pulse = false }: { color: string; pulse?: boolean }) {
  return (
    <span
      aria-hidden
      className={`inline-block h-[7px] w-[7px] shrink-0 rounded-full ${pulse ? "animate-pulse" : ""}`}
      style={{ background: color }}
    />
  );
}

export function Button({
  children,
  onClick,
  variant = "ghost",
  disabled,
  type = "button",
  title,
}: {
  children: ReactNode;
  onClick?: () => void;
  variant?: "primary" | "ghost" | "outline" | "danger";
  disabled?: boolean;
  type?: "button" | "submit";
  title?: string;
}) {
  const base =
    "inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-[12px] font-medium transition disabled:cursor-not-allowed disabled:opacity-45";
  const look =
    variant === "primary"
      ? "bg-brand-2 text-white hover:bg-brand-press"
      : variant === "outline"
        ? "border border-line text-ink-muted hover:bg-elevated hover:text-ink"
        : variant === "danger"
          ? "border border-line text-[#f87171] hover:bg-[#2a1618] hover:text-[#fca5a5]"
          : "text-ink-muted hover:bg-elevated hover:text-ink";
  return (
    <button type={type} onClick={onClick} disabled={disabled} title={title} className={`${base} ${look}`}>
      {children}
    </button>
  );
}

/** A KPI. The number is the loudest thing on the page, and it is still 20px. */
export function Stat({
  label,
  value,
  unit,
  tone = "ink",
  sub,
}: {
  label: string;
  value: string | number;
  unit?: string;
  tone?: "ink" | "good" | "warn" | "bad" | "muted";
  sub?: string;
}) {
  const color =
    tone === "good"
      ? STATE.up
      : tone === "warn"
        ? STATE.waiting
        : tone === "bad"
          ? STATE.failedInk
          : undefined;
  return (
    <div className="min-w-0 border-t border-line-soft px-3 py-2.5 first:border-t-0 sm:border-l sm:border-t-0 sm:first:border-l-0">
      <p className="text-[10.5px] font-medium uppercase tracking-wide text-ink-faint">{label}</p>
      <p className="mt-1 flex items-baseline gap-1 font-mono text-[20px] leading-none tabular-nums" style={{ color }}>
        <span className={color ? "" : "text-ink"}>{value}</span>
        {unit ? <span className="text-[11.5px] text-ink-faint">{unit}</span> : null}
      </p>
      {sub ? <p className="mt-1 truncate text-[11.5px] text-ink-faint">{sub}</p> : null}
    </div>
  );
}

/** A label chip. Used for kinds, locations and scopes. */
export function Chip({
  children,
  tone = "muted",
  mono = false,
}: {
  children: ReactNode;
  tone?: "muted" | "brand" | "good" | "bad" | "warn";
  mono?: boolean;
}) {
  const look =
    tone === "brand"
      ? "border-brand/45 text-[#a5b4fc]"
      : tone === "good"
        ? "border-[#22c55e]/45 text-[#4ade80]"
        : tone === "bad"
          ? "border-[#ef4444]/45 text-[#f87171]"
          : tone === "warn"
            ? "border-[#f59e0b]/45 text-[#fbbf24]"
            : "border-line text-ink-faint";
  return (
    <span
      className={`inline-flex items-center rounded-[4px] border px-1.5 py-[1px] text-[10.5px] font-medium tracking-wide ${look} ${mono ? "font-mono tabular-nums" : ""}`}
    >
      {children}
    </span>
  );
}

/** The one empty state in the system: a sentence, not an illustration. */
export function Empty({ children }: { children: ReactNode }) {
  return <p className="px-3 py-6 text-center text-[12px] text-ink-faint">{children}</p>;
}

export function Spinner({ label }: { label?: string }) {
  return (
    <span className="inline-flex items-center gap-2 text-[12px] text-ink-faint">
      <span
        aria-hidden
        className="inline-block h-3 w-3 animate-spin rounded-full border border-line border-t-brand"
      />
      {label}
    </span>
  );
}

/** Relative time, because "4m ago" is read faster than a timestamp. */
export function ago(iso: string | null | undefined): string {
  if (!iso) return "—";
  const ms = Date.now() - new Date(iso).getTime();
  if (!Number.isFinite(ms)) return "—";
  if (ms < 60_000) return `${Math.max(1, Math.round(ms / 1000))}s ago`;
  if (ms < 3_600_000) return `${Math.round(ms / 60_000)}m ago`;
  if (ms < 86_400_000) return `${Math.round(ms / 3_600_000)}h ago`;
  return `${Math.round(ms / 86_400_000)}d ago`;
}

export function ms(value: number | null | undefined): string {
  if (value === null || value === undefined) return "—";
  return value >= 1000 ? `${(value / 1000).toFixed(2)}s` : `${Math.round(value)}ms`;
}
