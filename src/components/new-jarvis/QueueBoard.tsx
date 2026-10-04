"use client";

// ---------------------------------------------------------------------------
// In Queue — everything the owner has built, and whether it is finished.
//
// A ledger, not a card grid. Two hundred and fifty rows of apps, workflows and
// skills is a dataset, and the only layout that lets you scan a dataset is a
// table: one line per thing, the state in a fixed column so the eye can run
// down it, and the numbers in mono so they line up.
//
// The interaction that makes it a queue rather than a report:
//
//   The pip IS the control. Clicking it is the owner's verdict, it persists
//   and syncs, and it outranks the derivation — which is the point, because
//   the derivation is a guess from evidence and the owner was there. Clicking
//   the pip back to where the guess already was clears the override, so the
//   row returns to tracking the evidence instead of being frozen by an old
//   opinion.
//
//   Every row can say WHY. The guess never asserts without showing the
//   evidence it was made from, because an unexplained amber is just an
//   accusation.
//
//   "Queue only" is one tap and collapses the board to the amber — which is
//   the actual to-do list, and the reason the thing exists.
// ---------------------------------------------------------------------------

import { useCallback, useMemo, useState } from "react";
import Link from "next/link";
import { Icon } from "../icons";
import { KIND_LABEL, type QueueKind, type QueueRow, type QueueState } from "@/lib/new-jarvis/queue";
import type { UseQueue } from "@/lib/new-jarvis/useQueue";

const KINDS: QueueKind[] = ["app", "skill", "workflow"];

const KIND_ICON: Record<QueueKind, keyof typeof Icon> = {
  app: "Launch",
  skill: "Sparkles",
  workflow: "Film",
};

