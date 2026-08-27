"use client";

import type { ClarifyingQuestion } from "@/lib/blueprint/types";
import { Icon } from "../icons";

interface Props {
  questions: ClarifyingQuestion[];
  values: Record<string, string>;
  onChange: (id: string, value: string) => void;
  onBuild: () => void;
  onBack: () => void;
  loading: boolean;
  // Round 2 (adaptive follow-ups + the quality bar)
  round1Count: number;
  deepened: boolean;
  deepening: boolean;
  onDeepen: () => void;
  qualityBar: string;
  onQualityBar: (v: string) => void;
}

export function ClarifyPanel({
  questions,
  values,
  onChange,
  onBuild,
  onBack,
  loading,
  round1Count,
  deepened,
  deepening,
  onDeepen,
  qualityBar,
  onQualityBar,
}: Props) {
  const answered = questions.filter((q) => (values[q.id] ?? "").trim()).length;
  const busy = loading || deepening;

  return (
    <div className="animate-fade-in space-y-4">
      <p className="text-xs text-ink-muted">
        Answer what you can — every question is optional. Anything you skip becomes
        an <span className="text-ink">open question</span> in the overview instead of
        a guess.
      </p>

      <div className="space-y-3">
        {questions.map((q, i) => (
          <div key={q.id}>
            {deepened && i === round1Count && questions.length > round1Count && (
              <div className="mb-3 mt-1 flex items-center gap-2">
                <span className="h-px flex-1 bg-line" />
                <span className="text-[10px] font-semibold uppercase tracking-wider text-brand">
                  Round 2 · going deeper
                </span>
                <span className="h-px flex-1 bg-line" />
              </div>
            )}
            <div className="rounded-xl border border-line bg-panel-2/50 p-3">
              <div className="mb-1.5 flex items-baseline gap-2">
                <span className="text-[11px] font-semibold tabular-nums text-brand">
                  Q{i + 1}
                </span>
                <label className="text-sm font-medium text-ink">{q.question}</label>
              </div>
              {q.hint && <p className="mb-1.5 text-[11px] text-ink-faint">{q.hint}</p>}
              <textarea
                value={values[q.id] ?? ""}
                onChange={(e) => onChange(q.id, e.target.value)}
                rows={2}
                placeholder="Your answer (optional)"
                className="w-full resize-none rounded-lg border border-line bg-canvas px-3 py-2 text-sm text-ink outline-none transition placeholder:text-ink-faint focus:border-brand focus:ring-2 focus:ring-brand/30"
              />
            </div>
          </div>
        ))}
      </div>

      {/* Quality bar — appears once we've gone deeper */}
      {deepened && (
        <div className="rounded-xl border border-brand/30 bg-brand/5 p-3">
          <div className="mb-1.5 flex items-center gap-2">
            <Icon.Sparkles width={13} height={13} className="text-brand" />
            <label className="text-sm font-medium text-ink">Quality bar to beat</label>
          </div>
          <p className="mb-1.5 text-[11px] text-ink-faint">
            A real, fetchable site this should be as good as — or better than. The build
            (and the gauntlet) fight to beat it.
          </p>
          <input
            value={qualityBar}
            onChange={(e) => onQualityBar(e.target.value)}
            placeholder="e.g. linear.app"
            className="w-full rounded-lg border border-line bg-canvas px-3 py-2 text-sm font-medium text-ink outline-none transition placeholder:text-ink-faint focus:border-brand focus:ring-2 focus:ring-brand/30"
          />
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2 pt-1">
        {!deepened && (
          <button
            onClick={onDeepen}
            disabled={busy}
            className="inline-flex items-center gap-2 rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-white transition hover:bg-brand-2 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {deepening ? <Spinner /> : <Icon.Sparkles width={15} height={15} />}
            {deepening ? "Reading your answers…" : "Go deeper (recommended)"}
          </button>
        )}
        <button
          onClick={onBuild}
          disabled={busy}
          className={
            deepened
              ? "inline-flex items-center gap-2 rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-white transition hover:bg-brand-2 disabled:cursor-not-allowed disabled:opacity-40"
              : "inline-flex items-center gap-2 rounded-lg border border-line px-4 py-2 text-sm font-medium text-ink-muted transition hover:bg-panel-2 hover:text-ink disabled:opacity-40"
          }
        >
          {loading ? <Spinner /> : <Icon.Layers width={15} height={15} />}
          {loading ? "Building overview…" : deepened ? "Build the overview" : "Skip — build now"}
        </button>
        <button
          onClick={onBack}
          disabled={busy}
          className="rounded-lg border border-line px-3 py-2 text-sm font-medium text-ink-muted transition hover:bg-panel-2 hover:text-ink disabled:opacity-40"
        >
          Back
        </button>
        <span className="ml-auto text-[11px] text-ink-faint">
          {answered}/{questions.length} answered
        </span>
      </div>
    </div>
  );
}

function Spinner() {
  return (
    <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-white/40 border-t-white" />
  );
}
