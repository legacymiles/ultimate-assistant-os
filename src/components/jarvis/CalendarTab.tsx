"use client";

// ---------------------------------------------------------------------------
// The calendar: a month grid and the selected day.
//
// Events come from the connected calendar when there is one, and from what the
// owner typed when there isn't — and the header always says which, because a
// calendar that looks empty must never be mistaken for a free week.
// Every change goes through the confirm card.
// ---------------------------------------------------------------------------

import { useCallback, useEffect, useMemo, useState } from "react";
import { Icon } from "../icons";
import { ConfirmCard } from "./ConfirmCard";
import { localDate, overlaps } from "@/lib/jarvis/brief";
import { uid } from "@/lib/jarvis/store";
import type { CalEvent, JarvisStore, PendingAction } from "@/lib/jarvis/types";

const btn =
  "inline-flex items-center gap-1.5 rounded-lg border border-line px-2.5 py-1.5 text-xs font-medium text-ink-muted transition hover:bg-panel-2 hover:text-ink disabled:opacity-50";
const field =
  "w-full rounded-md border border-line bg-panel-2 px-2 py-1.5 text-xs text-ink placeholder:text-ink-faint focus:border-ink-faint focus:outline-none";

/** The six-week grid a month view needs, Monday first. */
function monthGrid(year: number, month: number): Date[] {
  const first = new Date(year, month, 1);
  const start = new Date(first);
  start.setDate(first.getDate() - ((first.getDay() + 6) % 7));
  return Array.from({ length: 42 }, (_, i) => {
    const d = new Date(start);
    d.setDate(start.getDate() + i);
    return d;
  });
}