export function QueueBoard({ queue }: { queue: UseQueue }) {
  const { rows, counts, filter, setFilter, loading, error } = queue;
  const [open, setOpen] = useState<string | null>(null);

  const toggleKind = useCallback(
    (k: QueueKind) =>
      setFilter((f) => ({
        ...f,
        kinds: f.kinds.includes(k) ? f.kinds.filter((x) => x !== k) : [...f.kinds, k],
      })),
    [setFilter],
  );

  const queueOnly = filter.states.length === 1 && filter.states[0] === "wip";

  // The rows are already sorted amber-first then by kind, so a heading can be
  // emitted whenever the (state, kind) pair changes. Computing the boundaries
  // here keeps the render a flat map rather than nested groups, which is what
  // lets one scroll container hold all 250 rows.
  const headed = useMemo(() => {
    let last = "";
    return rows.map((row) => {
      const key = `${row.state}/${row.kind}`;
      const head = key === last ? null : key;
      last = key;
      return { row, head };
    });
  }, [rows]);

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* --- the readout: three numbers that are the whole point ----------- */}
      <div className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-1.5 border-b border-line bg-panel px-3 py-2">
        <h2 className="text-[11px] font-semibold uppercase tracking-wide text-ink">In Queue</h2>
        <Tally state="wip" n={counts.wip} label="unfinished" />
        <Tally state="done" n={counts.done} label="finished" />
        <span className="font-mono text-[10px] text-ink-faint" data-num>
          of {counts.total}
        </span>

        <button
          type="button"
          onClick={() => setFilter((f) => ({ ...f, states: queueOnly ? [] : ["wip"] }))}
          aria-pressed={queueOnly}
          className={`ml-auto rounded-md border px-2 py-1 text-[11px] font-medium transition ${
            queueOnly
              ? "border-[var(--nj-wip)] bg-[var(--nj-wip-dim)] text-[var(--nj-wip)]"
              : "border-line text-ink-muted hover:bg-elevated hover:text-ink"
          }`}
        >
          Queue only
        </button>
        <button
          type="button"
          onClick={queue.refresh}
          title="Scan again"
          className="rounded p-1 text-ink-muted transition hover:bg-elevated hover:text-ink"
        >
          <Icon.Refresh width={12} height={12} />
          <span className="sr-only">Scan again</span>
        </button>
      </div>

      {/* --- search and the kind chips ------------------------------------ */}
      <div className="flex shrink-0 flex-wrap items-center gap-1.5 border-b border-line bg-panel px-3 py-1.5">
        <div className="relative min-w-[180px] flex-1">
          <Icon.Search
            width={12}
            height={12}
            className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-ink-faint"
            aria-hidden
          />
          <input
            value={filter.q}
            onChange={(e) => setFilter((f) => ({ ...f, q: e.target.value }))}
            placeholder="Filter by name, blurb or category…"
            spellCheck={false}
            aria-label="Filter the queue"
            className="w-full rounded-md border border-line bg-canvas py-1 pl-7 pr-2 text-[11.5px] text-ink outline-none transition placeholder:text-ink-faint focus:border-brand-2"
          />
        </div>

        {KINDS.map((k) => {
          const on = filter.kinds.includes(k);
          const c = counts.byKind[k];
          const I = Icon[KIND_ICON[k]];
          return (
            <button
              key={k}
              type="button"
              onClick={() => toggleKind(k)}
              aria-pressed={on}
              className={`inline-flex items-center gap-1.5 rounded-md border px-2 py-1 text-[11px] transition ${
                on ? "border-brand-2 bg-brand-2/15 text-ink" : "border-line text-ink-muted hover:bg-elevated hover:text-ink"
              }`}
            >
              <I width={11} height={11} aria-hidden />
              {KIND_LABEL[k]}
              <span className="font-mono text-[9.5px] text-ink-faint" data-num>
                {c.wip}/{c.total}
              </span>
            </button>
          );
        })}

        {(filter.q || filter.kinds.length || filter.states.length) && (
          <button
            type="button"
            onClick={() => setFilter({ q: "", kinds: [], states: [] })}
            className="text-[10.5px] text-ink-muted underline-offset-2 transition hover:text-ink hover:underline"
          >
            Clear
          </button>
        )}
      </div>

      {error && (
        <p className="shrink-0 border-b border-line bg-panel px-3 py-1.5 text-[11px] text-[#f8b471]">
          The repo scan came back short — {error}. Rows below are whatever it did reach.
        </p>
      )}

      {/* --- the ledger --------------------------------------------------- */}
      <div className="min-h-0 flex-1 overflow-y-auto">
        {loading ? (
          <p className="p-4 text-[11.5px] text-ink-muted">Reading the repo…</p>
        ) : rows.length === 0 ? (
          <p className="p-4 text-[11.5px] text-ink-muted">
            {counts.total === 0
              ? "Nothing scanned. The queue route could not read this repo."
              : "Nothing matches that filter."}
          </p>
        ) : (
          <ul className="nj-queue">
            {headed.map(({ row, head }) => (
              <li key={row.id}>
                {head && (
                  <h3 className="nj-queue-head">
                    <span className={`nj-pip nj-pip-${row.state}`} aria-hidden />
                    {row.state === "wip" ? "In the queue" : "Finished"} · {KIND_LABEL[row.kind]}
                  </h3>
                )}
                <Row
                  row={row}
                  open={open === row.id}
                  onOpen={() => setOpen((o) => (o === row.id ? null : row.id))}
                  onState={(s) => queue.setState(row, s)}
                  onNote={(n) => queue.setNote(row, n)}
                />
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function Tally({ state, n, label }: { state: QueueState; n: number; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className={`nj-pip nj-pip-${state}`} aria-hidden />
      <span className="font-mono text-[12px] font-semibold text-ink" data-num>
        {n}
      </span>
      <span className="text-[10.5px] text-ink-muted">{label}</span>
    </span>
  );
}

function Row({
  row,
  open,
  onOpen,
  onState,
  onNote,
}: {
  row: QueueRow;
  open: boolean;
  onOpen: () => void;
  onState: (s: QueueState) => void;
  onNote: (n: string) => void;
}) {
  const [draft, setDraft] = useState(row.note ?? "");
  const other: QueueState = row.state === "done" ? "wip" : "done";

  return (
    <div className={`nj-queue-row ${open ? "is-open" : ""}`} data-state={row.state}>
      <div className="flex items-center gap-2 px-3 py-1.5">
        {/* The pip is the control, not a decoration, so it is a real button
            with a real label — "mark Dance Vault finished", not "toggle". */}
        <button
          type="button"
          onClick={() => onState(other)}
          title={`Mark ${row.name} ${other === "done" ? "finished" : "unfinished"}`}
          className="nj-pip-btn"
        >
          <span className={`nj-pip nj-pip-${row.state} ${row.byHand ? "is-held" : ""}`} aria-hidden />
          <span className="sr-only">
            Mark {row.name} {other === "done" ? "finished" : "unfinished"}
          </span>
        </button>

        <button
          type="button"
          onClick={onOpen}
          aria-expanded={open}
          className="flex min-w-0 flex-1 items-baseline gap-2 text-left"
        >
          <span className="shrink-0 truncate text-[12px] font-medium text-ink">{row.name}</span>
          <span className="min-w-0 flex-1 truncate text-[11px] text-ink-muted">{row.blurb}</span>
        </button>

        {row.note && (
          <span
            title={row.note}
            className="hidden max-w-[160px] shrink-0 truncate rounded border border-line px-1.5 py-0.5 text-[10px] text-ink-muted md:inline"
          >
            {row.note}
          </span>
        )}
        <span className="hidden shrink-0 font-mono text-[10px] text-ink-faint md:inline" data-num>
          {row.group}
        </span>
        {row.href && (
          <Link
            href={row.href}
            className="shrink-0 rounded p-1 text-ink-faint transition hover:bg-elevated hover:text-ink"
            title={`Open ${row.name}`}
          >
            <Icon.Launch width={11} height={11} />
            <span className="sr-only">Open {row.name}</span>
          </Link>
        )}
        <Icon.Chevron
          width={11}
          height={11}
          className={`shrink-0 text-ink-faint transition-transform ${open ? "rotate-90" : ""}`}
          aria-hidden
        />
      </div>

      {open && (
        <div className="border-t border-line-soft bg-canvas/60 px-3 py-2 pl-[30px]">
          <p className="text-[11.5px] leading-relaxed text-ink">{row.why}</p>

          <ul className="mt-2 grid gap-x-4 gap-y-1 sm:grid-cols-2">
            {row.evidence.map((e) => (
              <li key={e.label} className="flex items-center gap-1.5 text-[11px]">
                <span className={`nj-ev ${e.met ? "is-met" : ""}`} aria-hidden>
                  {e.met ? <Icon.Check width={8} height={8} /> : null}
                </span>
                <span className={e.met ? "text-ink-muted" : "text-ink-faint"}>{e.label}</span>
              </li>
            ))}
          </ul>

          <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
            <input
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onBlur={() => draft !== (row.note ?? "") && onNote(draft)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  onNote(draft);
                  (e.target as HTMLInputElement).blur();
                }
              }}
              placeholder="What's left on this one?"
              className="min-w-[200px] flex-1 rounded border border-line bg-canvas px-2 py-1 text-[11px] text-ink outline-none transition placeholder:text-ink-faint focus:border-brand-2"
            />
            {row.byHand && (
              <button
                type="button"
                onClick={() => onState(row.state)}
                className="rounded border border-line px-2 py-1 text-[10.5px] text-ink-muted transition hover:bg-elevated hover:text-ink"
              >
                Back to the evidence
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
