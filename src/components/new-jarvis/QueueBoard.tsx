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
import { sendToBoard, ticketForQueueRow } from "@/lib/new-jarvis/board";
import { INBOX, inFolder } from "@/lib/new-jarvis/requests";
import type { UseRequests } from "@/lib/new-jarvis/useRequests";
import { FinishedLog, RequestComposer, RequestList } from "./QueueFolder";

const KINDS: QueueKind[] = ["task", "app", "skill", "workflow"];

const KIND_ICON: Record<QueueKind, keyof typeof Icon> = {
  task: "Flag",
  app: "Launch",
  skill: "Sparkles",
  workflow: "Film",
};

export function QueueBoard({ queue }: { queue: UseQueue }) {
  const { rows, counts, filter, setFilter, loading, error, requests } = queue;
  const [open, setOpen] = useState<string | null>(null);
  const [showFinished, setShowFinished] = useState(false);
  const [inboxOpen, setInboxOpen] = useState(true);
  const inbox = inFolder(requests.doc, INBOX);

  // Folder ids → the names the rows carry, for the finished log.
  const names = useMemo(() => new Map(queue.all.map((r) => [r.id, r.name])), [queue.all]);
  const folderName = useCallback(
    (f: string) => (f === INBOX ? "Inbox" : names.get(f) ?? f),
    [names],
  );

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
      // Rows with requests waiting sort to the very top (queue.ts) and get
      // their own section, so the live work is one heading, not scattered.
      const key = row.requests > 0 ? "asked" : `${row.state}/${row.kind}`;
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
        <span className="inline-flex items-center gap-1.5" title="Requests waiting across every folder">
          <Icon.Inbox width={11} height={11} className="text-brand-2" aria-hidden />
          <span className="font-mono text-[12px] font-semibold text-ink" data-num>
            {requests.total}
          </span>
          <span className="text-[10.5px] text-ink-muted">requested</span>
        </span>
        <button
          type="button"
          onClick={() => setShowFinished((v) => !v)}
          aria-pressed={showFinished}
          className={`rounded-md border px-2 py-1 text-[11px] transition ${
            showFinished ? "border-[var(--nj-done)] bg-[var(--nj-done-dim)] text-ink" : "border-line text-ink-muted hover:bg-elevated hover:text-ink"
          }`}
          title="Requests that left the queue in the last two weeks"
        >
          Finished {requests.doc.finished.length}
        </button>

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

        <button
          type="button"
          onClick={() => setFilter((f) => ({ ...f, asked: !f.asked }))}
          aria-pressed={Boolean(filter.asked)}
          className={`inline-flex items-center gap-1.5 rounded-md border px-2 py-1 text-[11px] transition ${
            filter.asked ? "border-brand-2 bg-brand-2/15 text-ink" : "border-line text-ink-muted hover:bg-elevated hover:text-ink"
          }`}
        >
          <Icon.Folder width={11} height={11} aria-hidden />
          With requests
        </button>

        {(filter.q || filter.kinds.length || filter.states.length || filter.asked) && (
          <button
            type="button"
            onClick={() => setFilter({ q: "", kinds: [], states: [] })}
            className="text-[10.5px] text-ink-muted underline-offset-2 transition hover:text-ink hover:underline"
          >
            Clear
          </button>
        )}
      </div>

      {showFinished && (
        <div className="max-h-[40%] shrink-0 overflow-y-auto border-b border-line bg-canvas/60">
          <FinishedLog requests={requests} folderName={folderName} />
        </div>
      )}

      {/* --- the inbox: an idea not filed under anything yet --------------- */}
      <div className="shrink-0 border-b border-line bg-panel/60">
        <button
          type="button"
          onClick={() => setInboxOpen((v) => !v)}
          aria-expanded={inboxOpen}
          className="flex w-full items-center gap-2 px-3 py-1.5 text-left"
        >
          <Icon.Inbox width={12} height={12} className="text-brand-2" aria-hidden />
          <span className="text-[12px] font-medium text-ink">Inbox</span>
          <span className="min-w-0 flex-1 truncate text-[11px] text-ink-muted">
            Ideas for anything — or open a row below to queue a request in its folder
          </span>
          {inbox.length > 0 && <Count n={inbox.length} />}
          <Icon.Chevron
            width={11}
            height={11}
            className={`shrink-0 text-ink-faint transition-transform ${inboxOpen ? "rotate-90" : ""}`}
            aria-hidden
          />
        </button>
        {inboxOpen && (
          <div className="px-3 pb-2">
            <RequestComposer requests={requests} folder={INBOX} placeholder="Queue an idea…" />
            {inbox.length > 0 && (
              <div className="mt-1.5 max-h-56 overflow-y-auto">
                <RequestList requests={requests} folder={INBOX} />
              </div>
            )}
            {requests.localOnly && requests.ready && (
              <p className="mt-1 text-[10px] text-[#f8b471]">
                Kept on this device only — sign in so your PC can see and finish these.
              </p>
            )}
          </div>
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
                    {head === "asked"
                      ? "Requested — waiting in their folders"
                      : `${row.state === "wip" ? "In the queue" : "Finished"} · ${KIND_LABEL[row.kind]}`}
                  </h3>
                )}
                <Row
                  row={row}
                  open={open === row.id}
                  onOpen={() => setOpen((o) => (o === row.id ? null : row.id))}
                  onState={(s) => queue.setState(row, s)}
                  onNote={(n) => queue.setNote(row, n)}
                  requests={requests}
                />
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function Count({ n }: { n: number }) {
  return (
    <span
      className="inline-flex shrink-0 items-center gap-1 rounded-full bg-brand-2/20 px-1.5 py-0.5 font-mono text-[10px] font-semibold text-ink"
      title={`${n} request${n === 1 ? "" : "s"} waiting`}
      data-num
    >
      <Icon.Folder width={9} height={9} aria-hidden />
      {n}
    </span>
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
  requests,
}: {
  row: QueueRow;
  open: boolean;
  onOpen: () => void;
  onState: (s: QueueState) => void;
  onNote: (n: string) => void;
  requests: UseRequests;
}) {
  const [sent, setSent] = useState<string | null>(null);
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

        {row.requests > 0 && <Count n={row.requests} />}
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
          {/* The folder: queue requests for this one, chat-style, newest first. */}
          <div className="nj-rq-folder">
            <p className="mb-1 flex items-center gap-1.5 text-[10.5px] font-semibold uppercase tracking-wide text-ink-muted">
              <Icon.FolderOpen width={11} height={11} aria-hidden /> {row.name} folder
            </p>
            <RequestComposer
              requests={requests}
              folder={row.folder ?? row.id}
              placeholder={`What should change on ${row.name}?`}
              autoFocus
            />
            <div className="mt-1.5 max-h-72 overflow-y-auto">
              <RequestList requests={requests} folder={row.folder ?? row.id} />
            </div>
          </div>

          <p className="mt-3 text-[11.5px] leading-relaxed text-ink">{row.why}</p>

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
            {/* The old one-line note became the folder above. A note written
                before that is not lost: one tap files it as a request. */}
            {row.note && (
              <span className="inline-flex min-w-0 flex-1 items-center gap-1.5 rounded border border-line px-2 py-1 text-[11px] text-ink-muted">
                <span className="truncate" title={row.note}>
                  Old note: {row.note}
                </span>
                <button
                  type="button"
                  onClick={() => {
                    const note = row.note ?? "";
                    void requests.add(row.folder ?? row.id, note).then((added) => {
                      if (added.length || !requests.error) onNote("");
                    });
                  }}
                  className="shrink-0 rounded border border-line px-1.5 py-0.5 text-[10px] text-ink transition hover:bg-elevated"
                >
                  Move into folder
                </button>
              </span>
            )}
            {row.state === "wip" && (
              <button
                type="button"
                title="File a card in Backlog on the super-board to finish this. Nothing builds until you move it to Ready."
                onClick={() => {
                  setSent("Sending…");
                  void sendToBoard(ticketForQueueRow(row)).then((r) => setSent(r.message));
                }}
                className="rounded border border-line px-2 py-1 text-[10.5px] text-ink-muted transition hover:bg-elevated hover:text-ink"
              >
                Finish it (board)
              </button>
            )}
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
          {sent && <p className="mt-1.5 text-[10.5px] text-ink-muted">{sent}</p>}
        </div>
      )}
    </div>
  );
}