export function CalendarTab({ store, commit }: { store: JarvisStore; commit: (s: JarvisStore) => void }) {
  const today = new Date();
  const [cursor, setCursor] = useState({ y: today.getFullYear(), m: today.getMonth() });
  const [selected, setSelected] = useState(localDate(today));
  const [remote, setRemote] = useState<CalEvent[] | null>(null);
  const [apps, setApps] = useState<{ slug: string; name: string }[]>([]);
  const [note, setNote] = useState("");
  const [loading, setLoading] = useState(false);
  const [pending, setPending] = useState<PendingAction | null>(null);
  const [busy, setBusy] = useState(false);
  const [draft, setDraft] = useState({ title: "", date: localDate(today), start: "10:00", end: "11:00", where: "" });

  const grid = useMemo(() => monthGrid(cursor.y, cursor.m), [cursor]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const from = localDate(grid[0]);
      const to = localDate(grid[41]);
      const res = await fetch(`/api/jarvis/calendar?from=${from}&to=${to}`);
      const data = (await res.json()) as {
        available: boolean;
        reason?: string;
        note?: string;
        failures?: string[];
        apps?: { slug: string; name: string }[];
        events?: CalEvent[];
      };
      setApps(data.apps ?? []);
      if (!data.available || !(data.apps ?? []).length) {
        setRemote(null);
        setNote(data.reason ?? data.note ?? "");
      } else {
        setRemote(data.events ?? []);
        setNote([...(data.failures ?? [])].join(" · "));
      }
    } catch {
      setRemote(null);
      setNote("Couldn't reach your calendar.");
    } finally {
      setLoading(false);
    }
  }, [grid]);

  useEffect(() => {
    void load();
  }, [load]);

  const events = useMemo<CalEvent[]>(() => [...(remote ?? []), ...store.events], [remote, store.events]);
  const clashes = useMemo(() => new Set(overlaps(events).flat()), [events]);
  const byDay = useMemo(() => {
    const map = new Map<string, CalEvent[]>();
    for (const e of events) {
      const list = map.get(e.date) ?? [];
      list.push(e);
      map.set(e.date, list);
    }
    for (const list of map.values()) list.sort((a, b) => (a.start || "").localeCompare(b.start || ""));
    return map;
  }, [events]);

  const addManual = () => {
    if (!draft.title.trim()) return;
    const event: CalEvent = {
      id: uid(),
      title: draft.title.trim(),
      date: draft.date,
      start: draft.start,
      end: draft.end,
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      where: draft.where || undefined,
      app: "manual",
    };
    commit({ ...store, events: [...store.events, event] });
    setDraft({ ...draft, title: "", where: "" });
  };

  const prepareRemoteAdd = () => {
    if (!draft.title.trim()) return;
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    setPending({
      id: uid(),
      tool: "googlecalendar.create_event",
      app: "googlecalendar",
      summary: `Add "${draft.title}" to your calendar on ${draft.date} at ${draft.start}.`,
      args: {
        summary: draft.title,
        title: draft.title,
        start_datetime: `${draft.date}T${draft.start}:00`,
        end_datetime: `${draft.date}T${draft.end}:00`,
        timezone: tz,
        location: draft.where || undefined,
      },
      createdAt: new Date().toISOString(),
      status: "pending",
    });
  };

  const runPending = async (args: Record<string, unknown>) => {
    if (!pending) return;
    setBusy(true);
    try {
      const res = await fetch("/api/jarvis/action", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tool: pending.tool, args, confirmed: true }),
      });
      const data = (await res.json()) as { ok?: boolean; error?: string };
      if (data.ok) {
        setPending({ ...pending, status: "done", result: "Added to your calendar." });
        setDraft({ ...draft, title: "", where: "" });
        await load();
      } else {
        setPending({ ...pending, status: "failed", error: data.error ?? "It failed." });
      }
    } finally {
      setBusy(false);
    }
  };

  const monthName = new Date(cursor.y, cursor.m, 1).toLocaleDateString(undefined, {
    month: "long",
    year: "numeric",
  });
  const dayEvents = byDay.get(selected) ?? [];

  return (
    <div className="p-3 sm:p-4">
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <h2 className="text-xs font-semibold text-ink">{monthName}</h2>
        <button className={btn} onClick={() => setCursor((c) => (c.m === 0 ? { y: c.y - 1, m: 11 } : { ...c, m: c.m - 1 }))}>
          ‹
        </button>
        <button className={btn} onClick={() => setCursor((c) => (c.m === 11 ? { y: c.y + 1, m: 0 } : { ...c, m: c.m + 1 }))}>
          ›
        </button>
        <button
          className={btn}
          onClick={() => {
            setCursor({ y: today.getFullYear(), m: today.getMonth() });
            setSelected(localDate(today));
          }}
        >
          Today
        </button>
        <span className="text-[11px] text-ink-faint">
          {loading
            ? "Reading your calendar…"
            : apps.length
              ? `${apps.map((a) => a.name).join(", ")} connected${store.events.length ? " · plus your manual events" : ""}`
              : "Manually maintained — no calendar is connected, so this is not proof you are free."}
        </span>
        <button className={`${btn} ml-auto`} onClick={() => void load()} disabled={loading}>
          <Icon.Refresh width={13} height={13} /> Refresh
        </button>
      </div>
      {note && <p className="mb-2 text-[11px] text-ink-muted">{note}</p>}

      <div className="grid gap-3 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <section className="overflow-hidden rounded-xl border border-line bg-panel">
          <div className="grid grid-cols-7 border-b border-line text-center text-[10px] uppercase tracking-wide text-ink-faint">
            {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((d) => (
              <span key={d} className="py-1">
                {d}
              </span>
            ))}
          </div>
          <div className="grid grid-cols-7">
            {grid.map((d) => {
              const iso = localDate(d);
              const list = byDay.get(iso) ?? [];
              const otherMonth = d.getMonth() !== cursor.m;
              const isToday = iso === localDate(today);
              return (
                <button
                  key={iso}
                  onClick={() => setSelected(iso)}
                  className={`min-h-[64px] border-b border-r border-line-soft p-1 text-left align-top transition hover:bg-panel-2 ${
                    selected === iso ? "bg-panel-2" : ""
                  } ${otherMonth ? "opacity-40" : ""}`}
                >
                  <span
                    className={`text-[11px] ${isToday ? "rounded bg-sky-500/20 px-1 text-sky-200" : "text-ink-muted"}`}
                  >
                    {d.getDate()}
                  </span>
                  <span className="mt-0.5 block space-y-0.5">
                    {list.slice(0, 3).map((e) => (
                      <span
                        key={e.id}
                        className={`block truncate rounded px-1 text-[10px] ${
                          clashes.has(e.id) ? "bg-amber-500/20 text-amber-200" : "bg-panel-2 text-ink-muted"
                        }`}
                      >
                        {e.start || "•"} {e.title}
                      </span>
                    ))}
                    {list.length > 3 && (
                      <span className="block px-1 text-[10px] text-ink-faint">+{list.length - 3} more</span>
                    )}
                  </span>
                </button>
              );
            })}
          </div>
        </section>

        <section className="space-y-3">
          <div className="rounded-xl border border-line bg-panel p-3">
            <h3 className="mb-1.5 text-xs font-semibold text-ink">
              {new Date(`${selected}T12:00:00`).toLocaleDateString(undefined, {
                weekday: "long",
                day: "numeric",
                month: "long",
              })}
            </h3>
            {dayEvents.length === 0 ? (
              <p className="text-xs text-ink-muted">Nothing entered for this day.</p>
            ) : (
              <ul className="space-y-1.5">
                {dayEvents.map((e) => (
                  <li key={e.id} className="flex items-start gap-2 text-xs">
                    <span className="w-20 shrink-0 font-mono text-[11px] text-ink-faint">
                      {e.start ? `${e.start}–${e.end}` : "all day"}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-ink">{e.title}</span>
                      {e.where && <span className="block text-[10px] text-ink-faint">{e.where}</span>}
                      <span className="block text-[10px] text-ink-faint">
                        {e.app === "manual" ? "entered by you" : e.app}
                        {clashes.has(e.id) ? " · overlaps another event" : ""}
                      </span>
                    </span>
                    {e.app === "manual" && (
                      <button
                        onClick={() => commit({ ...store, events: store.events.filter((x) => x.id !== e.id) })}
                        aria-label={`Delete ${e.title}`}
                        className="shrink-0 text-ink-faint hover:text-ink"
                      >
                        <Icon.Trash width={12} height={12} />
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="rounded-xl border border-line bg-panel p-3">
            <h3 className="mb-2 text-xs font-semibold text-ink">New event</h3>
            <input
              value={draft.title}
              onChange={(e) => setDraft({ ...draft, title: e.target.value })}
              placeholder="What is it?"
              className={field}
            />
            <div className="mt-2 grid grid-cols-3 gap-2">
              <input type="date" value={draft.date} onChange={(e) => setDraft({ ...draft, date: e.target.value })} className={field} />
              <input type="time" value={draft.start} onChange={(e) => setDraft({ ...draft, start: e.target.value })} className={field} />
              <input type="time" value={draft.end} onChange={(e) => setDraft({ ...draft, end: e.target.value })} className={field} />
            </div>
            <input
              value={draft.where}
              onChange={(e) => setDraft({ ...draft, where: e.target.value })}
              placeholder="Where (optional)"
              className={`${field} mt-2`}
            />
            <div className="mt-2 flex flex-wrap gap-2">
              <button className={btn} onClick={addManual} disabled={!draft.title.trim()}>
                <Icon.Plus width={13} height={13} /> Add here only
              </button>
              <button className={btn} onClick={prepareRemoteAdd} disabled={!draft.title.trim() || !apps.length}>
                <Icon.Calendar width={13} height={13} /> Add to my real calendar
              </button>
            </div>
            {!apps.length && (
              <p className="mt-1.5 text-[10px] text-ink-faint">
                Connect Google Calendar to put events in the calendar you actually use.
              </p>
            )}
          </div>

          {pending && (
            <ConfirmCard
              action={pending}
              busy={busy}
              onConfirm={(args) => void runPending(args)}
              onCancel={() => setPending({ ...pending, status: "cancelled" })}
            />
          )}
        </section>
      </div>
    </div>
  );
}
