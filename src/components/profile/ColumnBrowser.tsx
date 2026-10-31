"use client";

import { useCallback, useEffect, useMemo, useRef } from "react";
import { Icon } from "../icons";
import { childrenOf, countFilled, roots } from "@/lib/profile/model";
import type { Node } from "@/lib/profile/types";

/**
 * The column browser — Profile's one real mechanic.
 *
 * Not a card grid: a column view. Clicking a folder slides the next column in,
 * so the trail of columns IS the breadcrumb and the whole depth of the tree is
 * visible at once. Fully keyboard-driven (↑↓ within a column, → to descend,
 * ← to come back), which is the difference between a browser the owner uses
 * daily and one they click through.
 *
 * It also renders the provenance state: while a line of About Me is hovered the
 * whole thing dims and only the folders that line came from stay lit.
 */

interface Props {
  nodes: Node[];
  /** One selected node id per level, root first. */
  trail: string[];
  onTrail: (trail: string[]) => void;
  /** Node ids lit by a provenance hover. Empty = not tracing. */
  lit?: string[];
  onAdd: (parentId: string | null) => void;
  /** The deepest selected node's record view, rendered as the last column. */
  record?: React.ReactNode;
}

export function ColumnBrowser({ nodes, trail, onTrail, lit = [], onAdd, record }: Props) {
  const wrap = useRef<HTMLDivElement>(null);
  const litSet = useMemo(() => new Set(lit), [lit]);

  /** Column L lists the children of trail[L-1]; column 0 lists the roots. */
  const columns = useMemo(() => {
    const out: { parentId: string | null; items: Node[] }[] = [{ parentId: null, items: roots(nodes) }];
    for (const id of trail) {
      const items = childrenOf(nodes, id);
      if (!items.length) break;
      out.push({ parentId: id, items });
    }
    return out;
  }, [nodes, trail]);

  const select = useCallback(
    (level: number, id: string) => onTrail([...trail.slice(0, level), id]),
    [onTrail, trail],
  );

  /** Move DOM focus, so the keyboard path is the same path a screen reader takes. */
  const focusRow = useCallback((level: number, index: number) => {
    const el = wrap.current?.querySelector<HTMLButtonElement>(`[data-level="${level}"][data-index="${index}"]`);
    el?.focus();
    el?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, []);

  // Keep the newest column in view when the trail deepens.
  useEffect(() => {
    const el = wrap.current;
    if (el) el.scrollLeft = el.scrollWidth;
  }, [trail.length]);

  /**
   * `last` is the index of the Add row, so arrow keys reach it like any other
   * row — adding a folder is part of browsing, not a separate mode.
   */
  const onKey = (e: React.KeyboardEvent, level: number, index: number, items: Node[]) => {
    const keys = ["ArrowDown", "ArrowUp", "ArrowRight", "ArrowLeft", "Home", "End"];
    if (!keys.includes(e.key)) return;
    e.preventDefault();
    const last = items.length;

    if (e.key === "ArrowDown") return focusRow(level, Math.min(index + 1, last));
    if (e.key === "ArrowUp") return focusRow(level, Math.max(index - 1, 0));
    if (e.key === "Home") return focusRow(level, 0);
    if (e.key === "End") return focusRow(level, last);

    if (e.key === "ArrowRight") {
      const node = items[index];
      if (!node) return;
      // Descending has to select first, or the next column would not exist yet.
      select(level, node.id);
      if (childrenOf(nodes, node.id).length) {
        requestAnimationFrame(() => focusRow(level + 1, 0));
      }
      return;
    }

    if (e.key === "ArrowLeft" && level > 0) {
      const parent = columns[level].parentId;
      const back = columns[level - 1].items.findIndex((n) => n.id === parent);
      onTrail(trail.slice(0, level));
      requestAnimationFrame(() => focusRow(level - 1, Math.max(back, 0)));
    }
  };

  return (
    <div ref={wrap} className="pf-cols min-h-[20rem]" data-tracing={lit.length > 0} role="tree" aria-label="Profile folders">
      {columns.map((col, level) => (
        <div key={col.parentId ?? "root"} className="pf-col" role="group">
          {col.items.map((n, index) => {
            const kids = childrenOf(nodes, n.id).length;
            const filled = countFilled(n);
            return (
              <button
                key={n.id}
                type="button"
                className="pf-row"
                data-level={level}
                data-index={index}
                data-lit={litSet.has(n.id)}
                aria-current={trail[level] === n.id}
                onClick={() => select(level, n.id)}
                onKeyDown={(e) => onKey(e, level, index, col.items)}
              >
                <Icon.Folder width={13} height={13} className="shrink-0 opacity-70" />
                <span className="truncate">{n.name}</span>
                {/* Counts are the density: you can see which folders have anything in them. */}
                <span className="pf-row__count">
                  {filled > 0 && filled}
                  {kids > 0 && <span className="opacity-60">{filled > 0 ? " · " : ""}{kids}›</span>}
                </span>
              </button>
            );
          })}

          <button
            type="button"
            onClick={() => onAdd(col.parentId)}
            className="pf-row text-ink-faint hover:text-ink"
            data-level={level}
            data-index={col.items.length}
            onKeyDown={(e) => onKey(e, level, col.items.length, col.items)}
          >
            <Icon.Plus width={13} height={13} className="shrink-0" />
            <span className="truncate">Add</span>
          </button>
        </div>
      ))}

      {record ? <div className="pf-col pf-col--record">{record}</div> : null}
    </div>
  );
}
