"use client";

// ---------------------------------------------------------------------------
// The review screen — the gate everything passes through before it is saved.
//
// The parser is good, not trustworthy, so nothing it produced is written until
// someone looks at it here. Two deliberate choices:
//
//   · Every one of the ten infections gets a row, defaulting to "Not tested".
//     A parser that missed a line leaves a visible gap instead of a silent one.
//   · Lines the parser saw but could not read are printed verbatim. "I found
//     the word gonorrhea and no result beside it" is worth showing; swallowing
//     it is how a positive goes missing.
// ---------------------------------------------------------------------------

import { useState } from "react";
import type { ParsedDraft } from "@/lib/stdsafe/parse";
import {
  CONTEXT_LABELS,
  INFECTIONS,
  type InfectionId,
  type Outcome,
  type Result,
  type TreatmentContext,
  type Verification,
} from "@/lib/stdsafe/types";
import type { SaveRecordInput } from "@/lib/stdsafe/client";

type RowState = { outcome: Outcome | "untested"; context?: TreatmentContext; value?: string };

const OUTCOMES: Array<{ id: Outcome | "untested"; label: string; active: string }> = [
  { id: "untested", label: "Not tested", active: "bg-elevated text-ink-muted" },
  { id: "negative", label: "Negative", active: "bg-emerald-500/20 text-emerald-200" },
  { id: "positive", label: "Positive", active: "bg-rose-500/20 text-rose-200" },
  { id: "indeterminate", label: "Inconclusive", active: "bg-amber-500/20 text-amber-200" },
];

interface Props {
  draft: ParsedDraft;
  fileId: string | null;
  fileName: string;
  verification: Verification;
  note: string;
  busy: boolean;
  onSave: (input: SaveRecordInput) => void;
  onCancel: () => void;
}

