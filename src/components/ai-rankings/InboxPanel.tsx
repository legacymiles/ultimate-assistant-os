"use client";

import { useState } from "react";
import { Icon } from "../icons";
import { CATEGORIES, FAMILIES, categoryOf, releasedLabel } from "@/lib/ai-rankings/leaderboard";
import type { InboxItem } from "@/lib/ai-rankings/leaderboard";

interface Props {
  items: InboxItem[];
  lastSweepAt: string | null;
  lastSweepNote: string | null;
  now: number;
  busyId: string | null;
  sweeping: boolean;
  onApprove: (id: string, category: string) => void;
  onDismiss: (id: string) => void;
  onDismissAll: () => void;
  onSweep: () => void;
  onClose: () => void;
}

const compact = new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 });

/** New releases the daily sweep found. Nothing here is public until approved. */
export function InboxPanel(p: Props) {
  const [confirmAll, setConfirmAll] = useState(false);
  return (
    <>
      <header className="border-b border-line px-5 py-4">
        <div className="flex items-center gap-3">
          <h2 className="flex-1 text-base font-semibold text-ink">New releases</h2>
          <button onClick={p.onClose} className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-md text-ink-muted transition hover:bg-panel-2 hover:text-ink pointer-coarse:h-11 pointer-coarse:w-11" aria-label="Close inbox">
            <Icon.Close width={14} height={14} />
          </button>
        </div>
        <p className="mt-1 max-w-[52ch] text-[12px] leading-relaxed text-ink-muted">
          Trending Hugging Face releases from the last 45 days, minus quantised copies, other people&apos;s fine-tunes and anything already on the board.
          Approving puts it on the public board.
        </p>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <button
            onClick={p.onSweep}
            disabled={p.sweeping}
            className="inline-flex items-center gap-1.5 rounded-md border border-line px-2.5 py-1 text-[12px] text-ink-muted transition hover:border-ink-faint hover:text-ink disabled:opacity-60"
          >
            <Icon.Refresh width={12} height={12} className={p.sweeping ? "motion-safe:animate-spin" : ""} aria-hidden="true" />
            {p.sweeping ? "Checking Hugging Face…" : "Check now"}
          </button>
          <span className="text-[11px] text-ink-muted">
            {p.lastSweepAt ? `Last checked ${releasedLabel(p.lastSweepAt.slice(0, 10), p.now)} · ${p.lastSweepNote ?? ""}` : "Not checked yet"}
          </span>
          {p.items.length > 1 &&
            (confirmAll ? (
              <span className="ml-auto flex items-center gap-1.5 text-[12px] text-ink-muted">
                Dismiss all {p.items.length}?
                <button onClick={() => { p.onDismissAll(); setConfirmAll(false); }} className="rounded-md bg-rose-600 px-2 py-0.5 font-semibold text-white">Dismiss</button>
                <button onClick={() => setConfirmAll(false)} className="px-1 hover:text-ink">Keep</button>
              </span>
            ) : (
              <button onClick={() => setConfirmAll(true)} className="ml-auto text-[12px] text-ink-muted transition hover:text-ink">
                Dismiss all
              </button>
            ))}
        </div>
      </header>

      <div className="flex-1 overflow-y-auto">
        {p.items.length === 0 ? (
          <div className="px-5 py-14 text-center">
            <Icon.Inbox width={22} height={22} className="mx-auto text-ink-muted" aria-hidden="true" />
            <p className="mt-3 text-[13px] text-ink">You&apos;re caught up</p>
            <p className="mx-auto mt-1 max-w-[40ch] text-[12px] text-ink-muted">
              The daily check files new releases here. Press Check now to look straight away.
            </p>
          </div>
        ) : (
          <ul className="divide-y divide-line-soft">
            {p.items.map((it) => (
              <InboxRow key={it.id} item={it} now={p.now} busy={p.busyId === it.id} onApprove={p.onApprove} onDismiss={p.onDismiss} />
            ))}
          </ul>
        )}
      </div>
    </>
  );
}

function InboxRow({ item, now, busy, onApprove, onDismiss }: { item: InboxItem; now: number; busy: boolean; onApprove: Props["onApprove"]; onDismiss: Props["onDismiss"] }) {
  // A suggestion whose category we can't recognise starts blank rather than
  // pretending to be whatever happens to sort first.
  const [category, setCategory] = useState(categoryOf(item.category) ? item.category : "");
  const valid = Boolean(categoryOf(category));
  return (
    <li className={`px-5 py-3.5 transition ${busy ? "opacity-50" : ""}`}>
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <a href={item.url} target="_blank" rel="noopener noreferrer" className="block truncate text-[13px] font-medium text-ink hover:underline">
            {item.name}
          </a>
          <p className="mt-0.5 truncate text-[11.5px] text-ink-muted">
            {item.maker} · released {releasedLabel(item.releasedAt, now)} · <span className="font-mono tabular-nums">{compact.format(item.likes)}</span> likes
            {item.license && <> · <span className="font-mono">{item.license}</span></>}
          </p>
        </div>
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <select
          value={category}
          onChange={(e) => setCategory(e.target.value)}
          aria-label={`Category for ${item.name}`}
          className="min-h-8 rounded-md border border-line bg-canvas px-2 py-1 text-[12px] text-ink focus:border-brand pointer-coarse:min-h-11"
        >
          {/* An unknown category has no matching option, so the select would
              SHOW the first one while holding the bad id — and Approve would
              send that. The blank option makes the gap visible instead. */}
          <option value="">Pick a category…</option>
          {FAMILIES.map((fam) => (
            <optgroup key={fam.id} label={fam.label}>
              {CATEGORIES.filter((c) => c.family === fam.id).map((c) => (
                <option key={c.id} value={c.id}>{c.label}</option>
              ))}
            </optgroup>
          ))}
        </select>
        <span className="text-[11px] text-ink-muted">
          from {item.pipeline}
          {valid ? "" : " · pick a category first"}
        </span>
        <div className="ml-auto flex gap-1.5">
          <button disabled={busy} onClick={() => onDismiss(item.id)} className="min-h-8 rounded-md px-2.5 py-1 text-[12px] text-ink-muted transition hover:bg-panel-2 hover:text-ink pointer-coarse:min-h-11">
            Dismiss
          </button>
          <button
            disabled={busy || !valid}
            title={valid ? undefined : "Pick a category first"}
            onClick={() => onApprove(item.id, category)}
            className="inline-flex min-h-8 items-center gap-1 rounded-md bg-brand-2 px-2.5 py-1 text-[12px] font-semibold text-white transition hover:bg-brand-press active:scale-[0.98] disabled:opacity-40 pointer-coarse:min-h-11"
          >
            <Icon.Check width={12} height={12} aria-hidden="true" /> Approve
          </button>
        </div>
      </div>
    </li>
  );
}
