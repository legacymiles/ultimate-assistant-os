"use client";

// The page shape every screen shares: a main ledger column, and an optional
// rail that carries whatever is live right now. The rail drops below the main
// column on a narrow screen rather than squeezing it.

import type { ReactNode } from "react";
import { cx } from "./ui";

export function Columns({
  children, rail, className,
}: { children: ReactNode; rail?: ReactNode; className?: string }) {
  return (
    <div className={cx("mx-auto w-full max-w-[1320px] px-3 py-3 md:px-4 md:py-4", className)}>
      <div className={cx("grid gap-4", !!rail && "lg:grid-cols-[minmax(0,1fr)_320px]")}>
        <div className="min-w-0">{children}</div>
        {rail && <aside className="min-w-0 space-y-4">{rail}</aside>}
      </div>
    </div>
  );
}

/** A page heading with room for a sentence of orientation and one control. */
export function PageHead({
  title, subtitle, action,
}: { title: string; subtitle?: string; action?: ReactNode }) {
  return (
    <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="text-[19px] font-bold leading-tight tracking-tight">{title}</h1>
        {subtitle && (
          <p className="mt-1 max-w-[62ch] text-[13px] leading-relaxed text-[var(--cc-ink-muted)]">
            {subtitle}
          </p>
        )}
      </div>
      {action}
    </div>
  );
}
