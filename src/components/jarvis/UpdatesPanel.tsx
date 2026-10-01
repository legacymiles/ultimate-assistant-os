"use client";

// ---------------------------------------------------------------------------
// Updates — the one part of the dashboard that moves.
//
// A dense divided list rather than a grid of cards: these rows are scanned on
// the way past, not read. So the eye gets one fixed column order every time —
// new marker, source colour, what happened, who did it, when — and nothing
// shifts between rows.
//
// Order is urgency then recency: anything still to happen sits at the top,
// soonest first, and everything that already happened follows newest first.
// An appointment in half an hour is the one row that must not be filed behind
// an hour-old shopping item.
// ---------------------------------------------------------------------------

import { useEffect, useRef } from "react";
import { Icon } from "../icons";
import type { TabId } from "./Jarvis";
import { MEMBER_COLOURS } from "@/lib/recall/lists/types";
import { UPDATE_COLOR, UPDATE_LABEL, UPDATE_SOURCES, UPDATE_TAB } from "@/lib/jarvis/updates";
import type { JarvisUpdate } from "@/lib/jarvis/updates";
import type { UpdatesApi } from "@/lib/jarvis/useUpdates";

const action =
  "inline-flex items-center gap-1.5 rounded-lg border border-line px-2 py-1 text-[11px] font-medium text-ink-muted transition-colors hover:border-ink-faint hover:bg-panel-2 hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand disabled:pointer-events-none disabled:opacity-40";

function memberDot(colour?: string): string {
  return MEMBER_COLOURS.find((c) => c.id === colour)?.dot ?? "bg-ink-faint";
}

function clockOf(iso: string): string {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return "you last looked";
  const d = new Date(t);
  const sameDay = d.toDateString() === new Date().toDateString();
  const time = d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
  return sameDay ? time : `${d.toLocaleDateString(undefined, { day: "numeric", month: "short" })}, ${time}`;
}

function Row({
  update,
  fresh,
  unread,
  onOpen,
  onDismiss,
}: {
  update: JarvisUpdate;
  fresh: boolean;
  unread: boolean;
  onOpen: () => void;
  onDismiss: () => void;
}) {
  return (
    <li
      className="ju-row group relative flex items-center gap-2.5 py-2 pl-2 pr-1.5 transition-colors hover:bg-panel-2 has-[:focus-visible]:bg-panel-2 has-[:focus-visible]:outline-2 has-[:focus-visible]:-outline-offset-2 has-[:focus-visible]:outline-brand"
      data-fresh={fresh ? "1" : undefined}
    >
      {/* A fixed-width gutter, so every title starts on the same vertical line
          whether or not the row is new. */}
      <span className="flex w-1.5 shrink-0 justify-center" aria-hidden>
        {unread && <span className="h-1.5 w-1.5 rounded-full bg-brand" />}
      </span>
      <span
        className="h-2 w-2 shrink-0 rounded-full"
        style={{ background: UPDATE_COLOR[update.source] }}
        aria-hidden
      />

      {/* The stretched pseudo-element makes the whole row clickable while the
          button keeps a real, readable accessible name. */}
      <button
        type="button"
        onClick={onOpen}
        className="block min-w-0 flex-1 truncate text-left after:absolute after:inset-0 after:content-[''] focus-visible:outline-none"
      >
        <span className="sr-only">
          {unread ? "New. " : ""}
          {UPDATE_LABEL[update.source]}:{" "}
        </span>
        <span className={`text-[13px] text-ink ${unread ? "font-medium" : ""}`}>{update.title}</span>
        <span className="ml-1.5 text-[11px] text-ink-muted">{update.detail}</span>
      </button>

      {update.who && (
        <span className="hidden shrink-0 items-center gap-1 text-[11px] text-ink-muted sm:flex">
          <span className={`h-1.5 w-1.5 rounded-full ${memberDot(update.colour)}`} aria-hidden />
          {update.who}
        </span>
      )}

      <span className="shrink-0 text-[11px] tabular-nums text-ink-muted">{update.when}</span>

      <button
        type="button"
        onClick={onDismiss}
        title={`Clear "${update.title}"`}
        /* Always visible on a touch screen, where there is no hover to reveal
           it; revealed on hover anywhere a pointer exists. */
        className="relative z-10 shrink-0 rounded p-1 text-ink-muted transition-opacity hover:text-ink focus-visible:opacity-100 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-brand group-hover:opacity-100 [@media(hover:hover)]:opacity-0"
      >
        <Icon.Close width={12} height={12} />
        <span className="sr-only">Clear this update</span>
      </button>
    </li>
  );
}

