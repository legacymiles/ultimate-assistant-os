"use client";

import { useState } from "react";
import { Icon } from "../icons";
import { ContentBadge } from "./chips";
import { ACCESS_LABEL, groupHue, isNew } from "@/lib/ai-rankings/types";
import type { Tool } from "@/lib/ai-rankings/types";
import type { SortBy, SortDir } from "@/lib/ai-rankings/query";

interface Props {
  tools: Tool[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  sort: SortBy;
  dir: SortDir;
  onSort: (by: SortBy) => void;
  /**
   * True only when a single leaf category is in view. Dragging rows into an
   * order is meaningless across mixed categories, so the grips only appear
   * where the order they produce is the one that gets saved.
   */
  rankable: boolean;
  onMove: (id: string, position: number) => void;
  onRank: (id: string) => void;
  selected: Set<string>;
  onToggleSelect: (id: string) => void;
  onToggleAll: () => void;
}

// Fixed widths, kept lean. The responsive prefixes hide columns by VIEWPORT,
// which says nothing about how much room the table actually has once the record
// panel is open — so the widths have to leave the name column a real share, and
// the table carries a min-width so it scrolls rather than crushing it.
const COLS: { key: SortBy | null; label: string; className: string }[] = [
  { key: null, label: "sel", className: "w-8" },
  { key: "name", label: "Name", className: "min-w-0" },
  { key: "category", label: "Section", className: "hidden w-28 md:table-cell" },
  { key: "access", label: "Cost", className: "hidden w-20 whitespace-nowrap sm:table-cell" },
  { key: null, label: "Source", className: "hidden w-20 lg:table-cell" },
  { key: null, label: "Runs", className: "hidden w-24 lg:table-cell" },
  { key: "rank", label: "Rank", className: "w-24 whitespace-nowrap" },
  { key: "newest", label: "Added", className: "hidden w-24 whitespace-nowrap xl:table-cell" },
];

export function ToolTable({
  tools,
  selectedId,
  onSelect,
  sort,
  dir,
  onSort,
  rankable,
  onMove,
  onRank,
  selected,
  onToggleSelect,
  onToggleAll,
}: Props) {
  const [dragId, setDragId] = useState<string | null>(null);
  const [overId, setOverId] = useState<string | null>(null);

  const reset = () => {
    setDragId(null);
    setOverId(null);
  };
  const drop = (target: Tool) => {
    if (!dragId || dragId === target.id) return reset();
    if (target.rank !== undefined) onMove(dragId, target.rank);
    reset();
  };

  if (tools.length === 0) {
    return (
      <p className="px-4 py-20 text-center text-sm text-ink-muted">
        Nothing here yet. Add a record, or pick another view.
      </p>
    );
  }

  return (
    // table-fixed, not auto: with auto layout the summary column widens to fit
    // its longest line and pushes the whole table off a phone screen, and no
    // amount of truncate on the cell can win against that.
    // The min-width starts at sm: on a phone it would push the rank column off
    // the right edge, and rank is the column the app exists for.
    <table className="w-full table-fixed border-collapse text-[13px] sm:min-w-[560px]">
      <thead className="sticky top-0 z-10 bg-canvas">
        <tr className="border-b border-line">
          {COLS.map((col) => (
            <th
              key={col.label}
              className={
                "px-2 py-2 text-left font-mono text-[10px] font-medium uppercase tracking-widest text-ink-faint " +
                col.className
              }
            >
              {col.label === "sel" ? (
                <input
                  type="checkbox"
                  checked={tools.length > 0 && tools.every((t) => selected.has(t.id))}
                  onChange={onToggleAll}
                  aria-label="Select every row in view"
                  title="Select every row in view"
                  className="accent-[var(--color-brand)]"
                />
              ) : col.key ? (
                <button
                  onClick={() => onSort(col.key as SortBy)}
                  className="inline-flex items-center gap-1 transition hover:text-ink"
                >
                  {col.label}
                  {sort === col.key && (
                    <span className="text-brand">{dir === "asc" ? "↑" : "↓"}</span>
                  )}
                </button>
              ) : (
                col.label
              )}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {tools.map((tool) => {
          const isOpen = tool.id === selectedId;
          const hue = groupHue(tool.group);
          const loved = tool.features.filter((f) => f.verdict === "love").length;
          return (
            <tr
              key={tool.id}
              draggable={rankable && tool.rank !== undefined}
              onDragStart={() => setDragId(tool.id)}
              onDragEnd={reset}
              onDragOver={(e) => {
                if (!dragId) return;
                e.preventDefault();
                setOverId(tool.id);
              }}
              onDrop={(e) => {
                e.preventDefault();
                drop(tool);
              }}
              onClick={() => onSelect(tool.id)}
              className={
                "cursor-pointer border-b border-line-soft transition " +
                (isOpen ? "bg-brand/10" : "hover:bg-panel-2/70") +
                (overId === tool.id && dragId !== tool.id ? " border-t-2 border-t-brand" : "") +
                (dragId === tool.id ? " opacity-40" : "")
              }
            >
              {/* Select */}
              <td className="px-2 py-1.5 align-middle">
                <input
                  type="checkbox"
                  checked={selected.has(tool.id)}
                  onChange={() => onToggleSelect(tool.id)}
                  onClick={(e) => e.stopPropagation()}
                  aria-label={`Select ${tool.name}`}
                  className="accent-[var(--color-brand)]"
                />
              </td>

              {/* Name + summary */}
              <td className="min-w-0 overflow-hidden px-2 py-1.5">
                <div className="flex items-center gap-2">
                  <span
                    className="h-3 w-0.5 shrink-0 rounded"
                    style={{ background: `hsl(${hue} 70% 58%)` }}
                  />
                  <span className="shrink-0 font-medium text-ink">
                    {tool.name}
                  </span>
                  {isNew(tool) && (
                    <span className="shrink-0 rounded bg-brand/20 px-1 font-mono text-[9px] font-bold uppercase text-brand">
                      new
                    </span>
                  )}
                  {/* Next to the name, not in a column of its own: the columns
                      that already exist get hidden on narrow screens, and this
                      is the one fact you want visible on a phone. */}
                  <ContentBadge tool={tool} />
                  {loved > 0 && (
                    <span
                      className="shrink-0 text-[11px] text-emerald-400"
                      title={`${loved} reason${loved === 1 ? "" : "s"} you keep it`}
                    >
                      ★{loved > 1 ? loved : ""}
                    </span>
                  )}
                  {/* On a phone the name and the rank are what matter; the
                      summary is one tap away in the record. */}
                  <span className="hidden min-w-0 truncate text-[12px] text-ink-faint sm:inline">
                    {tool.summary}
                  </span>
                </div>
              </td>

              <td className="hidden px-2 py-1.5 font-mono text-[11px] text-ink-muted md:table-cell">
                <span className="truncate">{tool.category}</span>
              </td>

              <td
                className={
                  "hidden whitespace-nowrap px-2 py-1.5 font-mono text-[11px] sm:table-cell " +
                  (tool.access === "paid"
                    ? "text-rose-300"
                    : tool.access === "free"
                      ? "text-emerald-300"
                      : "text-amber-300")
                }
                title={tool.pricingNote}
              >
                {ACCESS_LABEL[tool.access].toLowerCase()}
              </td>

              <td className="hidden px-2 py-1.5 font-mono text-[11px] lg:table-cell">
                <span className={tool.openSource ? "text-emerald-300" : "text-ink-faint"}>
                  {tool.openSource ? "open" : "closed"}
                </span>
              </td>

              <td className="hidden px-2 py-1.5 font-mono text-[11px] text-ink-muted lg:table-cell">
                {tool.hosting === "hosted" ? "web" : tool.hosting === "both" ? "web+local" : "local"}
              </td>

              {/* Rank — always interactive, in whatever view you're in. The
                  arrows move it within its OWN category, so ranking no longer
                  requires drilling into that section first. */}
              <td className="group/rank whitespace-nowrap px-2 py-1.5 align-middle">
                {tool.rank !== undefined ? (
                  <div className="flex items-center gap-0.5">
                    <span
                      className="font-mono text-[12px] font-semibold tabular-nums"
                      style={{ color: tool.rank === 1 ? `hsl(${hue} 85% 72%)` : undefined }}
                    >
                      #{tool.rank}
                    </span>
                    <span className="flex opacity-0 transition group-hover/rank:opacity-100 focus-within:opacity-100">
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          onMove(tool.id, (tool.rank ?? 1) - 1);
                        }}
                        disabled={tool.rank === 1}
                        aria-label={`Move ${tool.name} up`}
                        className="rounded p-0.5 text-ink-faint transition hover:text-ink disabled:opacity-20"
                      >
                        <Icon.Chevron width={11} height={11} className="-rotate-90" />
                      </button>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          onMove(tool.id, (tool.rank ?? 1) + 1);
                        }}
                        aria-label={`Move ${tool.name} down`}
                        className="rounded p-0.5 text-ink-faint transition hover:text-ink"
                      >
                        <Icon.Chevron width={11} height={11} className="rotate-90" />
                      </button>
                    </span>
                  </div>
                ) : (
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      onRank(tool.id);
                    }}
                    title={`Add ${tool.name} to the ${tool.category} board`}
                    className="inline-flex items-center gap-0.5 font-mono text-[11px] text-ink-faint transition hover:text-brand"
                  >
                    <Icon.Plus width={10} height={10} />
                    rank
                  </button>
                )}
              </td>

              <td className="hidden whitespace-nowrap px-2 py-1.5 font-mono text-[11px] text-ink-faint xl:table-cell">
                {tool.addedAt.slice(0, 10)}
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
