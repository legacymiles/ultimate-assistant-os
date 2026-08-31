"use client";

import { useState, type ReactNode } from "react";
import { Icon } from "../icons";

interface Props {
  id: string;
  label: string;
  icon: ReactNode;
  count: number;
  /** Shown in place of the body when count is 0. */
  emptyHint: string;
  /** Rendered to the right of the count, before the + button. */
  badge?: ReactNode;
  onAdd?: () => void;
  addLabel?: string;
  defaultOpen?: boolean;
  /**
   * Render the body even when count is 0 — set while a section is mid-add so
   * the inline form has somewhere to appear, or when the body carries its own
   * affordance (the vault gate, the server/site chooser).
   */
  bodyOverride?: boolean;
  /** Offered only when the section is empty — removing it must never hide data. */
  onRemove?: () => void;
  children: ReactNode;
}

/**
 * One typed section of a folder workspace.
 * Collapsed, it is a single quiet row — which is the whole reason a folder with
 * six sections still reads as minimal.
 */
export function Section({
  id,
  label,
  icon,
  count,
  emptyHint,
  badge,
  onAdd,
  addLabel = "Add",
  defaultOpen = true,
  bodyOverride = false,
  onRemove,
  children,
}: Props) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <section className="border-b border-line-soft last:border-b-0">
      <div className="group/sec flex items-center gap-2 py-2">
        <button
          onClick={() => setOpen((v) => !v)}
          className="flex min-w-0 flex-1 items-center gap-2 text-left"
          aria-expanded={open}
          aria-controls={`sec-${id}`}
        >
          <Icon.Chevron
            width={13}
            height={13}
            className={"shrink-0 text-ink-faint transition-transform " + (open ? "rotate-90" : "")}
          />
          <span className="shrink-0 text-ink-faint">{icon}</span>
          <span className="truncate text-[13px] font-medium text-ink-muted">{label}</span>
          {count > 0 && (
            <span className="shrink-0 rounded-md bg-panel-2 px-1.5 py-0.5 text-[10px] font-semibold tabular-nums text-ink-faint">
              {count}
            </span>
          )}
          {badge}
        </button>
        {onRemove && count === 0 && (
          <button
            onClick={onRemove}
            title={`Remove the ${label} section`}
            aria-label={`Remove the ${label} section`}
            className="shrink-0 rounded-md p-1 text-ink-faint opacity-0 transition hover:bg-panel-2 hover:text-red-400 focus:opacity-100 group-hover/sec:opacity-100"
          >
            <Icon.Close width={13} height={13} />
          </button>
        )}
        {onAdd && (
          <button
            onClick={onAdd}
            title={addLabel}
            aria-label={addLabel}
            className="shrink-0 rounded-md p-1 text-ink-faint opacity-0 transition hover:bg-panel-2 hover:text-ink focus:opacity-100 group-hover/sec:opacity-100"
          >
            <Icon.Plus width={14} height={14} />
          </button>
        )}
      </div>

      {open && (
        <div id={`sec-${id}`} className="pb-2.5">
          {count === 0 && !bodyOverride ? (
            <button
              onClick={onAdd}
              disabled={!onAdd}
              className="w-full rounded-lg px-6 py-1 text-left text-xs text-ink-faint transition enabled:hover:bg-panel-2 enabled:hover:text-ink-muted"
            >
              {emptyHint}
            </button>
          ) : (
            children
          )}
        </div>
      )}
    </section>
  );
}

/** The shared row chrome every section body uses. */
export function Row({
  onClick,
  children,
  actions,
  tone,
}: {
  onClick?: () => void;
  children: ReactNode;
  actions?: ReactNode;
  tone?: "default" | "muted";
}) {
  return (
    <div
      className={
        "group/row flex items-center gap-2.5 rounded-lg px-2 py-1.5 transition hover:bg-panel-2 " +
        (tone === "muted" ? "opacity-55" : "")
      }
    >
      <button
        onClick={onClick}
        disabled={!onClick}
        className="flex min-w-0 flex-1 items-center gap-2.5 text-left disabled:cursor-default"
      >
        {children}
      </button>
      {actions && (
        <div className="flex shrink-0 items-center gap-0.5 opacity-0 transition focus-within:opacity-100 group-hover/row:opacity-100">
          {actions}
        </div>
      )}
    </div>
  );
}

/** Small square icon button used for row actions (copy, reveal, delete…). */
export function RowAction({
  label,
  onClick,
  danger,
  children,
}: {
  label: string;
  onClick: () => void;
  danger?: boolean;
  children: ReactNode;
}) {
  return (
    <button
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      title={label}
      aria-label={label}
      className={
        "rounded-md p-1 text-ink-faint transition hover:bg-elevated " +
        (danger ? "hover:text-red-400" : "hover:text-ink")
      }
    >
      {children}
    </button>
  );
}
