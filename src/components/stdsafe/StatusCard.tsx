"use client";

// ---------------------------------------------------------------------------
// The status card — the one thing this app exists to render.
//
// The same component draws all three views: your own dashboard, the preview you
// see before approving someone, and what they finally see. If the preview were
// a different component it could promise something the shared page did not
// show, which is the one bug this app really cannot have.
//
// Three rules the layout enforces:
//   1. Untested infections are rendered, greyed, never omitted. A missing row
//      would read as a negative one.
//   2. The coverage count sits inside the headline, not beside it.
//   3. Every row carries its own date and its own age, because a panel is not
//      one event.
// ---------------------------------------------------------------------------

import type { DerivedStatus, FreshnessTier, InfectionStatus } from "@/lib/stdsafe/status";
import { STANDING_CAVEATS, TIER_LABELS, TIER_NOTES, formatDay } from "@/lib/stdsafe/status";
import { CONTEXT_LABELS, CONTEXT_NOTES, infectionById } from "@/lib/stdsafe/types";

const TIER_STYLES: Record<FreshnessTier, string> = {
  fresh: "bg-emerald-500/12 text-emerald-300 border-emerald-500/30",
  aging: "bg-amber-500/12 text-amber-300 border-amber-500/30",
  stale: "bg-rose-500/12 text-rose-300 border-rose-500/30",
};

/**
 * A managed positive is not the same alarm as an untreated one — an
 * undetectable viral load is not transmissible — so it reads amber, not red.
 */
function rowTone(row: InfectionStatus): { dot: string; text: string; label: string } {
  if (!row.tested) return { dot: "bg-white/15", text: "text-ink-faint", label: "Not tested" };
  if (row.outcome === "positive") {
    const managed = row.context && row.context !== "untreated";
    return managed
      ? { dot: "bg-amber-400", text: "text-amber-300", label: "Positive" }
      : { dot: "bg-rose-500", text: "text-rose-300", label: "Positive" };
  }
  if (row.outcome === "indeterminate") {
    return { dot: "bg-amber-400", text: "text-amber-300", label: "Inconclusive" };
  }
  return { dot: "bg-emerald-400", text: "text-emerald-300", label: "Negative" };
}

function ageLabel(row: InfectionStatus): string {
  if (row.ageDays === undefined) return "";
  if (row.ageDays === 0) return "today";
  if (row.ageDays === 1) return "1 day ago";
  if (row.ageDays < 45) return `${row.ageDays} days ago`;
  const months = Math.round(row.ageDays / 30);
  return months < 24 ? `${months} months ago` : `${Math.floor(months / 12)} years ago`;
}

export function VerificationChip({ tier }: { tier?: "document" | "self" }) {
  if (!tier) return null;
  return tier === "document" ? (
    <span
      className="rounded border border-support/30 bg-support/10 px-1.5 py-0.5 text-[10px] font-medium tracking-wide text-support"
      title="A lab report file is on file for this result."
    >
      LAB DOC
    </span>
  ) : (
    <span
      className="rounded border border-line bg-white/[0.03] px-1.5 py-0.5 text-[10px] font-medium tracking-wide text-ink-faint"
      title="Typed in by hand. Nothing backs this up."
    >
      SELF
    </span>
  );
}

function Headline({ status }: { status: DerivedStatus }) {
  const { verdict, tier } = status;
  const tone =
    verdict === "positive"
      ? "text-amber-200"
      : verdict === "indeterminate"
        ? "text-amber-200"
        : verdict === "no-records"
          ? "text-ink-faint"
          : "text-emerald-200";

  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
      <h3 className={`text-[22px] font-semibold leading-tight tracking-tight ${tone}`}>{status.headline}</h3>
      {tier && (
        <span
          className={`rounded-full border px-2 py-0.5 text-[11px] font-medium ${TIER_STYLES[tier]}`}
          title={TIER_NOTES[tier]}
        >
          {TIER_LABELS[tier]}
        </span>
      )}
    </div>
  );
}

interface Props {
  status: DerivedStatus;
  /** Whose card this is. Omit on your own. */
  name?: string;
  /** Hide the caveats when the surrounding page already carries them. */
  showCaveats?: boolean;
  compact?: boolean;
}

export function StatusCard({ status, name, showCaveats = true, compact = false }: Props) {
  return (
    <div className="rounded-xl border border-line bg-panel">
      <div className="border-b border-line-soft px-5 py-4">
        {name && <p className="mb-1 text-xs uppercase tracking-widest text-ink-faint">{name}</p>}
        <Headline status={status} />
        {status.newestCollectedAt ? (
          <p className="mt-2 text-sm text-ink-muted">
            Most recent sample {formatDay(status.newestCollectedAt)}
            {status.oldestCollectedAt && status.oldestCollectedAt !== status.newestCollectedAt && (
              <> · oldest still counted {formatDay(status.oldestCollectedAt)}</>
            )}
          </p>
        ) : (
          <p className="mt-2 text-sm text-ink-muted">Nothing has been added yet.</p>
        )}
      </div>

      <ul className="divide-y divide-line-soft">
        {status.rows.map((row) => {
          const infection = infectionById(row.infection);
          const tone = rowTone(row);
          return (
            <li
              key={row.infection}
              className={`flex items-center gap-3 px-5 ${compact ? "py-2" : "py-2.5"} ${
                row.tested ? "" : "opacity-55"
              }`}
            >
              <span className={`h-2 w-2 shrink-0 rounded-full ${tone.dot}`} aria-hidden />
              <span className="min-w-0 flex-1 truncate text-[13px] text-ink">{infection.label}</span>

              <span className={`shrink-0 text-[13px] font-medium ${tone.text}`}>{tone.label}</span>

              {row.context && row.outcome === "positive" && (
                <span
                  className="hidden shrink-0 rounded border border-amber-500/25 bg-amber-500/10 px-1.5 py-0.5 text-[10px] text-amber-200 sm:inline"
                  title={CONTEXT_NOTES[row.context]}
                >
                  {CONTEXT_LABELS[row.context]}
                </span>
              )}

              <span className="hidden w-40 shrink-0 text-right font-mono text-[11px] text-ink-faint sm:block">
                {row.collectedAt ? `${formatDay(row.collectedAt)} · ${ageLabel(row)}` : "—"}
              </span>

              <span className="hidden w-20 shrink-0 text-right sm:block">
                <VerificationChip tier={row.verification} />
              </span>
            </li>
          );
        })}
      </ul>

      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-line-soft px-5 py-3 text-[11px] text-ink-faint">
        <span>
          {status.testedCount} of {status.totalCount} tested
        </span>
        {status.untested.length > 0 && (
          <span>
            Not covered: {status.untested.map((r) => infectionById(r.infection).short).join(", ")}
          </span>
        )}
        <span>
          {status.allDocument
            ? "Every result backed by a lab document"
            : status.anyDocument
              ? "Some results backed by a lab document"
              : status.testedCount > 0
                ? "Self-reported — no documents on file"
                : ""}
        </span>
      </div>

      {showCaveats && (
        <div className="border-t border-line-soft bg-white/[0.015] px-5 py-3">
          <p className="mb-1.5 text-[11px] font-medium uppercase tracking-widest text-ink-faint">
            What this does not tell you
          </p>
          <ul className="space-y-1">
            {STANDING_CAVEATS.map((caveat) => (
              <li key={caveat} className="flex gap-2 text-[12px] leading-snug text-ink-muted">
                <span className="text-ink-faint">·</span>
                <span>{caveat}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
