"use client";

import { useState } from "react";
import { Icon } from "../icons";
import { pathOf } from "@/lib/profile/model";
import type { ConfirmItem, Node } from "@/lib/profile/types";

/**
 * The confirm queue — a real band in the UI, not a line buried in chat.
 *
 * This is the video's A$950-vs-A$1,200 moment generalised: when the profile
 * holds two answers to one question, the AI must ask rather than pick. A life
 * profile produces these constantly — an old address, a replaced card, a job
 * you left, a registration that lapsed.
 *
 * Amber is the only warm colour in this app, used nowhere else, so the one
 * thing that needs the owner is the one thing that is not grey.
 */

interface Props {
  items: ConfirmItem[];
  nodes: Node[];
  onConfirm: (nodeId: string, fieldId: string, value?: string) => void;
  onJump: (nodeId: string) => void;
}

export function ConfirmQueue({ items, nodes, onConfirm, onJump }: Props) {
  const [open, setOpen] = useState(false);
  if (!items.length) return null;

  const conflicts = items.filter((i) => i.kind === "conflict").length;

  return (
    <section className="border-b border-line bg-amber-500/[0.07]">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-2 px-3 py-2 text-left"
        aria-expanded={open}
      >
        <Icon.Bell width={13} height={13} className="shrink-0 text-amber-400" />
        <span className="text-xs font-semibold text-ink">
          {items.length} thing{items.length === 1 ? "" : "s"} to confirm
        </span>
        {conflicts > 0 && (
          <span className="rounded bg-amber-500/20 px-1.5 py-0.5 font-mono text-[10px] text-amber-300">
            {conflicts} conflict{conflicts === 1 ? "" : "s"}
          </span>
        )}
        <Icon.Chevron
          width={12}
          height={12}
          className={`ml-auto shrink-0 text-ink-faint transition-transform ${open ? "rotate-90" : ""}`}
        />
      </button>

      {open && (
        <div className="max-h-72 divide-y divide-line overflow-y-auto border-t border-line">
          {items.map((item) => (
            <div key={item.id} className="px-3 py-2">
              <div className="flex items-start gap-2">
                <span className="mt-0.5 shrink-0 font-mono text-[9px] uppercase text-ink-faint">{item.kind}</span>
                <div className="min-w-0 flex-1">
                  <p className="text-xs text-ink">{item.question}</p>
                  <button
                    type="button"
                    onClick={() => onJump(item.nodeId)}
                    className="mt-0.5 truncate font-mono text-[10px] text-ink-faint hover:text-accent"
                  >
                    {pathOf(nodes, item.nodeId)}
                  </button>

                  <div className="mt-1.5 flex flex-wrap gap-1">
                    {item.kind === "conflict" ? (
                      (item.options ?? []).map((opt) => (
                        <button
                          key={opt}
                          type="button"
                          onClick={() => item.fieldId && onConfirm(item.nodeId, item.fieldId, opt)}
                          className="rounded border border-line bg-panel px-2 py-0.5 font-mono text-[11px] text-ink transition hover:border-amber-400/60"
                        >
                          {opt}
                        </button>
                      ))
                    ) : (
                      <button
                        type="button"
                        onClick={() => item.fieldId && onConfirm(item.nodeId, item.fieldId)}
                        className="inline-flex items-center gap-1 rounded border border-line bg-panel px-2 py-0.5 text-[11px] font-medium text-ink transition hover:border-amber-400/60"
                      >
                        <Icon.Check width={10} height={10} /> {item.kind === "stale" ? "Still right" : "Correct"}
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => onJump(item.nodeId)}
                      className="rounded border border-line px-2 py-0.5 text-[11px] text-ink-muted transition hover:text-ink"
                    >
                      Fix it myself
                    </button>
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