function Empty({ api, go }: { api: UpdatesApi; go: (t: TabId) => void }) {
  const allOff = UPDATE_SOURCES.every((s) => api.settings.sources?.[s]?.on === false);

  if (allOff) {
    return (
      <p className="px-3 py-7 text-center text-xs text-ink-muted">
        Every source is switched off, so nothing can appear here.{" "}
        <button
          className="underline underline-offset-2 transition-colors hover:text-ink"
          onClick={() => go("settings")}
        >
          Turn some back on
        </button>
        .
      </p>
    );
  }
  if (!api.ready) return <p className="px-3 py-7 text-center text-xs text-ink-muted">Checking for updates…</p>;
  return (
    <p className="px-3 py-7 text-center text-xs text-ink-muted">
      Nothing new since {clockOf(api.seenAt)}.
    </p>
  );
}

export function UpdatesPanel({ api, go }: { api: UpdatesApi; go: (t: TabId) => void }) {
  const { updates, unread, unreadIds } = api;

  // Ids that have already been on screen. A row slides in the first time it
  // appears and never again, so the 30-second recompute stays invisible.
  // Nothing counts as an arrival until the first load has finished: the
  // family board lands a beat after the local sources, and sliding those rows
  // in makes an ordinary page load look like a burst of news.
  const seen = useRef<Set<string> | null>(null);
  const fresh = new Set<string>();
  if (api.ready) {
    if (seen.current === null) seen.current = new Set(updates.map((u) => u.id));
    else for (const u of updates) if (!seen.current.has(u.id)) fresh.add(u.id);
  }
  useEffect(() => {
    const known = seen.current;
    if (known) for (const u of updates) known.add(u.id);
  }, [updates]);

  return (
    <section className="mt-3 rounded-xl border border-line bg-panel">
      <header className="flex flex-wrap items-center gap-x-2 gap-y-1.5 border-b border-line-soft px-3 py-2.5">
        <Icon.Bell width={13} height={13} className="shrink-0 text-ink-muted" />
        <h2 className="text-xs font-semibold text-ink">Updates</h2>
        {unread > 0 && (
          <span className="rounded-full bg-brand px-1.5 py-0.5 text-[10px] font-semibold tabular-nums text-white">
            {unread} new
          </span>
        )}
        <div className="ml-auto flex items-center gap-1.5">
          <button className={action} onClick={api.markRead} disabled={unread === 0}>
            <Icon.Check2 width={12} height={12} /> Mark read
          </button>
          <button className={action} onClick={api.clearAll} disabled={updates.length === 0}>
            Clear all
          </button>
          <button className={action} onClick={() => go("settings")} title="Choose what appears here">
            <Icon.Settings width={12} height={12} />
            <span className="sr-only">Update settings</span>
          </button>
        </div>
      </header>

      {api.spendError && (
        <p role="status" className="border-b border-line-soft px-3 py-2 text-[11px] text-amber-300">
          {api.spendError} So what the AI has cost today is missing here — not zero.
        </p>
      )}

      {api.boardError && (
        <p className="border-b border-line-soft px-3 py-2 text-[11px] text-amber-300">
          The family board could not be read just now, so Lists updates are missing here — not empty.
        </p>
      )}

      {updates.length === 0 ? (
        <Empty api={api} go={go} />
      ) : (
        <ul className="ju-scroll max-h-[22rem] divide-y divide-line-soft overflow-y-auto">
          {updates.map((u) => (
            <Row
              key={u.id}
              update={u}
              fresh={fresh.has(u.id)}
              unread={unreadIds.has(u.id)}
              onOpen={() => go(UPDATE_TAB[u.source] as TabId)}
              onDismiss={() => api.dismiss(u.id)}
            />
          ))}
        </ul>
      )}
    </section>
  );
}
