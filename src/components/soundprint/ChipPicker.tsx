"use client";

import { useMemo, useState } from "react";
import { cn } from "@/lib/utils";
import { Icon } from "../icons";

interface Group {
  label: string;
  items: string[];
}

interface Props {
  label: string;
  /** Flat list, or grouped (genres are grouped by family). */
  options: string[] | Group[];
  selected: string[];
  onChange: (next: string[]) => void;
  placeholder?: string;
  /** How many to show before "show all". */
  preview?: number;
}

function isGrouped(o: string[] | Group[]): o is Group[] {
  return o.length > 0 && typeof o[0] === "object";
}

export function ChipPicker({
  label,
  options,
  selected,
  onChange,
  placeholder = "Search…",
  preview = 14,
}: Props) {
  const [query, setQuery] = useState("");
  const [expanded, setExpanded] = useState(false);

  const groups: Group[] = useMemo(
    () => (isGrouped(options) ? options : [{ label: "", items: options as string[] }]),
    [options],
  );

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return groups;
    return groups
      .map((g) => ({ ...g, items: g.items.filter((i) => i.toLowerCase().includes(q)) }))
      .filter((g) => g.items.length);
  }, [groups, query]);

  const toggle = (item: string) => {
    onChange(
      selected.includes(item) ? selected.filter((s) => s !== item) : [...selected, item],
    );
  };

  const total = groups.reduce((n, g) => n + g.items.length, 0);
  const showAll = expanded || query.trim().length > 0;

  return (
    <div className="rounded-xl border border-line bg-panel-2/40 p-3">
      <div className="mb-2 flex items-center gap-2">
        <span className="text-xs font-semibold text-ink">{label}</span>
        {selected.length > 0 && (
          <span className="rounded-full bg-brand/20 px-1.5 py-0.5 text-[10px] font-semibold text-brand">
            {selected.length}
          </span>
        )}
        <div className="ml-auto flex items-center gap-2">
          {selected.length > 0 && (
            <button
              onClick={() => onChange([])}
              className="text-[10px] font-medium text-ink-faint transition hover:text-ink"
            >
              Clear
            </button>
          )}
          <button
            onClick={() => setExpanded((e) => !e)}
            className="inline-flex items-center gap-1 text-[10px] font-medium text-ink-faint transition hover:text-ink"
          >
            {showAll ? "Less" : `All ${total}`}
            <Icon.Chevron
              width={9}
              height={9}
              className={cn("transition-transform", showAll && "rotate-180")}
            />
          </button>
        </div>
      </div>

      {/* Chosen chips always visible, even when collapsed */}
      {selected.length > 0 && (
        <div className="mb-2 flex flex-wrap gap-1.5">
          {selected.map((s) => (
            <button
              key={s}
              onClick={() => toggle(s)}
              className="inline-flex items-center gap-1 rounded-full bg-brand px-2 py-0.5 text-[11px] font-medium text-white transition hover:bg-brand-2"
            >
              {s}
              <Icon.Close width={9} height={9} />
            </button>
          ))}
        </div>
      )}

      {showAll && (
        <>
          <div className="relative mb-2">
            <Icon.Search
              width={12}
              height={12}
              className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-ink-faint"
            />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={placeholder}
              className="w-full rounded-lg border border-line bg-canvas py-1.5 pl-7 pr-2 text-xs text-ink outline-none transition placeholder:text-ink-faint focus:border-brand/60"
            />
          </div>

          <div className="max-h-52 space-y-2 overflow-y-auto pr-1">
            {filtered.map((g) => (
              <div key={g.label || "all"}>
                {g.label && (
                  <div className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-ink-faint">
                    {g.label}
                  </div>
                )}
                <div className="flex flex-wrap gap-1.5">
                  {g.items.map((item) => (
                    <Chip
                      key={item}
                      active={selected.includes(item)}
                      onClick={() => toggle(item)}
                      label={item}
                    />
                  ))}
                </div>
              </div>
            ))}
            {!filtered.length && (
              <p className="py-2 text-center text-[11px] text-ink-faint">No matches.</p>
            )}
          </div>
        </>
      )}

      {!showAll && selected.length === 0 && (
        <div className="flex flex-wrap gap-1.5">
          {groups[0]?.items.slice(0, preview).map((item) => (
            <Chip key={item} active={false} onClick={() => toggle(item)} label={item} />
          ))}
        </div>
      )}
    </div>
  );
}

function Chip({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "rounded-full border px-2 py-0.5 text-[11px] transition",
        active
          ? "border-brand bg-brand text-white"
          : "border-line bg-panel text-ink-muted hover:border-brand/50 hover:text-ink",
      )}
    >
      {label}
    </button>
  );
}
