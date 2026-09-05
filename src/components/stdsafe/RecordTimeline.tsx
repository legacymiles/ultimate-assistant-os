"use client";

// ---------------------------------------------------------------------------
// Every record you have added, newest first.
//
// This is the owner's view only. It shows the things a shared view deliberately
// withholds — the note, the attached document, the delete button — because the
// owner is the one person entitled to all of it.
// ---------------------------------------------------------------------------

import { useState } from "react";
import { CONTEXT_LABELS, INFECTIONS, infectionById, type TestRecord } from "@/lib/stdsafe/types";
import { daysSince, formatDay, tierFor, TIER_LABELS } from "@/lib/stdsafe/status";
import { VerificationChip } from "./StatusCard";

const OUTCOME_STYLES: Record<string, string> = {
  negative: "text-emerald-300",
  positive: "text-rose-300",
  indeterminate: "text-amber-300",
};

function ResultPills({ record }: { record: TestRecord }) {
  return (
    <div className="mt-3 flex flex-wrap gap-1.5">
      {record.results.map((result) => (
        <span
          key={result.infection}
          className="rounded border border-line bg-canvas px-2 py-1 text-[11px]"
          title={result.value ? `Read as “${result.value}”` : undefined}
        >
          <span className="text-ink-muted">{infectionById(result.infection).short}</span>{" "}
          <span className={OUTCOME_STYLES[result.outcome] ?? "text-ink"}>
            {result.outcome === "indeterminate" ? "inconclusive" : result.outcome}
          </span>
          {result.outcome === "positive" && result.context && (
            <span className="text-ink-faint"> · {CONTEXT_LABELS[result.context].toLowerCase()}</span>
          )}
        </span>
      ))}
      {record.results.length < INFECTIONS.length && (
        <span className="rounded border border-line/60 px-2 py-1 text-[11px] text-ink-faint">
          {INFECTIONS.length - record.results.length} not covered
        </span>
      )}
    </div>
  );
}

interface Props {
  records: TestRecord[];
  onDelete: (id: string) => void;
  busy: boolean;
}

export function RecordTimeline({ records, onDelete, busy }: Props) {
  const [confirming, setConfirming] = useState<string | null>(null);

  if (!records.length) {
    return (
      <div className="rounded-xl border border-line bg-panel px-5 py-8 text-center">
        <p className="text-[14px] text-ink-muted">No records yet.</p>
        <p className="mt-1 text-[12px] text-ink-faint">
          Add one above and your status card fills in.
        </p>
      </div>
    );
  }

  return (
    <ul className="space-y-3">
      {records.map((record) => {
        const age = daysSince(record.collectedAt);
        const tier = tierFor(age);
        return (
          <li key={record.id} className="rounded-xl border border-line bg-panel px-5 py-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-mono text-[13px] text-ink">{formatDay(record.collectedAt)}</span>
                  <span className="text-[11px] text-ink-faint">{TIER_LABELS[tier].toLowerCase()}</span>
                  <VerificationChip tier={record.verification} />
                </div>
                <p className="mt-1 text-[13px] text-ink-muted">
                  {record.lab}
                  {record.panelName ? ` · ${record.panelName}` : ""}
                  {record.reportedAt ? ` · reported ${formatDay(record.reportedAt)}` : ""}
                </p>
              </div>

              <div className="flex shrink-0 items-center gap-2">
                {record.fileId && (
                  <a
                    href={`/api/std-safe/report?id=${encodeURIComponent(record.fileId)}`}
                    target="_blank"
                    rel="noreferrer"
                    className="rounded-lg border border-line px-3 py-1.5 text-[12px] text-ink-muted transition hover:text-ink"
                  >
                    View document
                  </a>
                )}
                {confirming === record.id ? (
                  <>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => {
                        onDelete(record.id);
                        setConfirming(null);
                      }}
                      className="rounded-lg border border-rose-500/40 bg-rose-500/10 px-3 py-1.5 text-[12px] text-rose-200 disabled:opacity-50"
                    >
                      Delete for good
                    </button>
                    <button
                      type="button"
                      onClick={() => setConfirming(null)}
                      className="px-2 py-1.5 text-[12px] text-ink-faint hover:text-ink-muted"
                    >
                      Cancel
                    </button>
                  </>
                ) : (
                  <button
                    type="button"
                    onClick={() => setConfirming(record.id)}
                    className="rounded-lg border border-line px-3 py-1.5 text-[12px] text-ink-faint transition hover:text-ink-muted"
                  >
                    Delete
                  </button>
                )}
              </div>
            </div>

            <ResultPills record={record} />

            {record.note && <p className="mt-3 text-[12px] italic text-ink-faint">{record.note}</p>}
          </li>
        );
      })}
    </ul>
  );
}
