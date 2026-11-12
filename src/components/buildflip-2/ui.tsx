"use client";

import { AnimatePresence, motion } from "motion/react";
import { Loader2, X } from "lucide-react";
import { useEffect, useRef } from "react";
import { cn, ease } from "@/lib/buildflip-2/ui";

/* ------------------------------------------------------------------ Button */

type ButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "secondary" | "ghost" | "danger";
  size?: "sm" | "md" | "lg";
  loading?: boolean;
  icon?: React.ReactNode;
};

/** Every control has hover, press, focus, disabled and loading states. */
export function Button({
  variant = "secondary",
  size = "md",
  loading,
  icon,
  className,
  children,
  disabled,
  ...rest
}: ButtonProps) {
  return (
    <button
      {...rest}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={cn(
        "inline-flex select-none items-center justify-center gap-2 rounded-[var(--radius-ctl)] font-medium transition-all duration-200",
        "active:scale-[0.985] disabled:pointer-events-none disabled:opacity-45",
        // 44px minimum tap target on every variant (U1)
        size === "sm" && "min-h-9 px-3 text-[13px]",
        size === "md" && "min-h-11 px-4 text-[14px]",
        size === "lg" && "min-h-12 px-5 text-[15px]",
        variant === "primary" &&
          "bg-[var(--accent)] text-[var(--accent-ink)] shadow-[0_1px_0_#fff3_inset,0_6px_18px_-8px_var(--accent)] hover:brightness-110",
        variant === "secondary" &&
          "border border-[var(--line)] bg-[var(--surface-2)] text-[var(--ink)] hover:border-[var(--accent-line)] hover:bg-[var(--surface-3)]",
        variant === "ghost" &&
          "text-[var(--ink-2)] hover:bg-[var(--surface-2)] hover:text-[var(--ink)]",
        variant === "danger" &&
          "border border-[color-mix(in_srgb,var(--loss)_45%,transparent)] bg-[var(--loss-soft)] text-[var(--loss)] hover:bg-[color-mix(in_srgb,var(--loss)_18%,transparent)]",
        className,
      )}
    >
      {loading ? (
        <Loader2 aria-hidden className="h-4 w-4 shrink-0 spin" />
      ) : (
        icon
      )}
      {children}
    </button>
  );
}

/* -------------------------------------------------------------------- Card */

export function Card({
  className,
  children,
  as: As = "div",
}: {
  className?: string;
  children: React.ReactNode;
  /* Parameterised on purpose: a bare `React.ElementType` resolves its props
     to `never` under the hub's @types/react, which makes the className and
     children below type errors. */
  as?: React.ElementType<{ className?: string; children?: React.ReactNode }>;
}) {
  return (
    <As
      className={cn(
        "rounded-[var(--radius-card)] border border-[var(--line)] bg-[var(--surface)] shadow-[var(--shadow-card)]",
        className,
      )}
    >
      {children}
    </As>
  );
}

/* ------------------------------------------------------------------- Badge */

export function Badge({
  tone = "neutral",
  className,
  children,
}: {
  tone?: "neutral" | "accent" | "profit" | "loss" | "warn";
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium leading-5",
        tone === "neutral" && "border-[var(--line)] bg-[var(--surface-2)] text-[var(--ink-2)]",
        tone === "accent" && "border-[var(--accent-line)] bg-[var(--accent-soft)] text-[var(--accent)]",
        tone === "profit" &&
          "border-[color-mix(in_srgb,var(--profit)_40%,transparent)] bg-[var(--profit-soft)] text-[var(--profit)]",
        tone === "loss" &&
          "border-[color-mix(in_srgb,var(--loss)_40%,transparent)] bg-[var(--loss-soft)] text-[var(--loss)]",
        tone === "warn" &&
          "border-[color-mix(in_srgb,var(--warn)_40%,transparent)] bg-[color-mix(in_srgb,var(--warn)_12%,transparent)] text-[var(--warn)]",
        className,
      )}
    >
      {children}
    </span>
  );
}

/* --------------------------------------------------------------- Skeletons */

export function Skeleton({ className }: { className?: string }) {
  return <div aria-hidden className={cn("skel", className)} />;
}

/** A skeleton shaped like the thing that's loading — never a spinner (P3). */
export function PlanSkeleton() {
  return (
    <div className="space-y-4" role="status" aria-label="Loading your plan">
      <Skeleton className="h-7 w-2/3" />
      <Skeleton className="h-4 w-full" />
      <Skeleton className="h-4 w-4/5" />
      <Skeleton className="h-28 w-full rounded-[var(--radius-card)]" />
      <div className="grid gap-3 sm:grid-cols-3">
        <Skeleton className="h-20 rounded-[var(--radius-card)]" />
        <Skeleton className="h-20 rounded-[var(--radius-card)]" />
        <Skeleton className="h-20 rounded-[var(--radius-card)]" />
      </div>
    </div>
  );
}

/* ------------------------------------------------------------ Empty states */

