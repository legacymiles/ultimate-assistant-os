"use client";

// ---------------------------------------------------------------------------
// Profile › Connections — every key Jarvis can use, in one place, each with a
// step-by-step guide whose buttons open the exact page (Google's three pages,
// OpenRouter's credits page…), a paste box, and "Jarvis, do it".
//
// Onboarding asks only the handful that matter on day one; this is the full
// list, for later. Reached from Profile, and by link: /apps/jarvis#connections
// or #connections/<capability> (the YouTube videos app links here).
// ---------------------------------------------------------------------------

import { useEffect, useMemo, useState } from "react";
import { Icon } from "../icons";
import { KeyRowView, type OnboardingBridge } from "./Onboarding";
import { CATEGORY_LABEL, type Category } from "@/lib/armory/catalog";
import { agentTaskForKeys, connectionRows } from "@/lib/new-jarvis/keySetup";
import type { SetupStatus } from "@/lib/new-jarvis/useSetup";

/** Ask the Dashboard to show Profile › Connections, optionally opening one row. */
export const OPEN_CONNECTIONS = "jarvis:open-connections";
/** Held until the Dashboard mounts, for a link that arrives before it does. */
let pending: { capability: string | null } | null = null;
export function openConnections(capability?: string) {
  pending = { capability: capability ?? null };
  window.dispatchEvent(new CustomEvent(OPEN_CONNECTIONS, { detail: capability ?? null }));
}
/** The Dashboard takes a waiting request on mount (and on each event). */
export function takePendingConnections(): { capability: string | null } | null {
  const p = pending;
  pending = null;
  return p;
}

export function Connections({
  setup,
  bridge,
  ask,
  focus,
}: {
  setup: SetupStatus;
  bridge: OnboardingBridge;
  ask: (task: string) => void;
  /** A capability to open on arrival. */
  focus?: string | null;
}) {
  const rows = useMemo(() => (setup.keys ? connectionRows(setup.keys) : []), [setup.keys]);
  const [open, setOpen] = useState<string | null>(focus ?? null);
  useEffect(() => {
    if (!focus) return;
    setOpen(focus);
    requestAnimationFrame(() => document.getElementById(`conn-${focus}`)?.scrollIntoView({ block: "center", behavior: "smooth" }));
  }, [focus]);

  if (!setup.keys) return <p className="p-4 text-[12px] text-ink-muted">Checking which connections are set…</p>;

  const live = rows.filter((r) => r.reading.status === "live").length;
  const missingKeys = [...new Set(rows.filter((r) => r.reading.status !== "live").flatMap((r) => r.ask))];
  const groups = new Map<Category, typeof rows>();
  for (const r of rows) groups.set(r.capability.category, [...(groups.get(r.capability.category) ?? []), r]);

  return (
    <div className="space-y-4 p-3 sm:p-4">
      <header className="flex flex-wrap items-end gap-3">
        <div className="min-w-0 flex-1">
          <p className="deck-kicker">
            {live} of {rows.length} working
          </p>
          <h2 className="deck-display text-[18px] font-semibold text-ink">Connections</h2>
          <p className="mt-0.5 max-w-[60ch] text-[12px] text-ink-muted">
            Each one switches on a feature. Tap <b className="text-ink">Show me how</b>: every step has a button that opens the exact page, then paste the key here. Most are free.
          </p>
        </div>
        {missingKeys.length > 1 && (
          <button type="button" className="deck-btn deck-btn--go" onClick={() => ask(agentTaskForKeys(missingKeys))}>
            <Icon.Bot width={12} height={12} className="mr-1 inline" aria-hidden />
            Jarvis, set them all up
          </button>
        )}
        <button type="button" className="deck-btn" onClick={setup.refresh}>
          <Icon.Refresh width={12} height={12} className="mr-1 inline" aria-hidden />
          Check again
        </button>
      </header>

      {[...groups.entries()].map(([cat, list]) => (
        <section key={cat} aria-label={CATEGORY_LABEL[cat]}>
          <h3 className="mb-1.5 font-mono text-[10px] uppercase tracking-[0.14em] text-ink-faint">{CATEGORY_LABEL[cat]}</h3>
          <ul className="divide-y divide-line-soft rounded-lg border border-line bg-[color-mix(in_oklab,var(--color-panel)_70%,transparent)]">
            {list.map((r) => (
                <KeyRowView
                  key={r.capability.id}
                  anchor={`conn-${r.capability.id}`}
                  row={r}
                  open={open === r.capability.id}
                  onToggle={() => setOpen(open === r.capability.id ? null : r.capability.id)}
                  bridge={bridge}
                  onSaved={setup.refresh}
                  onHandOff={ask}
                />
            ))}
          </ul>
        </section>
      ))}

      <p className="text-[11px] leading-relaxed text-ink-faint">
        Pasted keys go straight to your PC&apos;s .env.local (never to the AI) and are copied for Vercel. A new key shows as working after the site restarts or redeploys.
        {setup.connectors?.connectUrl ? " Apps like Gmail and Calendar connect in Settings › Connected apps." : ""}
      </p>
    </div>
  );
}