export function DraftReview({ draft, fileId, fileName, verification, note, busy, onSave, onCancel }: Props) {
  const [lab, setLab] = useState(draft.lab);
  const [panelName, setPanelName] = useState(draft.panelName);
  const [collectedAt, setCollectedAt] = useState(draft.collectedAt);
  const [reportedAt, setReportedAt] = useState(draft.reportedAt ?? "");
  const [comment, setComment] = useState("");
  const [error, setError] = useState("");

  const [rows, setRows] = useState<Record<InfectionId, RowState>>(() => {
    const initial = {} as Record<InfectionId, RowState>;
    for (const infection of INFECTIONS) {
      const hit = draft.results.find((r) => r.infection === infection.id);
      initial[infection.id] = hit
        ? { outcome: hit.outcome, value: hit.value, context: hit.outcome === "positive" ? "untreated" : undefined }
        : { outcome: "untested" };
    }
    return initial;
  });

  function setRow(id: InfectionId, patch: Partial<RowState>) {
    setRows((prev) => ({ ...prev, [id]: { ...prev[id], ...patch } }));
  }

  const testedCount = INFECTIONS.filter((i) => rows[i.id].outcome !== "untested").length;

  function save() {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(collectedAt)) {
      setError("A collection date is required — it is the date the whole record hangs on.");
      return;
    }
    if (!testedCount) {
      setError("Mark at least one test before saving.");
      return;
    }
    const results: Result[] = INFECTIONS.filter((i) => rows[i.id].outcome !== "untested").map((i) => {
      const row = rows[i.id];
      return {
        infection: i.id,
        outcome: row.outcome as Outcome,
        context: row.outcome === "positive" ? (row.context ?? "untreated") : undefined,
        value: row.value,
      };
    });
    onSave({
      collectedAt,
      reportedAt: reportedAt || undefined,
      lab,
      panelName,
      verification,
      fileId: fileId ?? undefined,
      fileName: fileId ? fileName : undefined,
      results,
      note: comment,
    });
  }

  const field =
    "w-full rounded-lg border border-line bg-canvas px-3 py-2 text-sm text-ink outline-none " +
    "placeholder:text-ink-faint focus:border-brand/60 focus:ring-1 focus:ring-brand/30";

  return (
    <div className="rounded-xl border border-line bg-panel">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line-soft px-5 py-4">
        <div>
          <h3 className="text-[15px] font-semibold text-ink">Check this before it is saved</h3>
          <p className="mt-0.5 text-[12px] text-ink-muted">
            {draft.source === "pdf"
              ? "Read from the PDF text."
              : draft.source === "vision"
                ? "Read from the image by a model — worth checking every row."
                : "Nothing was read automatically. Fill it in by hand."}
            {fileId ? ` · ${fileName} saved as the document behind this record.` : " · No file attached."}
          </p>
        </div>
        <span
          className={`rounded border px-2 py-1 text-[11px] font-medium ${
            verification === "document"
              ? "border-support/30 bg-support/10 text-support"
              : "border-line bg-white/[0.03] text-ink-faint"
          }`}
        >
          {verification === "document" ? "LAB DOCUMENT" : "SELF-REPORTED"}
        </span>
      </div>

      {note && (
        <p className="border-b border-line-soft bg-amber-500/[0.06] px-5 py-3 text-[13px] text-amber-200">
          {note}
        </p>
      )}

      {draft.ambiguous.length > 0 && (
        <div className="border-b border-line-soft bg-white/[0.015] px-5 py-3">
          <p className="text-[12px] font-medium text-amber-200">
            These lines named a test but had no result we could read. Check them against the report:
          </p>
          <ul className="mt-2 space-y-1">
            {draft.ambiguous.map((line, i) => (
              <li key={i} className="truncate font-mono text-[11px] text-ink-faint">
                {line}
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="grid gap-4 border-b border-line-soft px-5 py-4 sm:grid-cols-2 lg:grid-cols-4">
        <div>
          <label className="mb-1.5 block text-[12px] font-medium text-ink-muted">
            Collected <span className="text-rose-300">*</span>
          </label>
          <input type="date" className={field} value={collectedAt} onChange={(e) => setCollectedAt(e.target.value)} />
          <p className="mt-1 text-[11px] text-ink-faint">The date the sample was taken.</p>
        </div>
        <div>
          <label className="mb-1.5 block text-[12px] font-medium text-ink-muted">Reported</label>
          <input type="date" className={field} value={reportedAt} onChange={(e) => setReportedAt(e.target.value)} />
          <p className="mt-1 text-[11px] text-ink-faint">Shown, but never used for freshness.</p>
        </div>
        <div>
          <label className="mb-1.5 block text-[12px] font-medium text-ink-muted">Lab</label>
          <input className={field} value={lab} onChange={(e) => setLab(e.target.value)} placeholder="Quest Diagnostics" />
        </div>
        <div>
          <label className="mb-1.5 block text-[12px] font-medium text-ink-muted">Panel</label>
          <input
            className={field}
            value={panelName}
            onChange={(e) => setPanelName(e.target.value)}
            placeholder="10-Test Panel"
          />
        </div>
      </div>

      <ul className="divide-y divide-line-soft">
        {INFECTIONS.map((infection) => {
          const row = rows[infection.id];
          return (
            <li key={infection.id} className="px-5 py-3">
              <div className="flex flex-wrap items-center gap-3">
                <span
                  className={`min-w-0 flex-1 truncate text-[13px] ${
                    row.outcome === "untested" ? "text-ink-faint" : "text-ink"
                  }`}
                >
                  {infection.label}
                  {row.value && (
                    <span className="ml-2 font-mono text-[11px] text-ink-faint">read as “{row.value}”</span>
                  )}
                </span>

                <div className="flex rounded-lg border border-line bg-canvas p-0.5">
                  {OUTCOMES.map((option) => (
                    <button
                      key={option.id}
                      type="button"
                      onClick={() =>
                        setRow(infection.id, {
                          outcome: option.id,
                          context: option.id === "positive" ? (row.context ?? "untreated") : undefined,
                        })
                      }
                      className={`rounded-md px-2.5 py-1 text-[12px] transition ${
                        row.outcome === option.id ? option.active : "text-ink-faint hover:text-ink-muted"
                      }`}
                    >
                      {option.label}
                    </button>
                  ))}
                </div>
              </div>

              {row.outcome === "positive" && (
                <div className="mt-2 flex flex-wrap items-center gap-2 pl-0 sm:pl-1">
                  <span className="text-[12px] text-ink-muted">Treatment status</span>
                  <select
                    className="rounded-lg border border-line bg-canvas px-2 py-1 text-[12px] text-ink outline-none focus:border-brand/60"
                    value={row.context ?? "untreated"}
                    onChange={(e) => setRow(infection.id, { context: e.target.value as TreatmentContext })}
                  >
                    {(Object.keys(CONTEXT_LABELS) as TreatmentContext[]).map((c) => (
                      <option key={c} value={c}>
                        {CONTEXT_LABELS[c]}
                      </option>
                    ))}
                  </select>
                  <span className="text-[11px] text-ink-faint">
                    Shown beside the result — a managed positive is not the same thing as an untreated one.
                  </span>
                </div>
              )}
            </li>
          );
        })}
      </ul>

      <div className="border-t border-line-soft px-5 py-4">
        <label className="mb-1.5 block text-[12px] font-medium text-ink-muted">
          Note <span className="text-ink-faint">— for you only, never shared</span>
        </label>
        <input
          className={field}
          value={comment}
          onChange={(e) => setComment(e.target.value)}
          placeholder="clinic, reason for testing, anything worth remembering"
        />
      </div>

      {error && <p className="px-5 pb-3 text-[13px] text-rose-300">{error}</p>}

      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line-soft px-5 py-4">
        <p className="text-[12px] text-ink-faint">
          {testedCount} of {INFECTIONS.length} marked as tested. The rest will show as not covered.
        </p>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="rounded-lg border border-line px-4 py-2 text-[13px] text-ink-muted transition hover:text-ink"
          >
            Discard
          </button>
          <button
            type="button"
            onClick={save}
            disabled={busy}
            className="rounded-lg bg-brand px-4 py-2 text-[13px] font-medium text-white transition hover:bg-brand-2 disabled:opacity-50"
          >
            {busy ? "Saving…" : "Save record"}
          </button>
        </div>
      </div>
    </div>
  );
}
