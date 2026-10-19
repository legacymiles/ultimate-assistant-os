"use client";

// ---------------------------------------------------------------------------
// Site errors — the crash log, on the Deck.
//
// Compact: how many open crashes this week, and the top few with their site
// and count. Expanded: every open crash with its pages, browsers and stack;
// "Mark fixed" (a repeat re-opens it); "Send to board" (a bug card in Backlog,
// written the way super-board wants bugs); the one line to put on a client
// site so its crashes land here too; and the one build checklist this log is
// line R2 of.
// ---------------------------------------------------------------------------

import { useCallback, useEffect, useState } from "react";
import { Icon } from "../icons";
import { MiniBtn, Widget, WidgetSheet } from "./Widgets";
import { CHECKLIST } from "@/lib/new-jarvis/felix";
import { sendToBoard, ticketForError } from "@/lib/new-jarvis/board";
import type { ErrorEntry } from "@/lib/site-errors/log";

interface ErrorsState {
  open: ErrorEntry[];
  week: number;
  total: number;
  persistent: boolean;
}

export interface UseSiteErrors {
  data: ErrorsState | null;
  error: string | null;
  refresh: () => void;
  resolve: (id: string) => Promise<void>;
}

export function useSiteErrors(): UseSiteErrors {
  const [data, setData] = useState<ErrorsState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(() => {
    fetch("/api/site-errors", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((d: ErrorsState) => {
        setData(d);
        setError(null);
      })
      .catch(() => setError("Couldn't load the error log just now."));
  }, []);
  useEffect(() => {
    load();
    const t = window.setInterval(load, 60_000);
    return () => window.clearInterval(t);
  }, [load]);
  const resolve = useCallback(async (id: string) => {
    setData((d) => (d ? { ...d, open: d.open.filter((e) => e.id !== id) } : d));
    try {
      await fetch("/api/site-errors", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id }) });
    } finally {
      load();
    }
  }, [load]);
  return { data, error, refresh: load, resolve };
}

function ago(iso: string): string {
  const m = Math.max(0, Math.floor((Date.now() - Date.parse(iso)) / 60_000));
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  return h < 24 ? `${h}h ago` : `${Math.floor(h / 24)}d ago`;
}

export function SiteErrorsWidget({ errors, onExpand }: { errors: UseSiteErrors; onExpand: () => void }) {
  const open = errors.data?.open ?? [];
  return (
    <Widget
      title="Site errors"
      icon="Flag"
      count={open.length}
      live={open.length > 0}
      onExpand={onExpand}
      actions={
        <MiniBtn label="Check again" onClick={errors.refresh}>
          <Icon.Refresh width={12} height={12} aria-hidden />
        </MiniBtn>
      }
      status={errors.error || (errors.data ? `${errors.data.week} new this week · crashes are logged automatically` : undefined)}
    >
      {!errors.data && !errors.error ? (
        <p className="py-6 text-center text-[11.5px] text-ink-faint">Loading…</p>
      ) : open.length === 0 ? (
        <p className="py-6 text-center text-[11.5px] text-ink-faint">No open crashes. Nice.</p>
      ) : (
        <ul className="space-y-1.5">
          {open.slice(0, 4).map((e) => (
            <li key={e.id} className="min-w-0">
              <p className="truncate text-[12px] text-ink" title={e.message}>
                {e.message}
              </p>
              <p className="truncate font-mono text-[10px] text-ink-faint">
                {e.site} · {e.count}× · {ago(e.lastSeen)}
              </p>
            </li>
          ))}
        </ul>
      )}
    </Widget>
  );
}

const SNIPPET = (origin: string) => `<script src="${origin}/jarvis-errors.js" data-site="client-name" defer></script>`;

