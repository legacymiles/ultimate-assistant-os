"use client";

// ---------------------------------------------------------------------------
// In Queue, as a Deck widget.
//
// The card answers one question at a glance: "what have I left unfinished?"
// The number, a bar of finished vs not, and the top of the pile. Each row's pip
// is the same control as on the board — tap it and the row is finished, without
// opening the card. Tap anywhere else and the whole board opens in a sheet.
//
// On top of that, the one thing that is not a note but a decision: a finished
// Client Review build waiting to go live. That gets a real button the width of
// the card ("Push to main"), not a pip — it is pressed one-handed on a phone
// and it changes the owner's live site, so it should look like a button.
//
// It reads the ONE queue hook the shell owns (see DashboardPanel's `queue`
// prop), so a pip ticked here is ticked on the Queue tab and the dock count.
// ---------------------------------------------------------------------------

import { useMemo, useState } from "react";
import { Icon } from "../icons";
import { KIND_LABEL } from "@/lib/new-jarvis/queue";
import type { UseQueue } from "@/lib/new-jarvis/useQueue";
import type { UseShip } from "@/lib/client-review/useShip";
import { QueueBoard } from "./QueueBoard";
import { Widget, WidgetSheet, stop } from "./Widgets";

const SHOWN = 5;

export function QueueWidget({ queue, ship, onExpand }: { queue: UseQueue; ship: UseShip; onExpand: () => void }) {
  const { all, counts, loading, error } = queue;
  // `all` is already sorted unfinished-first, pinned tasks at the top.
  const wip = useMemo(() => all.filter((r) => r.state === "wip"), [all]);
  const pct = counts.total ? Math.round((counts.done / counts.total) * 100) : 0;
  const [said, setSaid] = useState("");

  // What built and is one tap from live. Only the first is on the card; the
  // rest are one tap away in the Ship widget or the console.
  const ready = ship.items.filter((i) => !ship.pushed.has(i.versionId));
  const top = ready[0];
  const pushingTop = top ? ship.pushing === top.versionId : false;

  return (
    <Widget
      title="In Queue"
      icon="ListChecks"
      count={counts.wip + ready.length}
      live={!loading && (counts.wip > 0 || ready.length > 0)}
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
      ) : (
        <>
          {top && (
            <div className="mb-2 rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-2.5">
              <p className="text-[10px] uppercase tracking-[0.14em] text-emerald-200/80">Client Review · ready to go live</p>
              <p className="mt-0.5 truncate text-[13.5px] font-semibold text-ink">
                {top.name} <span className="font-normal text-ink-muted">· {top.version}</span>
              </p>
              <div className="mt-2 flex gap-1.5">
                <button
                  type="button"
                  disabled={pushingTop || !top.threadId}
                  onClick={(e) => {
                    stop(e);
                    void ship.push(top).then(setSaid);
                  }}
                  className="h-10 flex-1 rounded-lg bg-emerald-500/85 px-3 text-[12.5px] font-semibold text-black transition hover:bg-emerald-400 disabled:opacity-50"
                  title={
                    top.threadId
                      ? `Merge ${top.name} ${top.version} into main and deploy it`
                      : "This one is filed in In Queue — there is no build on your PC to push yet"
                  }
                >
                  {pushingTop ? "Pushing…" : top.threadId ? "Push to main" : "In In Queue"}
                </button>
                <a
                  href="/apps/client-review"
                  onClick={(e) => stop(e)}
                  className="inline-flex h-10 items-center gap-1 rounded-lg border border-line px-3 text-[12px] text-ink-muted hover:text-ink"
                >
                  Review <Icon.Chevron width={10} height={10} className="rotate-90 opacity-60" aria-hidden />
                </a>
              </div>
              {said && <p className="mt-1.5 text-[10.5px] leading-snug text-emerald-200">{said}</p>}
              {ready.length > 1 && (
                <p className="mt-1 text-[10.5px] text-ink-faint">+{ready.length - 1} more ready — open the Ship widget.</p>
              )}
            </div>
          )}

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
            <p className="py-5 text-center text-[12px] text-ink-faint">Everything is finished. Queue&apos;s clear.</p>
          ) : (
            <ul className="mt-1.5 divide-y divide-line-soft">
              {wip.slice(0, SHOWN).map((r) => (
                <li key={r.id} className="flex items-center gap-2.5 py-2.5">
                  <button
                    type="button"
                    onClick={(e) => {
                      stop(e);
                      queue.setState(r, "done");
                    }}
                    title={`Mark ${r.name} finished`}
                    className="grid h-9 w-9 shrink-0 place-items-center rounded-full transition hover:bg-elevated"
                  >
                    <span className={`nj-pip nj-pip-wip ${r.byHand ? "is-held" : ""}`} aria-hidden />
                    <span className="sr-only">Mark {r.name} finished</span>
                  </button>
                  <span className="min-w-0 flex-1 truncate text-[13px] text-ink" title={r.note || r.why}>
                    {r.name}
                  </span>
                  {r.requests > 0 && (
                    <span
                      className="shrink-0 rounded-full bg-brand-2/20 px-1.5 font-mono text-[10px] font-semibold text-ink"
                      title={`${r.requests} requested`}
                    >
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
