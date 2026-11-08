"use client";

// ---------------------------------------------------------------------------
// "Push to main" as a Deck widget.
//
// The card answers one question: what built, and is one tap away from being
// live? A finished client edit sits on a branch until someone merges it, and
// that is the step that used to mean opening GitHub on a phone. Here it is the
// same size as every other widget button, and it pushes the worktree's branch
// to main without touching the owner's checkout.
//
// The big buttons are deliberate: this is the one widget pressed one-handed on
// a phone after an approval, so the tap target is the row, not a pip.
// ---------------------------------------------------------------------------

import { useState } from "react";
import { Icon } from "../icons";
import type { ShipItem } from "@/lib/client-review/pushMain";
import type { UseShip } from "@/lib/client-review/useShip";
import { Widget, WidgetSheet, stop } from "./Widgets";

const SHOWN = 3;

/** The one button this widget exists for. */
function PushButton({
  item,
  ship,
  onSaid,
}: {
  item: ShipItem;
  ship: UseShip;
  onSaid: (message: string) => void;
}) {
  const busy = ship.pushing === item.versionId;
  const done = ship.pushed.has(item.versionId);
  if (!item.threadId) {
    return (
      <span className="shrink-0 rounded-lg border border-line px-2.5 py-2 text-[10.5px] leading-tight text-ink-faint">
        In Queue
      </span>
    );
  }
  return (
    <button
      type="button"
      disabled={busy || done}
      onClick={(e) => {
        stop(e);
        void ship.push(item).then(onSaid);
      }}
      className={`shrink-0 rounded-lg px-3 py-2 text-[12px] font-semibold transition ${
        done
          ? "bg-emerald-500/20 text-emerald-200"
          : "bg-emerald-500/85 text-black hover:bg-emerald-400 disabled:opacity-50"
      }`}
      title={`Merge ${item.name} ${item.version} into main and deploy it`}
    >
      {done ? "Pushed ✓" : busy ? "Pushing…" : "Push to main"}
    </button>
  );
}

function Row({ item, ship, onSaid }: { item: ShipItem; ship: UseShip; onSaid: (m: string) => void }) {
  return (
    <li className="flex items-center gap-2 rounded-lg border border-line-soft bg-panel-2/40 px-2 py-1.5">
      <div className="min-w-0 flex-1">
        <p className="truncate text-[13px] font-medium text-ink">{item.name}</p>
        <p className="truncate text-[10.5px] text-ink-faint">
          {item.version} · {item.threadId ? "built on your PC" : "waiting in In Queue"}
        </p>
      </div>
      <PushButton item={item} ship={ship} onSaid={onSaid} />
    </li>
  );
}

export function ShipWidget({ ship, onExpand }: { ship: UseShip; onExpand: () => void }) {
  const [said, setSaid] = useState("");
  const { items, loading, error } = ship;
  const waiting = items.filter((i) => !ship.pushed.has(i.versionId)).length;

  return (
    <Widget
      title="Push to main"
      icon="Upload"
      count={waiting}
      live={waiting > 0}
      onExpand={onExpand}
      status={said || (error ? error : waiting > 0 ? `${waiting} ready to go live` : undefined)}
    >
      {loading ? (
        <p className="py-6 text-center text-[11.5px] text-ink-faint">Checking what built…</p>
      ) : items.length === 0 ? (
        <p className="py-6 text-center text-[11.5px] text-ink-faint">
          Nothing waiting. Approve a client edit and its build lands here.
        </p>
      ) : (
        <ul className="space-y-1.5">
          {items.slice(0, SHOWN).map((item) => (
            <Row key={item.versionId} item={item} ship={ship} onSaid={setSaid} />
          ))}
        </ul>
      )}
      {items.length > SHOWN && (
        <p className="mt-1.5 text-center text-[10.5px] text-ink-faint">+{items.length - SHOWN} more — tap the card</p>
      )}
    </Widget>
  );
}

export function ShipExpanded({ ship, onClose }: { ship: UseShip; onClose: () => void }) {
  const [said, setSaid] = useState("");
  return (
    <WidgetSheet
      title="Push to main"
      kicker={`${ship.items.length} build${ship.items.length === 1 ? "" : "s"} waiting to go live`}
      onClose={onClose}
      actions={
        <a className="deck-btn inline-flex items-center gap-1" href="/apps/client-review">
          <Icon.Launch width={11} height={11} aria-hidden /> Open Client Review
        </a>
      }
    >
      <div className="space-y-2 p-1">
        {said && <p className="rounded-md bg-emerald-500/10 px-2 py-1.5 text-[11.5px] text-emerald-200">{said}</p>}
        {ship.error && <p className="rounded-md bg-amber-500/10 px-2 py-1.5 text-[11.5px] text-amber-200">{ship.error}</p>}
        {ship.items.length === 0 ? (
          <p className="py-10 text-center text-[12px] text-ink-muted">Nothing waiting to be pushed.</p>
        ) : (
          <ul className="space-y-2">
            {ship.items.map((item) => (
              <Row key={item.versionId} item={item} ship={ship} onSaid={setSaid} />
            ))}
          </ul>
        )}
        <p className="px-1 pt-2 text-[11px] leading-snug text-ink-faint">
          Pushing merges the build&apos;s branch into main and lets the host deploy it. The branch is brought up to date
          first, so this is never a force-push, and a conflict stops it rather than overwriting anything.
        </p>
      </div>
    </WidgetSheet>
  );
}
