"use client";

// ---------------------------------------------------------------------------
// The dashboard: the memory core, then a dense grid of what is actually known.
//
// Every panel states where its content came from and shows an honest empty
// state. Nothing here is generated — the AI-written daily brief arrives in
// stage 2, and until then the panels are a selection of stored records.
// ---------------------------------------------------------------------------

import { useMemo } from "react";
import { Icon } from "../icons";
import { MemoryCore, SOURCE_COLOR } from "./MemoryCore";
import { UpdatesPanel } from "./UpdatesPanel";
import type { TabId } from "./Jarvis";
import { briefInputs } from "@/lib/jarvis/brief";
import { graphNodes, linkCount } from "@/lib/jarvis/memoryClient";
import { SOURCE_LABEL, type JarvisStore } from "@/lib/jarvis/types";
import type { Profile } from "@/lib/new-dashboard/types";
import type { UpdatesApi } from "@/lib/jarvis/useUpdates";

const card = "rounded-xl border border-line bg-panel p-3";
const head = "mb-2 flex items-center gap-1.5 text-xs font-semibold text-ink";
const from = "mt-2 text-[10px] text-ink-faint";

function when(iso: string): string {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return "";
  const mins = Math.round((Date.now() - t) / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  if (mins < 1440) return `${Math.round(mins / 60)}h ago`;
  return `${Math.round(mins / 1440)}d ago`;
}

export function DashboardTab({
  profile,
  store,
  updates,
  go,
}: {
  profile: Profile | null;
  store: JarvisStore;
  /** The live feed, owned by the shell so its badge works from every tab. */
  updates: UpdatesApi;
  go: (t: TabId) => void;
}) {
  const nodes = useMemo(() => graphNodes(store), [store]);
  const links = useMemo(() => linkCount(nodes), [nodes]);
  const brief = useMemo(() => briefInputs(profile, store), [profile, store]);

  const today = new Date().toLocaleDateString(undefined, {
    weekday: "long",
    day: "numeric",
    month: "long",
  });

  const sourceCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const m of store.memories) counts.set(m.source, (counts.get(m.source) ?? 0) + 1);
    return [...counts.entries()].sort((a, b) => b[1] - a[1]);
  }, [store.memories]);

  return (
    <div className="p-3 sm:p-4">
      <section className="relative overflow-hidden rounded-xl border border-line bg-black">
        <MemoryCore nodes={nodes} className="h-56 w-full sm:h-72" />
        <div className="pointer-events-none absolute inset-x-0 bottom-0 flex flex-wrap items-end justify-between gap-2 p-3">
          <div>
            <p className="text-[11px] uppercase tracking-[0.2em] text-ink-faint">memory core</p>
            <p className="text-sm text-ink">
              {store.memories.length.toLocaleString()} memories · {links.toLocaleString()} links
            </p>
          </div>
          <button
            className="pointer-events-auto rounded-lg border border-line bg-panel/80 px-2.5 py-1.5 text-xs text-ink-muted backdrop-blur transition hover:text-ink"
            onClick={() => go("memory")}
          >
            Open memory
          </button>
        </div>
      </section>

      <UpdatesPanel api={updates} go={go} />

      <div className="mt-3 grid gap-3 lg:grid-cols-3">
        <div className={card}>
          <h2 className={head}>
            <Icon.Target width={13} height={13} /> Today · {today}
          </h2>
          {brief.openPriorities.length === 0 && brief.donePriorities.length === 0 ? (
            <p className="text-xs text-ink-muted">
              No priorities saved yet.{" "}
              <button className="underline" onClick={() => go("profile")}>
                Add them in Profile
              </button>
              .
            </p>
          ) : (
            <ul className="space-y-1.5">
              {(profile?.intake.q3 ?? []).map((text, i) =>
                text.trim() ? (
                  <li key={i} className="flex items-start gap-2 text-xs">
                    <input
                      type="checkbox"
                      className="mt-0.5"
                      checked={brief.donePriorities.includes(i)}
                      onChange={() => {
                        // Priorities live on the profile, which Jarvis does not
                        // own; the Profile tab writes them. Here we only reflect
                        // them, so the toggle sends the owner there.
                        go("profile");
                      }}
                      aria-label={`Mark priority ${i + 1} done in Profile`}
                    />
                    <span className={brief.donePriorities.includes(i) ? "text-ink-faint line-through" : "text-ink"}>
                      {text}
                    </span>
                  </li>
                ) : null,
              )}
            </ul>
          )}
          <p className={from}>from your profile · 90-day priorities</p>
        </div>

        <div className={card}>
          <h2 className={head}>
            <Icon.Calendar width={13} height={13} /> Next up
          </h2>
          {brief.nextEvents.length === 0 ? (
            <p className="text-xs text-ink-muted">
              No calendar connected, and no events entered. Jarvis will not guess you are free.
            </p>
          ) : (
            <ul className="space-y-1.5 text-xs">
              {brief.nextEvents.map((e) => (
                <li key={e.id} className="flex items-baseline gap-2">
                  <span className="font-mono text-[11px] text-ink-faint">{e.start || "all day"}</span>
                  <span className="text-ink">{e.title}</span>
                </li>
              ))}
            </ul>
          )}
          <p className={from}>
            {brief.nextEvents.length ? "from your calendar" : "connect a calendar in the Calendar tab"}
          </p>
        </div>

        <div className={card}>
          <h2 className={head}>
            <Icon.Inbox width={13} height={13} /> Inbox
          </h2>
          {brief.unread.length === 0 ? (
            <p className="text-xs text-ink-muted">Nothing here yet — no mailbox is connected.</p>
          ) : (
            <ul className="space-y-1.5 text-xs">
              {brief.unread.slice(0, 3).map((m) => (
                <li key={m.id} className="truncate text-ink">
                  <span className="text-ink-faint">{m.from}</span> · {m.subject}
                </li>
              ))}
            </ul>
          )}
          <p className={from}>
            {brief.unread.length ? `${brief.unread.length} unread` : "connect a mailbox in the Inbox tab"}
          </p>
        </div>

        <div className={`${card} lg:col-span-2`}>
          <h2 className={head}>
            <Icon.Clock width={13} height={13} /> Recent memories
          </h2>
          {brief.recentMemories.length === 0 ? (
            <p className="text-xs text-ink-muted">
              Nothing remembered yet. Write a note in Memory, or sync your master folder there.
            </p>
          ) : (
            <ul className="divide-y divide-line-soft text-xs">
              {brief.recentMemories.map((m) => (
                <li key={m.id} className="flex items-baseline gap-2 py-1.5">
                  <span
                    className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full"
                    style={{ background: SOURCE_COLOR[m.source] }}
                    aria-hidden
                  />
                  <span className="min-w-0 flex-1 truncate text-ink">{m.title}</span>
                  <span className="shrink-0 text-[10px] text-ink-faint">
                    {SOURCE_LABEL[m.source]} · {when(m.capturedAt)}
                  </span>
                </li>
              ))}
            </ul>
          )}
          <p className={from}>from local memory on this device</p>
        </div>

        <div className={card}>
          <h2 className={head}>
            <Icon.Database width={13} height={13} /> Sources
          </h2>
          {sourceCounts.length === 0 ? (
            <p className="text-xs text-ink-muted">No sources yet.</p>
          ) : (
            <ul className="space-y-1 text-xs">
              {sourceCounts.map(([source, n]) => (
                <li key={source} className="flex items-center gap-2">
                  <span
                    className="h-1.5 w-1.5 rounded-full"
                    style={{ background: SOURCE_COLOR[source as keyof typeof SOURCE_COLOR] }}
                    aria-hidden
                  />
                  <span className="flex-1 text-ink-muted">{SOURCE_LABEL[source as keyof typeof SOURCE_LABEL]}</span>
                  <span className="font-mono text-ink">{n}</span>
                </li>
              ))}
            </ul>
          )}
          <p className={from}>the colours in the ball above</p>
        </div>
      </div>

      {brief.empty && updates.updates.length === 0 && (
        <p className="mt-3 text-[11px] text-ink-faint">
          Jarvis knows nothing yet, so he is showing nothing. That is deliberate — he will never
          invent meetings, messages or progress.
        </p>
      )}
    </div>
  );
}