export function Empty({
  icon,
  title,
  body,
  action,
  className,
}: {
  icon?: React.ReactNode;
  title: string;
  /** Always says what to do next (U4). */
  body: string;
  action?: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center gap-3 rounded-[var(--radius-card)] border border-dashed border-[var(--line)] px-5 py-10 text-center",
        className,
      )}
    >
      {icon && <div className="text-[var(--ink-4)]">{icon}</div>}
      <h3 className="text-[15px] font-semibold text-[var(--ink)]">{title}</h3>
      <p className="max-w-sm text-[13px] leading-relaxed text-[var(--ink-3)]">{body}</p>
      {action}
    </div>
  );
}

/* ------------------------------------------------------------------- Sheet */

/**
 * A bottom sheet on a phone, a centred dialog on a laptop. Fits the screen with
 * every button readable, traps focus, and closes on Escape or backdrop (U9).
 */
export function Sheet({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  wide,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
  wide?: boolean;
}) {
  const panel = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const prev = document.activeElement as HTMLElement | null;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onClose();
        return;
      }
      if (e.key !== "Tab" || !panel.current) return;
      const nodes = panel.current.querySelectorAll<HTMLElement>(
        'a[href],button:not([disabled]),input:not([disabled]),textarea:not([disabled]),select:not([disabled]),[tabindex]:not([tabindex="-1"])',
      );
      if (nodes.length === 0) return;
      const first = nodes[0]!;
      const last = nodes[nodes.length - 1]!;
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKey);
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const t = setTimeout(() => {
      panel.current
        ?.querySelector<HTMLElement>(
          'input:not([type="hidden"]),textarea,button:not([data-autofocus="false"])',
        )
        ?.focus();
    }, 60);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = overflow;
      clearTimeout(t);
      prev?.focus?.();
    };
  }, [open, onClose]);

  return (
    <AnimatePresence>
      {open && (
        <div className="fixed inset-0 z-[80] flex items-end justify-center sm:items-center">
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            onClick={onClose}
            className="absolute inset-0 bg-[#05070a]/70 backdrop-blur-[3px]"
          />
          <motion.div
            ref={panel}
            role="dialog"
            aria-modal="true"
            aria-label={title}
            initial={{ opacity: 0, y: 40, scale: 0.985 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 24, scale: 0.99 }}
            transition={{ duration: 0.32, ease }}
            className={cn(
              "relative flex max-h-[92dvh] w-full flex-col overflow-hidden rounded-t-[18px] border border-[var(--line)] bg-[var(--surface)] shadow-[var(--shadow-pop)] sm:rounded-[16px]",
              wide ? "sm:max-w-2xl" : "sm:max-w-md",
            )}
          >
            <div className="flex items-start justify-between gap-3 border-b border-[var(--line-soft)] px-5 py-4">
              <div className="min-w-0">
                <h2 className="text-[16px] font-semibold text-[var(--ink)]">{title}</h2>
                {description && (
                  <p className="mt-1 text-[13px] leading-relaxed text-[var(--ink-3)]">
                    {description}
                  </p>
                )}
              </div>
              <button
                type="button"
                onClick={onClose}
                aria-label="Close"
                className="-mr-1 -mt-1 grid h-10 w-10 shrink-0 place-items-center rounded-[10px] text-[var(--ink-3)] transition hover:bg-[var(--surface-2)] hover:text-[var(--ink)]"
              >
                <X aria-hidden className="h-4.5 w-4.5" />
              </button>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 py-4">
              {children}
            </div>
            {footer && (
              <div className="border-t border-[var(--line-soft)] bg-[var(--surface-2)] px-5 py-3.5 pb-[max(0.875rem,env(safe-area-inset-bottom))]">
                {footer}
              </div>
            )}
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}

/* --------------------------------------------------------------- Field bits */

export function Label({
  htmlFor,
  children,
  hint,
}: {
  htmlFor: string;
  children: React.ReactNode;
  hint?: string;
}) {
  return (
    <label
      htmlFor={htmlFor}
      className="mb-1.5 block text-[12px] font-medium text-[var(--ink-2)]"
    >
      {children}
      {hint && <span className="ml-1.5 font-normal text-[var(--ink-4)]">{hint}</span>}
    </label>
  );
}

export const fieldClass =
  "w-full rounded-[var(--radius-ctl)] border border-[var(--line)] bg-[var(--surface-2)] px-3 py-2.5 text-[14px] text-[var(--ink)] placeholder:text-[var(--ink-4)] transition focus:border-[var(--accent-line)] focus:bg-[var(--surface)] focus:outline-none focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--accent)]";

/** Plain-English error with a next step, never a code (R3). */
export function ErrorNote({
  children,
  onRetry,
  retryLabel = "Try again",
}: {
  children: React.ReactNode;
  onRetry?: () => void;
  retryLabel?: string;
}) {
  return (
    <div
      role="alert"
      className="flex flex-col gap-2.5 rounded-[var(--radius-ctl)] border border-[color-mix(in_srgb,var(--loss)_35%,transparent)] bg-[var(--loss-soft)] px-3.5 py-3 text-[13px] leading-relaxed text-[var(--ink)] sm:flex-row sm:items-center sm:justify-between"
    >
      <span className="min-w-0">{children}</span>
      {onRetry && (
        <Button size="sm" variant="secondary" onClick={onRetry} className="shrink-0">
          {retryLabel}
        </Button>
      )}
    </div>
  );
}
