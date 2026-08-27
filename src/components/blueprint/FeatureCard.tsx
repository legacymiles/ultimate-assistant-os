"use client";

import type { OverviewFeature } from "@/lib/blueprint/types";
import { cn } from "@/lib/utils";
import { Icon } from "../icons";

interface Props {
  feature: OverviewFeature;
  accent: "core" | "support";
  index: number;
  isFirst: boolean;
  isLast: boolean;
  onChange: (patch: Partial<OverviewFeature>) => void;
  onDelete: () => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
  onSwapGroup: () => void;
}

export function FeatureCard({
  feature,
  accent,
  index,
  isFirst,
  isLast,
  onChange,
  onDelete,
  onMoveUp,
  onMoveDown,
  onSwapGroup,
}: Props) {
  const accentBar = accent === "core" ? "before:bg-core" : "before:bg-support";
  const swapLabel = accent === "core" ? "Make supporting" : "Make core";

  return (
    <div
      className={cn(
        "group relative rounded-xl border border-line bg-panel-2/60 p-3 pl-4 transition",
        "before:absolute before:left-0 before:top-2 before:bottom-2 before:w-1 before:rounded-full",
        accentBar,
        "hover:border-line-soft focus-within:border-brand/50",
      )}
    >
      <div className="flex items-start gap-2">
        <span className="mt-1.5 select-none text-[11px] font-semibold tabular-nums text-ink-faint">
          {String(index + 1).padStart(2, "0")}
        </span>
        <div className="min-w-0 flex-1">
          <input
            value={feature.title}
            onChange={(e) => onChange({ title: e.target.value })}
            placeholder="Feature name"
            className="w-full bg-transparent text-sm font-semibold text-ink outline-none placeholder:text-ink-faint"
          />
          <textarea
            value={feature.description}
            onChange={(e) => onChange({ description: e.target.value })}
            placeholder="What it does / why it matters"
            rows={2}
            className="mt-1 w-full resize-none bg-transparent text-xs leading-relaxed text-ink-muted outline-none placeholder:text-ink-faint"
          />
        </div>

        {/* Controls — always reachable, emphasised on hover/focus */}
        <div className="flex shrink-0 flex-col items-center gap-0.5 opacity-60 transition group-hover:opacity-100 group-focus-within:opacity-100">
          <IconBtn label="Move up" disabled={isFirst} onClick={onMoveUp}>
            <Icon.Chevron width={13} height={13} className="-rotate-90" />
          </IconBtn>
          <IconBtn label="Move down" disabled={isLast} onClick={onMoveDown}>
            <Icon.Chevron width={13} height={13} className="rotate-90" />
          </IconBtn>
        </div>
      </div>

      <div className="mt-1.5 flex items-center gap-2 pl-6">
        <button
          onClick={onSwapGroup}
          className="inline-flex items-center gap-1 rounded-md border border-line px-1.5 py-0.5 text-[10px] font-medium text-ink-faint transition hover:border-line-soft hover:text-ink"
        >
          <Icon.ArrowRight width={11} height={11} />
          {swapLabel}
        </button>
        <button
          onClick={onDelete}
          className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[10px] font-medium text-ink-faint transition hover:text-red-400"
          aria-label="Delete feature"
        >
          <Icon.Trash width={11} height={11} />
          Remove
        </button>
      </div>
    </div>
  );
}

function IconBtn({
  children,
  label,
  disabled,
  onClick,
}: {
  children: React.ReactNode;
  label: string;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      title={label}
      className="rounded p-0.5 text-ink-faint transition hover:text-ink disabled:cursor-not-allowed disabled:opacity-30"
    >
      {children}
    </button>
  );
}
