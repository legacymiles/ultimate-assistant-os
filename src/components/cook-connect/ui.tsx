"use client";

// The shared component vocabulary. One button shape, one field shape, one
// panel shape — used everywhere, so nothing in the app looks borrowed from a
// different app.

import { useEffect, useRef, useState, type ReactNode } from "react";
import { CloseIcon } from "./icons";

export const cx = (...parts: (string | false | null | undefined)[]) =>
  parts.filter(Boolean).join(" ");

/* ── Buttons ───────────────────────────────────────────────────── */

type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";

const BUTTON_BASE =
  "inline-flex items-center justify-center gap-1.5 rounded-lg border px-3 py-1.5 "
  + "text-[13px] font-semibold whitespace-nowrap transition-colors duration-150 "
  + "disabled:cursor-not-allowed disabled:opacity-45";

const BUTTON_VARIANTS: Record<ButtonVariant, string> = {
  primary:
    "border-transparent bg-[var(--cc-ember)] text-[#1b0f05] hover:bg-[#ff9b4f] "
    + "disabled:hover:bg-[var(--cc-ember)]",
  secondary:
    "border-[var(--cc-line)] bg-[var(--cc-elevated)] text-[var(--cc-ink)] "
    + "hover:border-[#39405422] hover:bg-[#252a38]",
  ghost:
    "border-transparent bg-transparent text-[var(--cc-ink-muted)] "
    + "hover:bg-[var(--cc-panel-2)] hover:text-[var(--cc-ink)]",
  danger:
    "border-[#5d2338] bg-[#2a131d] text-[var(--cc-loss)] hover:bg-[#361824]",
};

export function Button({
  variant = "secondary",
  className,
  children,
  ...rest
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: ButtonVariant }) {
  return (
    <button type="button" className={cx(BUTTON_BASE, BUTTON_VARIANTS[variant], className)} {...rest}>
      {children}
    </button>
  );
}

export function IconButton({
  label,
  active,
  className,
  children,
  ...rest
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { label: string; active?: boolean }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      className={cx(
        "inline-flex h-8 w-8 items-center justify-center rounded-lg border transition-colors duration-150",
        active
          ? "border-[var(--cc-ember)] bg-[var(--cc-ember-wash)] text-[var(--cc-ember)]"
          : "border-[var(--cc-line)] bg-[var(--cc-elevated)] text-[var(--cc-ink-muted)] hover:text-[var(--cc-ink)]",
        className,
      )}
      {...rest}
    >
      {children}
    </button>
  );
}

/* ── Fields ────────────────────────────────────────────────────── */

const FIELD =
  "w-full rounded-lg border border-[var(--cc-line)] bg-[var(--cc-panel-2)] px-3 py-2 "
  + "text-[13px] text-[var(--cc-ink)] placeholder:text-[var(--cc-ink-faint)] "
  + "transition-colors duration-150 focus:border-[var(--cc-ember)] focus:outline-none";

export function Input({ className, ...rest }: React.InputHTMLAttributes<HTMLInputElement>) {
  return <input className={cx(FIELD, className)} {...rest} />;
}

export function Textarea({ className, ...rest }: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea className={cx(FIELD, "resize-y leading-relaxed", className)} {...rest} />;
}

export function Select({ className, children, ...rest }: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select className={cx(FIELD, "cursor-pointer appearance-none pr-8", className)} {...rest}>
      {children}
    </select>
  );
}

export function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-[11px] font-semibold uppercase tracking-[0.07em] text-[var(--cc-ink-faint)]">
        {label}
      </span>
      {children}
      {hint && <span className="mt-1 block text-[12px] text-[var(--cc-ink-faint)]">{hint}</span>}
    </label>
  );
}

/* ── Surfaces ──────────────────────────────────────────────────── */

export function Panel({
  className,
  children,
  ...rest
}: React.HTMLAttributes<HTMLDivElement> & { children: ReactNode }) {
  return (
    <div
      className={cx("rounded-[var(--cc-radius)] border border-[var(--cc-line)] bg-[var(--cc-panel)]", className)}
      {...rest}
    >
      {children}
    </div>
  );
}

/** The bar that titles a table or a panel. */
export function SectionHead({
  title, count, action,
}: { title: string; count?: number | string; action?: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3 border-b border-[var(--cc-line)] px-3 py-2">
      <h2 className="flex items-baseline gap-2 text-[12px] font-semibold uppercase tracking-[0.08em] text-[var(--cc-ink-muted)]">
        {title}
        {count !== undefined && (
          <span className="cc-num text-[11px] font-normal text-[var(--cc-ink-faint)]">{count}</span>
        )}
      </h2>
      {action}
    </div>
  );
}

export function Tag({ children, tone = "neutral" }: { children: ReactNode; tone?: "neutral" | "ember" | "live" }) {
  const tones = {
    neutral: "border-[var(--cc-line)] text-[var(--cc-ink-muted)]",
    ember: "border-[#4a2e17] bg-[var(--cc-ember-wash)] text-[var(--cc-ember)]",
    live: "border-[#1d4432] bg-[var(--cc-live-wash)] text-[var(--cc-live)]",
  };
  return (
    <span className={cx(
      "inline-flex items-center rounded-md border px-1.5 py-0.5 text-[11px] font-medium leading-4",
      tones[tone],
    )}>
      {children}
    </span>
  );
}

/* ── People ────────────────────────────────────────────────────── */

/** Colour comes from the id, so one person is the same colour everywhere. */
export function avatarHue(id: string): number {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return h % 360;
}

