"use client";

import { useMemo, useState } from "react";
import { Icon } from "../icons";
import { aboutLines } from "@/lib/profile/about";
import type { AboutDoc, Node } from "@/lib/profile/types";

/**
 * About Me — the derived briefing, and the surprise moment.
 *
 * Hovering a line dims the column browser and lights the folders that line was
 * built from; clicking jumps there. That is what makes a generated document
 * auditable: you can point at a sentence and see where it came from.
 *
 * The owner edits it in two ways only — pin a line (kept across every rebuild)
 * or veto one (never re-added). A generated document you can freely overwrite
 * is one nobody trusts; one you cannot correct is one nobody keeps.
 */

interface Props {
  doc: AboutDoc;
  nodes: Node[];
  busy: boolean;
  note: string;
  onRebuild: () => void;
  onTrace: (nodeIds: string[]) => void;
  onJump: (nodeId: string) => void;
  onPin: (line: string) => void;
  onVeto: (line: string) => void;
}

export function AboutMe({ doc, nodes, busy, note, onRebuild, onTrace, onJump, onPin, onVeto }: Props) {
  const [open, setOpen] = useState(true);
  const lines = useMemo(() => aboutLines(doc), [doc]);
  const pinned = useMemo(() => new Set(doc.pinned.map((p) => p.trim())), [doc.pinned]);

  const when = doc.builtAt
    ? new Date(doc.builtAt).toLocaleDateString(undefined, { month: "short", day: "numeric" })
    : "";

  return (
    <section className="border-b border-line bg-panel">
      <div className="flex flex-wrap items-center gap-2 px-3 py-2">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="flex items-center gap-1.5 text-xs font-semibold text-ink"
          aria-expanded={open}
        >
          <Icon.Chevron
            width={13}
            height={13}
            className={`transition-transform ${open ? "rotate-90" : ""}`}
            style={{ transitionDuration: "150ms" }}
          />
          About me
        </button>
        <span className="font-mono text-[10px] text-ink-faint">
          {doc.builtAt ? `rebuilt from ${doc.fromCount} folders · ${when}` : "not built yet"}
        </span>
        <button
          type="button"
          onClick={onRebuild}
          disabled={busy}
          className="ml-auto inline-flex items-center gap-1 rounded-lg border border-line px-2 py-1 text-[11px] font-medium text-ink-muted transition hover:bg-panel-2 hover:text-ink disabled:opacity-50"
        >
          <Icon.Refresh width={11} height={11} className={busy ? "animate-spin" : ""} />
          {busy ? "Reading your folders…" : "Rebuild"}
        </button>
      </div>

      {open && (
        <div className="px-3 pb-3" onMouseLeave={() => onTrace([])}>
          {note && <p className="mb-2 rounded border border-line bg-panel-2 px-2 py-1.5 text-[11px] text-ink-muted">{note}</p>}

          {!lines.length ? (
            <p className="py-2 text-xs text-ink-faint">
              Nothing to brief on yet. Add a few facts below, or drop in a resume, and this writes itself.
            </p>
          ) : (
            <div className="space-y-0.5 text-xs leading-relaxed">
              {lines.map((line, i) => {
                const text = line.text;
                if (!text.trim()) return <div key={i} className="h-1.5" />;

                const heading = text.startsWith("#");
                const cited = line.sources.length > 0;
                const isPinned = pinned.has(text.trim());

                if (heading) {
                  const level = text.match(/^#+/)?.[0].length ?? 1;
                  return (
                    <div
                      key={i}
                      className={
                        level === 1
                          ? "pt-1 text-sm font-semibold text-ink"
                          : "pt-2 text-[10px] font-semibold uppercase tracking-wider text-ink-faint"
                      }
                    >
                      {text.replace(/^#+\s*/, "")}
                    </div>
                  );
                }

                return (
                  <div key={i} className="group flex items-start gap-1.5">
                    <div
                      className="pf-line flex-1 text-ink-muted"
                      data-cited={cited}
                      data-fact="true"
                      onMouseEnter={() => cited && onTrace(line.sources)}
                      onClick={() => cited && onJump(line.sources[0])}
                      role={cited ? "button" : undefined}
                      tabIndex={cited ? 0 : undefined}
                      onKeyDown={(e) => {
                        if (cited && (e.key === "Enter" || e.key === " ")) {
                          e.preventDefault();
                          onJump(line.sources[0]);
                        }
                      }}
                      onFocus={() => cited && onTrace(line.sources)}
                      title={cited ? `From ${line.sources.length} folder${line.sources.length === 1 ? "" : "s"} — click to open` : "Nobody can trace this line"}
                    >
                      {stripMd(text)}
                      {isPinned && <Icon.Star width={9} height={9} className="ml-1 inline text-brand" />}
                    </div>

                    <span className="flex shrink-0 gap-0.5 opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100">
                      <button
                        type="button"
                        onClick={() => onPin(text)}
                        className="rounded p-0.5 text-ink-faint hover:text-ink"
                        title={isPinned ? "Unpin" : "Pin — keep this line through every rebuild"}
                      >
                        <Icon.Star width={11} height={11} />
                      </button>
                      <button
                        type="button"
                        onClick={() => onVeto(text)}
                        className="rounded p-0.5 text-ink-faint hover:text-ink"
                        title="Veto — never write this again"
                      >
                        <Icon.Close width={11} height={11} />
                      </button>
                    </span>
                  </div>
                );
              })}
            </div>
          )}

          {doc.vetoed.length > 0 && (
            <p className="mt-2 font-mono text-[10px] text-ink-faint">
              {doc.vetoed.length} line{doc.vetoed.length === 1 ? "" : "s"} vetoed and never re-added.
            </p>
          )}
        </div>
      )}
    </section>
  );
}

/** The briefing is markdown, but it is read here as prose — keep the words, drop the syntax. */
function stripMd(s: string): string {
  return s.replace(/\*\*(.+?)\*\*/g, "$1").replace(/_(.+?)_/g, "$1").replace(/^[-*]\s+/, "");
}
