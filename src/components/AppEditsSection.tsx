"use client";

// Every change shipped to this app, newest first — recorded from git after
// each commit (scripts/timeline-log.mjs), so nothing has to be typed in by
// hand. Jarvis's Improvements read the same list.

import { useState } from "react";
import type { Project } from "@/lib/types";
import { cn, formatDate } from "@/lib/utils";

const FIRST = 12;

export function AppEditsSection({ project }: { project: Project }) {
  const edits = project.edits ?? [];
  const [all, setAll] = useState(false);
  const [open, setOpen] = useState<string | null>(null);

  if (!edits.length) {
    return project.virtual ? (
      <p className="rounded-2xl border border-dashed border-line px-4 py-5 text-center text-sm text-ink-faint">
        No app edits recorded for this one yet. They appear here by themselves after each change ships.
      </p>
    ) : null;
  }

  const shown = all ? edits : edits.slice(0, FIRST);
  let lastMonth = "";

  return (
    <section className="overflow-hidden rounded-2xl border border-line bg-panel">
      <div className="flex items-center justify-between gap-2 border-b border-line px-4 py-2.5">
        <div>
          <h2 className="text-xs font-semibold uppercase tracking-wide text-ink-faint">App edits</h2>
          <p className="text-[11px] text-ink-faint">
            Recorded automatically from every change shipped{project.virtual ? " · saved as a project the first time you edit it" : ""}
          </p>
        </div>
        <span className="rounded-full bg-canvas px-2 py-0.5 text-[11px] font-semibold text-ink-muted">{edits.length}</span>
      </div>
      <ul>
        {shown.map((e) => {
          const month = e.date.slice(0, 7);
          const header = month !== lastMonth;
          lastMonth = month;
          const isOpen = open === e.id;
          return (
            <li key={e.id}>
              {header && (
                <div className="bg-canvas/60 px-4 py-1 text-[10px] font-semibold uppercase tracking-wider text-ink-faint">
                  {new Date(`${e.date}T12:00:00`).toLocaleDateString(undefined, { month: "long", year: "numeric" })}
                </div>
              )}
              <button
                onClick={() => setOpen(isOpen ? null : e.id)}
                className="grid w-full grid-cols-[52px_10px_1fr] items-start gap-2 border-b border-line/50 px-4 py-2 text-left transition last:border-0 hover:bg-panel-2"
                aria-expanded={isOpen}
              >
                <span className="pt-0.5 text-[11px] tabular-nums text-ink-faint" title={formatDate(`${e.date}T12:00:00`)}>
                  {e.date.slice(5)}
                </span>
                <span
                  className={cn("mt-1.5 h-2 w-2 rounded-full", e.group === "core" ? "bg-core" : "bg-support")}
                  title={e.group === "core" ? "Core: the app was created" : "Supporting: a change to the app"}
                />
                <span className="min-w-0">
                  <span className={cn("block text-sm text-ink", !isOpen && "truncate")}>{e.title}</span>
                  {isOpen && e.detail && <span className="mt-1 block text-xs leading-relaxed text-ink-muted">{e.detail}</span>}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
      {edits.length > FIRST && (
        <button
          onClick={() => setAll(!all)}
          className="w-full border-t border-line px-4 py-2 text-xs font-medium text-ink-muted hover:bg-panel-2 hover:text-ink"
        >
          {all ? "Show fewer" : `Show all ${edits.length} edits`}
        </button>
      )}
    </section>
  );
}