export function SiteErrorsExpanded({ errors, onClose }: { errors: UseSiteErrors; onClose: () => void }) {
  const open = errors.data?.open ?? [];
  const [note, setNote] = useState<Record<string, string>>({});
  const [copied, setCopied] = useState(false);
  const origin = typeof window === "undefined" ? "https://ultimate-assistant-os.vercel.app" : window.location.origin;

  return (
    <WidgetSheet
      title="Site errors"
      kicker={`${open.length} open · ${errors.data?.week ?? 0} this week · hub and client sites`}
      onClose={onClose}
      actions={
        <button type="button" className="deck-btn" onClick={errors.refresh}>
          <Icon.Refresh width={12} height={12} aria-hidden /> Check again
        </button>
      }
    >
      {errors.data && !errors.data.persistent && (
        <p className="border-b border-line-soft px-4 py-2 text-[11.5px] text-[var(--hud-amber)]">
          This copy of Jarvis has no database key, so the log only lasts until the next restart.
        </p>
      )}

      {open.length === 0 ? (
        <p className="p-6 text-[12px] text-ink-muted">No open crashes. Every crash on the hub — and on any client site with the script below — shows up here on its own.</p>
      ) : (
        <ul className="divide-y divide-line-soft">
          {open.map((e) => (
            <li key={e.id} className="px-4 py-2.5">
              <div className="flex items-baseline gap-2">
                <span className="shrink-0 rounded border border-line px-1.5 font-mono text-[10px] text-ink-muted">{e.site}</span>
                <p className="min-w-0 flex-1 text-[12.5px] text-ink">{e.message}</p>
                <span className="shrink-0 font-mono text-[10.5px] text-[var(--hud)]" data-num>
                  {e.count}×
                </span>
              </div>
              <p className="mt-0.5 font-mono text-[10.5px] text-ink-faint">
                {e.kind} · first {ago(e.firstSeen)} · last {ago(e.lastSeen)}
                {e.urls.length ? ` · ${e.urls.slice(0, 3).join(", ")}` : ""}
                {e.agents.length ? ` · ${e.agents.join(", ")}` : ""}
              </p>
              {e.stack && (
                <details className="mt-1">
                  <summary className="cursor-pointer text-[11px] text-ink-muted">Stack</summary>
                  <pre className="mt-1 max-h-48 overflow-auto rounded bg-canvas p-2 font-mono text-[10.5px] leading-snug text-ink-muted">{e.stack}</pre>
                </details>
              )}
              <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                <button
                  type="button"
                  className="deck-btn"
                  title="File a bug card in Backlog on the super-board. Nothing builds until you move it to Ready."
                  onClick={() => {
                    setNote((n) => ({ ...n, [e.id]: "Sending…" }));
                    void sendToBoard(ticketForError(e)).then((r) => setNote((n) => ({ ...n, [e.id]: r.message })));
                  }}
                >
                  <Icon.ListChecks width={12} height={12} aria-hidden /> Send to board
                </button>
                <button type="button" className="deck-btn" onClick={() => void errors.resolve(e.id)}>
                  <Icon.Check width={12} height={12} aria-hidden /> Mark fixed
                </button>
                {note[e.id] && <span className="text-[11px] text-ink-muted">{note[e.id]}</span>}
              </div>
            </li>
          ))}
        </ul>
      )}

      <section className="border-t border-line px-4 py-3">
        <h3 className="text-[12px] font-semibold text-ink">Watch a client site too</h3>
        <p className="mt-0.5 text-[11.5px] text-ink-muted">Paste this before &lt;/body&gt; on the site, with the client&apos;s name. Its crashes land here, and on the board after the next collect.</p>
        <div className="mt-1.5 flex items-center gap-1.5">
          <code className="min-w-0 flex-1 overflow-x-auto whitespace-nowrap rounded bg-canvas px-2 py-1.5 font-mono text-[11px] text-ink">{SNIPPET(origin)}</code>
          <button
            type="button"
            className="deck-btn shrink-0"
            onClick={() => {
              void navigator.clipboard?.writeText(SNIPPET(origin)).then(() => {
                setCopied(true);
                setTimeout(() => setCopied(false), 1_500);
              });
            }}
          >
            <Icon.Copy width={12} height={12} aria-hidden /> {copied ? "Copied" : "Copy"}
          </button>
        </div>
      </section>

      <details className="border-t border-line px-4 py-3">
        <summary className="cursor-pointer text-[12px] font-semibold text-ink">The build checklist ({CHECKLIST.length} starter rules)</summary>
        <p className="mt-1 text-[11.5px] text-ink-muted">
          The one checklist every site and app is held to — this crash log is rule R2. Switch rules on or off, add your own, and see what Jarvis learned from your chats in Dashboard › Profile › Backend checklist.
        </p>
        <ul className="mt-2 grid gap-x-6 gap-y-0.5 sm:grid-cols-2">
          {CHECKLIST.map((c) => (
            <li key={c.id} className="flex gap-2 text-[11px]">
              <span className="w-6 shrink-0 font-mono text-[var(--hud)]">{c.id}</span>
              <span className={c.level === "Must" ? "text-ink" : "text-ink-muted"}>
                {c.text}
                {c.level !== "Must" && <span className="text-ink-faint"> · {c.level.toLowerCase()}</span>}
              </span>
            </li>
          ))}
        </ul>
      </details>
    </WidgetSheet>
  );
}
