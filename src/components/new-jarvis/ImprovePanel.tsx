"use client";

// ---------------------------------------------------------------------------
// Jarvis's own ideas about Jarvis.
//
// Three things this panel must never do, because each of them is how a
// suggestions surface dies:
//
//   1. Fill itself with plausible generic advice. Every row carries the facts
//      that produced it, and an auditor with nothing to point at files nothing.
//   2. Apply anything. Approving writes a spec for a build session; it does not
//      touch code, data or UI. That was the owner's explicit choice.
//   3. Raise the same thing twice. Ids are built from the facts, so dismiss
//      means dismissed and snooze means a date.
// ---------------------------------------------------------------------------

import { useState } from "react";
import { Icon } from "../icons";
import type { Collected, Proposal, Risk } from "@/lib/new-jarvis/improve";

interface Props {
  collected: Collected;
  summary: string;
  approved: string[];
  onApprove: (p: Proposal) => void;
  onSnooze: (p: Proposal) => void;
  onDismiss: (p: Proposal) => void;
  /** Null while the audit has not run; a sentence when it cannot. */
  unavailable?: string | null;
}

/**
 * Risk, as a word rather than a colour-coded badge.
 *
 * A row of red pills trains the eye to skip them. The ordering already puts
 * the worst first, so the label only has to be honest, not loud — and only
 * `high` earns any colour at all.
 */
const RISK_LABEL: Record<Risk, string> = {
  high: "Worth doing now",
  medium: "Worth deciding",
  low: "Minor",
  none: "Housekeeping",
};

export function ImprovePanel({ collected, summary, approved, onApprove, onSnooze, onDismiss, unavailable }: Props) {
  const [open, setOpen] = useState<string | null>(collected.proposals[0]?.id ?? null);

  return (
    <div className="space-y-2.5">
      <header className="flex items-baseline justify-between gap-2">
        <div>
          <h2 className="text-[11px] uppercase tracking-[0.14em] text-ink-faint">Improvements</h2>
          <p className="mt-0.5 text-[11px] text-ink-muted">{unavailable ?? summary}</p>
        </div>
        {collected.proposals.length > 0 && (
          <span className="shrink-0 rounded-full border border-line px-1.5 py-0.5 font-mono text-[10px] text-ink-muted" data-num>
            {collected.proposals.length}
          </span>
        )}
      </header>

      {collected.proposals.length === 0 ? (
        <p className="rounded-md border border-line-soft bg-panel px-2.5 py-2 text-[11px] leading-relaxed text-ink-faint">
          {unavailable
            ? "It will have a look once it can read the things it audits."
            : collected.hidden > 0
              ? "Nothing new. What is here was dismissed or snoozed."
              : "It looked and found nothing worth raising. That is the honest answer, not an empty state."}
        </p>
      ) : (
        <ul className="space-y-1.5">
          {collected.proposals.map((p) => {
            const isOpen = open === p.id;
            const isApproved = approved.includes(p.id);
            return (
              <li key={p.id} className="rounded-md border border-line-soft bg-panel">
                <button
                  type="button"
                  onClick={() => setOpen(isOpen ? null : p.id)}
                  aria-expanded={isOpen}
                  className="flex w-full items-start gap-2 px-2.5 py-2 text-left"
                >
                  <Icon.Chevron
                    width={10}
                    height={10}
                    className={`mt-1 shrink-0 text-ink-faint transition-transform ${isOpen ? "rotate-90" : ""}`}
                    aria-hidden
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block text-[12px] font-medium leading-snug text-ink">{p.title}</span>
                    <span className="mt-0.5 flex items-center gap-1.5 text-[10px] text-ink-faint">
                      <span className={p.risk === "high" ? "text-amber-300" : ""}>{RISK_LABEL[p.risk]}</span>
                      <span aria-hidden>·</span>
                      <span>{p.effort}</span>
                      {isApproved && (
                        <>
                          <span aria-hidden>·</span>
                          <span className="text-core">spec written</span>
                        </>
                      )}
                    </span>
                  </span>
                </button>

                {isOpen && (
                  <div className="space-y-2.5 border-t border-line-soft px-2.5 py-2.5">
                    <p className="text-[11.5px] leading-relaxed text-ink-muted">{p.why}</p>

                    <div>
                      <h4 className="text-[9.5px] uppercase tracking-[0.12em] text-ink-faint">What would change</h4>
                      <p className="mt-0.5 text-[11.5px] leading-relaxed text-ink">{p.how}</p>
                    </div>

                    <div>
                      <h4 className="text-[9.5px] uppercase tracking-[0.12em] text-ink-faint">What it saw</h4>
                      <ul className="mt-0.5 space-y-0.5">
                        {p.evidence.map((e, i) => (
                          <li key={i} className="font-mono text-[10px] leading-relaxed text-ink-muted">
                            {e}
                          </li>
                        ))}
                      </ul>
                    </div>

                    <div className="flex flex-wrap items-center gap-1.5 pt-0.5">
                      <button
                        type="button"
                        onClick={() => onApprove(p)}
                        disabled={isApproved}
                        className="rounded border border-line bg-panel-2 px-2 py-1 text-[10.5px] text-ink transition hover:border-ink-faint hover:bg-elevated disabled:opacity-50"
                      >
                        {isApproved ? "Spec written" : "Write the spec"}
                      </button>
                      <button
                        type="button"
                        onClick={() => onSnooze(p)}
                        className="rounded border border-line px-2 py-1 text-[10.5px] text-ink-muted transition hover:bg-panel-2 hover:text-ink"
                      >
                        Not now
                      </button>
                      <button
                        type="button"
                        onClick={() => onDismiss(p)}
                        className="rounded px-2 py-1 text-[10.5px] text-ink-faint transition hover:text-ink"
                      >
                        Never
                      </button>
                      <span className="ml-auto text-[9.5px] text-ink-faint">Approving writes a spec. Nothing changes on its own.</span>
                    </div>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
