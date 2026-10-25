"use client";

// The big switch between Cook Connect's two halves. One account, two apps:
// Cookbook on the left, Connect on the right. The thumb slides, and the whole
// app's accent follows it (see `data-side` in cook-connect.css).

import type { ReactNode } from "react";
import { SIDES, type Side } from "@/lib/cook-connect/sides";
import { BookIcon, CardsIcon } from "./icons";
import { cx } from "./ui";

const ICON: Record<Side, (p: { size?: number }) => ReactNode> = {
  cookbook: BookIcon,
  connect: CardsIcon,
};

export function SideToggle({
  side, onChange, size = "lg", labels, className,
}: {
  side: Side;
  onChange: (side: Side) => void;
  /** rail: the desktop rail's tall tile. lg: the phone header. md: inside a page (the leaderboard). */
  size?: "rail" | "lg" | "md";
  /** Override the words, e.g. "Cookbooks" on the leaderboard. */
  labels?: Partial<Record<Side, string>>;
  className?: string;
}) {
  return (
    <div
      role="tablist"
      aria-label="Cookbook or Connect"
      data-active={side}
      className={cx("cc-side-toggle", size !== "lg" && `cc-side-toggle--${size}`, className)}
    >
      <span className="cc-side-thumb" aria-hidden="true" />
      {SIDES.map((s) => {
        const Icon = ICON[s.id];
        const active = s.id === side;
        return (
          <button
            key={s.id}
            type="button"
            role="tab"
            aria-selected={active}
            title={s.blurb}
            onClick={() => onChange(s.id)}
            className={cx("cc-side-option", active && "is-active")}
          >
            <Icon size={size === "md" ? 15 : size === "rail" ? 19 : 17} />
            <span>{labels?.[s.id] ?? s.label}</span>
          </button>
        );
      })}
    </div>
  );
}
