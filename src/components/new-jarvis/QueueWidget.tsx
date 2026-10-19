"use client";

// ---------------------------------------------------------------------------
// In Queue, as a Deck widget.
//
// The card answers one question at a glance: "what have I left unfinished?"
// The number, a bar of finished vs not, and the top of the pile. Each row's pip
// is the same control as on the board — tap it and the row is finished, without
// opening the card. Tap anywhere else and the whole board opens in a sheet.
//
// It reads the ONE queue hook the shell owns (see DashboardPanel's `queue`
// prop), so a pip ticked here is ticked on the Queue tab and the dock count.
// ---------------------------------------------------------------------------

import { useMemo } from "react";
import { Icon } from "../icons";
import { KIND_LABEL } from "@/lib/new-jarvis/queue";
import type { UseQueue } from "@/lib/new-jarvis/useQueue";
import { QueueBoard } from "./QueueBoard";
import { Widget, WidgetSheet, stop } from "./Widgets";

const SHOWN = 5;

export function QueueWidget({ queue, onExpand }: { queue: UseQueue; onExpand: () => void }) {
  const { all, counts, loading, error } = queue;
  // `all` is already sorted unfinished-first, pinned tasks at the top.
  const wip = useMemo(() => all.filter((r) => r.state === "wip"), [all]);
  const pct = counts.total ? Math.round((counts.done / counts.total) * 100) : 0;

  return (
    <Widget
      title="In Queue"
      icon="ListChecks"
      count={counts.wip}
      live={!loading && counts.wip > 0}
      onExpand={onExpand}
      status={
        error
          ? "The scan came back short — tap to see what it reached."
          : wip.length > SHOWN
            ? `+${wip.length - SHOWN} more unfinished — tap to see them all`
            : undefined
      }
    >
      {loading ? (
        <p className="py-6 text-center text-[11.5px] text-ink-faint">Reading the repo…</p>
      ) : counts.total === 0 ? (
        <p className="py-6 text-center text-[11.5px] text-ink-faint">Nothing scanned yet.</p>
      ) : (
        <>
          {/* finished vs unfinished, as one bar */}
          <div className="flex items-center gap-2">
            <div
              className="h-1.5 flex-1 overflow-hidden rounded-full"
              style={{ background: "var(--nj-wip-dim)" }}
              role="img"
              aria-label={`${counts.done} of ${counts.total} finished`}
            >
              <div className="h-full rounded-full transition-[width] duration-500" style={{ width: `${pct}%`, background: "var(--nj-done)" }} />
            </div>
            <span className="shrink-0 font-mono text-[10px] text-ink-faint" data-num>
              {counts.done}/{counts.total} done
              {queue.requests.total > 0 ? ` · ${queue.requests.total} requested` : ""}
            </span>
          </div>

          {wip.length === 0 ? (
            <p className="py-5 text-center text-[11.5px] text-ink-faint">Everything is finished. Queue&apos;s clear.</p>
          ) : (
            <ul className="mt-2 space-y-0.5">
              {wip.slice(0, SHOWN).map((r) => (
                <li key={r.id} className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={(e) => {
                      stop(e);
                      queue.setState(r, "done");
                    }}
                    title={`Mark ${r.name} finished`}
                    className="nj-pip-btn"
                  >
                    <span className={`nj-pip nj-pip-wip ${r.byHand ? "is-held" : ""}`} aria-hidden />
                    <span className="sr-only">Mark {r.name} finished</span>
                  </button>
                  <span className="min-w-0 flex-1 truncate text-[12px] text-ink" title={r.note || r.why}>
                    {r.name}
                  </span>
                  {r.requests > 0 && (
                    <span className="shrink-0 rounded-full bg-brand-2/20 px-1.5 font-mono text-[9.5px] font-semibold text-ink" title={`${r.requests} requested`}>
                      {r.requests}
                    </span>
                  )}
                  <span className="shrink-0 font-mono text-[9.5px] uppercase tracking-wide text-ink-faint">{KIND_LABEL[r.kind]}</span>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </Widget>
  );
}

export function QueueExpanded({ queue, go, onClose }: { queue: UseQueue; go: (tab: string) => void; onClose: () => void }) {
  return (
    <WidgetSheet
      title="In Queue"
      kicker={`${queue.counts.wip} unfinished · ${queue.counts.done} finished`}
      onClose={onClose}
      actions={
        <button
          type="button"
          className="deck-btn inline-flex items-center gap-1"
          onClick={() => {
            onClose();
            go("queue");
          }}
        >
          <Icon.Launch width={11} height={11} aria-hidden /> Open Queue tab
        </button>
      }
    >
      <div className="h-full min-h-[60dvh]">
        <QueueBoard queue={queue} />
      </div>
    </WidgetSheet>
  );
}