export function Avatar({
  id, name, url, size = 28, online,
}: { id: string; name: string; url?: string | null; size?: number; online?: boolean }) {
  const hue = avatarHue(id);
  const initials = name.trim().split(/\s+/).slice(0, 2).map((w) => w[0]).join("").toUpperCase() || "?";
  return (
    <span className="relative inline-flex shrink-0" style={{ width: size, height: size }}>
      {url ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={url} alt="" className="h-full w-full rounded-full object-cover" />
      ) : (
        <span
          className="flex h-full w-full items-center justify-center rounded-full font-semibold"
          style={{
            background: `linear-gradient(145deg, hsl(${hue} 46% 34%), hsl(${(hue + 40) % 360} 42% 22%))`,
            color: `hsl(${hue} 70% 88%)`,
            fontSize: Math.max(9, Math.round(size * 0.38)),
          }}
        >
          {initials}
        </span>
      )}
      {online !== undefined && (
        <span
          className="absolute -bottom-0.5 -right-0.5 rounded-full border-2 border-[var(--cc-panel)]"
          style={{
            width: Math.max(8, size * 0.3),
            height: Math.max(8, size * 0.3),
            background: online ? "var(--cc-live)" : "var(--cc-ink-faint)",
          }}
          title={online ? "Online" : "Offline"}
        />
      )}
    </span>
  );
}

/* ── States ────────────────────────────────────────────────────── */

/** An empty state teaches the screen rather than announcing nothing is here. */
export function EmptyState({
  icon, title, body, action,
}: { icon?: ReactNode; title: string; body: string; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-2 px-6 py-12 text-center">
      {icon && <span className="mb-1 text-[var(--cc-ink-faint)]">{icon}</span>}
      <p className="text-[15px] font-semibold text-[var(--cc-ink)]">{title}</p>
      <p className="max-w-[46ch] text-[13px] leading-relaxed text-[var(--cc-ink-muted)]">{body}</p>
      {action && <div className="mt-3">{action}</div>}
    </div>
  );
}

export function Spinner({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" className="animate-spin" aria-hidden="true">
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="2.4" opacity="0.2" fill="none" />
      <path
        d="M21 12a9 9 0 0 0-9-9"
        stroke="currentColor"
        strokeWidth="2.4"
        strokeLinecap="round"
        fill="none"
      />
    </svg>
  );
}

export function Loading({ label = "Loading" }: { label?: string }) {
  return (
    <div className="flex items-center justify-center gap-2 py-12 text-[13px] text-[var(--cc-ink-muted)]">
      <Spinner />
      {label}
    </div>
  );
}

/** A transient message. Sits above the content rather than blocking it. */
export function Notice({ message, onClose }: { message: string; onClose: () => void }) {
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(onClose, 6000);
    return () => { if (timer.current) clearTimeout(timer.current); };
  }, [message, onClose]);

  return (
    <div
      role="status"
      className="cc-rise pointer-events-auto fixed bottom-4 left-1/2 z-50 flex max-w-[min(34rem,calc(100vw-2rem))]
                 -translate-x-1/2 items-start gap-3 rounded-lg border border-[var(--cc-line)]
                 bg-[var(--cc-elevated)] px-3 py-2 text-[13px] shadow-[var(--cc-shadow)]"
    >
      <span className="flex-1">{message}</span>
      <button
        type="button"
        onClick={onClose}
        aria-label="Dismiss"
        className="mt-0.5 text-[var(--cc-ink-faint)] transition-colors hover:text-[var(--cc-ink)]"
      >
        <CloseIcon size={14} />
      </button>
    </div>
  );
}

/** A search box that reports as you type. */
export function SearchField({
  value, onChange, placeholder, icon,
}: { value: string; onChange: (v: string) => void; placeholder: string; icon: ReactNode }) {
  return (
    <div className="relative">
      <span className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--cc-ink-faint)]">
        {icon}
      </span>
      <Input
        type="search"
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        className="pl-8"
      />
    </div>
  );
}

/** Tiny controlled tab strip, used inside panels. */
export function TabStrip<T extends string>({
  tabs, active, onChange,
}: { tabs: { id: T; label: string; count?: number }[]; active: T; onChange: (id: T) => void }) {
  return (
    <div role="tablist" className="flex items-center gap-1">
      {tabs.map((t) => (
        <button
          key={t.id}
          type="button"
          role="tab"
          aria-selected={active === t.id}
          onClick={() => onChange(t.id)}
          className={cx(
            "rounded-md px-2.5 py-1 text-[12px] font-semibold transition-colors duration-150",
            active === t.id
              ? "bg-[var(--cc-elevated)] text-[var(--cc-ink)]"
              : "text-[var(--cc-ink-faint)] hover:text-[var(--cc-ink-muted)]",
          )}
        >
          {t.label}
          {t.count !== undefined && <span className="cc-num ml-1.5 text-[11px] opacity-60">{t.count}</span>}
        </button>
      ))}
    </div>
  );
}

/** Relative time, told the way a person would. */
export function useRelativeTime(iso: string): string {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(t);
  }, []);
  return relativeTime(iso, now);
}

export function relativeTime(iso: string, now = Date.now()): string {
  const at = new Date(iso).getTime();
  // A row written by a backend that did not set the column would otherwise
  // render the words "Invalid Date" straight into the page.
  if (!Number.isFinite(at)) return "";
  const diff = now - at;
  const mins = Math.round(diff / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days < 7) return `${days}d ago`;
  const weeks = Math.round(days / 7);
  if (weeks < 5) return `${weeks}w ago`;
  return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}
