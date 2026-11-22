"use client";

// ---------------------------------------------------------------------------
// The calendar: a month grid and the selected day.
//
// Events come from the connected calendar when there is one, and from what the
// owner typed when there isn't — and the header always says which, because a
// calendar that looks empty must never be mistaken for a free week.
// Every change to the connected calendar goes through the confirm card.
//
// "Add here" writes to the Dashboard calendar (it moved into Jarvis), because
// that is the calendar with reminders, .ics export and events read off photos.
// Older hand-typed Jarvis events still show and can still be deleted.
// ---------------------------------------------------------------------------

import { useCallback, useEffect, useMemo, useState } from "react";
import { Icon } from "../icons";
import { ConfirmCard } from "./ConfirmCard";
import { BillsPanel, type ShowFilter } from "./BillsPanel";
import { EventDialog } from "../recall/calendar/EventDialog";
import {
  createEvent,
  deleteEvent,
  downloadIcs,
  getEvents,
  updateEvent,
  type EventInput,
} from "@/lib/recall/calendar/store";
import {
  notificationPermission,
  notificationsAvailable,
  requestNotifications,
} from "@/lib/recall/calendar/reminders";
import { REMINDER_CHOICES, type CalendarEvent } from "@/lib/recall/calendar/types";
import { toCalEvent } from "@/lib/jarvis/useDashboardCalendar";
import { localDate, overlaps } from "@/lib/jarvis/brief";
import { uid } from "@/lib/jarvis/store";
import type { CalEvent, JarvisStore, PendingAction } from "@/lib/jarvis/types";
import { useBirthdays } from "@/lib/birthdays/store";
import { birthdayEvents } from "@/lib/birthdays/engine";
import { useBills } from "@/lib/bills/useBills";
import {
  billsByDay,
  dueBills,
  filterByOwner,
  money,
  moneyShort,
  sortDueBills,
  whenLabel,
  type OwnerFilter,
} from "@/lib/bills/view";
import type { DueBill, SortMode } from "@/lib/bills/types";
import { key, lastDayOfMonth } from "@/lib/finance/dates";

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

const ORIGIN: Record<string, string> = {
  manual: "entered by you",
  photo: "read off a photo",
  agent: "added by Jarvis",
};

export function CalendarTab({
  store,
  commit,
  dashboard,
  onDashboard,
  onBirthdays,
}: {
  store: JarvisStore;
  commit: (s: JarvisStore) => void;
  /** The Dashboard calendar, the one with reminders. Owned by the shell. */
  dashboard: CalendarEvent[];
  onDashboard: (events: CalendarEvent[]) => void;
  /** Open the Birthdays sheet (family & friends). */
  onBirthdays?: () => void;
}) {
  const today = new Date();
  const todayIso = localDate(today);
  const [cursor, setCursor] = useState({ y: today.getFullYear(), m: today.getMonth() });
  const [selected, setSelected] = useState(localDate(today));
  /** Month grid, or the bills ledger. Both read the same month. */
  const [view, setView] = useState<"month" | "bills">("month");
  const [owner, setOwner] = useState<OwnerFilter>("all");
  const [sort, setSort] = useState<SortMode>("due");
  const [show, setShow] = useState<ShowFilter>("all");
  const [remote, setRemote] = useState<CalEvent[] | null>(null);
  const [apps, setApps] = useState<{ slug: string; name: string }[]>([]);
  const [note, setNote] = useState("");
  const [loading, setLoading] = useState(false);
  const [pending, setPending] = useState<PendingAction | null>(null);
  const [busy, setBusy] = useState(false);
  const [draft, setDraft] = useState({
    title: "",
    date: localDate(today),
    start: "10:00",
    end: "11:00",
    where: "",
    remind: 1440,
  });
  const [editing, setEditing] = useState<CalendarEvent | null>(null);
  const [perm, setPerm] = useState<string>("default");

  // Photos and the folder assistant can add events while this tab is closed,
  // so re-read on open rather than trusting the shell's copy.
  useEffect(() => {
    onDashboard(getEvents());
    setPerm(notificationPermission());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const dashById = useMemo(() => new Map(dashboard.map((e) => [e.id, e])), [dashboard]);

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

  // Family & friends' birthdays, every year, derived from the one list — never
  // copied into a calendar store, so editing a birthday moves every year of it.
  const birthdays = useBirthdays().list;
  const bdayEvents = useMemo<CalEvent[]>(
    () =>
      birthdayEvents(birthdays, grid[0], grid[41]).map((b) => ({
        id: b.id,
        title: b.title,
        date: b.date,
        start: "",
        end: "",
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        notes: b.notes,
        app: "birthday",
      })),
    [birthdays, grid],
  );

  const events = useMemo<CalEvent[]>(
    () => [...bdayEvents, ...(remote ?? []), ...store.events, ...dashboard.map(toCalEvent)],
    [bdayEvents, remote, store.events, dashboard],
  );
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

  // --- bills ---------------------------------------------------------------
  // Read, not copied: most of these live in the Profiles app, so a bill added
  // to a profile is on this tab the next time it is opened, with no sync step.
  const bills = useBills(todayIso);
  const month = useMemo(
    () => ({
      from: key(cursor.y, cursor.m + 1, 1),
      to: key(cursor.y, cursor.m + 1, lastDayOfMonth(cursor.y, cursor.m + 1)),
    }),
    [cursor],
  );
  /** The month's bills before the profile filter — what the pills count. */
  const monthAll = useMemo(
    () => dueBills(bills.bills, month.from, month.to, bills.data.paid, todayIso),
    [bills.bills, bills.data.paid, month, todayIso],
  );
  const monthList = useMemo(() => {
    let list = filterByOwner(monthAll, owner);
    if (show === "unpaid") list = list.filter((d) => !d.paid);
    if (show === "late") list = list.filter((d) => d.overdue);
    return sortDueBills(list, sort);
  }, [monthAll, owner, show, sort]);
  /** The whole six-week grid, so the cells either side of the month are right. */
  const billDays = useMemo(
    () =>
      billsByDay(
        filterByOwner(
          dueBills(bills.bills, localDate(grid[0]), localDate(grid[41]), bills.data.paid, todayIso),
          owner,
        ),
      ),
    [bills.bills, bills.data.paid, grid, owner, todayIso],
  );

  const addManual = () => {
    if (!draft.title.trim()) return;
    const { events: next } = createEvent({
      title: draft.title,
      date: draft.date,
      time: draft.start || null,
      endTime: draft.end || null,
      location: draft.where,
      reminders: draft.remind >= 0 ? [draft.remind] : [],
      source: "manual",
    });
    onDashboard(next);
    setDraft({ ...draft, title: "", where: "" });
  };

  const saveEdit = (input: EventInput) => {
    if (!editing) return;
    onDashboard(updateEvent(editing.id, input));
    setEditing(null);
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
        <span className="inline-flex overflow-hidden rounded-lg border border-line" role="tablist" aria-label="Calendar view">
          {(["month", "bills"] as const).map((v) => (
            <button
              key={v}
              role="tab"
              aria-selected={view === v}
              onClick={() => setView(v)}
              className={`px-3 py-1.5 text-xs font-semibold capitalize transition ${
                view === v ? "bg-panel-2 text-ink" : "text-ink-faint hover:text-ink"
              } ${v === "bills" ? "border-l border-line" : ""}`}
            >
              {v}
              {v === "bills" && monthAll.length > 0 ? ` (${monthAll.length})` : ""}
            </button>
          ))}
        </span>
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
          {view === "bills"
            ? "Every bill Jarvis knows about — the ones filed in a profile keep themselves current"
            : loading
            ? "Reading your calendar…"
            : apps.length
              ? `${apps.map((a) => a.name).join(", ")} connected${dashboard.length || store.events.length ? " · plus your own events" : ""}`
              : "Manually maintained — no calendar is connected, so this is not proof you are free."}
        </span>
        <span className="ml-auto flex flex-wrap gap-2">
          {notificationsAvailable() && perm === "default" && (
            <button
              className={btn}
              onClick={() => void requestNotifications().then((p) => setPerm(p))}
              title="Let reminders pop up even when this tab is in the background"
            >
              <Icon.Clock width={13} height={13} /> Turn on reminders
            </button>
          )}
          <button
            className={btn}
            onClick={() => downloadIcs(dashboard, "jarvis-calendar.ics")}
            disabled={!dashboard.length}
            title="Download your events as an .ics file for your phone's calendar, so it rings even when Jarvis is closed"
          >
            <Icon.Download width={13} height={13} /> Export .ics
          </button>
          {onBirthdays && (
            <button className={btn} onClick={onBirthdays} title="Family & friends' birthdays — they show here every year and notify 2 days before">
              <Icon.Users width={13} height={13} /> Birthdays{birthdays.length ? ` (${birthdays.length})` : ""}
            </button>
          )}
          <button className={btn} onClick={() => void load()} disabled={loading}>
            <Icon.Refresh width={13} height={13} /> Refresh
          </button>
        </span>
      </div>
      {note && <p className="mb-2 text-[11px] text-ink-muted">{note}</p>}

      {view === "bills" && (
        <>
          <BillsPanel
            store={bills}
            month={month}
            monthLabel={new Date(cursor.y, cursor.m, 1).toLocaleDateString(undefined, { month: "long" })}
            list={monthList}
            all={monthAll}
            owner={owner}
            onOwner={setOwner}
            sort={sort}
            onSort={setSort}
            show={show}
            onShow={setShow}
          />
          <section className="mt-3 overflow-hidden rounded-xl border border-line bg-panel">
            <MonthGrid
              grid={grid}
              cursorMonth={cursor.m}
              today={localDate(today)}
              selected={selected}
              onSelect={(iso) => {
                setSelected(iso);
                setView("month");
              }}
              byDay={byDay}
              clashes={clashes}
              billDays={billDays}
              compact
            />
          </section>
        </>
      )}

      <div
        className={`grid gap-3 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)] ${view === "bills" ? "hidden" : ""}`}
      >
        <section className="overflow-hidden rounded-xl border border-line bg-panel">
          <MonthGrid
            grid={grid}
            cursorMonth={cursor.m}
            today={localDate(today)}
            selected={selected}
            onSelect={setSelected}
            byDay={byDay}
            clashes={clashes}
            billDays={billDays}
          />
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
                      {e.notes && <span className="block text-[10px] text-ink-muted">{e.notes}</span>}
                      <span className="block text-[10px] text-ink-faint">
                        {e.app === "dashboard"
                          ? ORIGIN[dashById.get(e.id)?.source ?? "manual"]
                          : e.app === "manual"
                            ? "entered by you"
                            : e.app === "birthday"
                              ? "birthday · notifies 2 days before"
                              : e.app}
                        {e.app === "dashboard" && (dashById.get(e.id)?.reminders.length ?? 0) > 0
                          ? " · reminder on"
                          : ""}
                        {clashes.has(e.id) ? " · overlaps another event" : ""}
                      </span>
                    </span>
                    {e.app === "dashboard" && (
                      <button
                        onClick={() => setEditing(dashById.get(e.id) ?? null)}
                        aria-label={`Edit ${e.title}`}
                        className="shrink-0 text-ink-faint hover:text-ink"
                      >
                        <Icon.Edit width={12} height={12} />
                      </button>
                    )}
                    {e.app === "birthday" && onBirthdays && (
                      <button
                        onClick={onBirthdays}
                        aria-label={`Edit birthdays`}
                        className="shrink-0 text-ink-faint hover:text-ink"
                      >
                        <Icon.Edit width={12} height={12} />
                      </button>
                    )}
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
            {(billDays.get(selected)?.length ?? 0) > 0 && (
              <div className="mt-2.5 border-t border-line-soft pt-2.5">
                <h4 className="mb-1.5 text-[10px] uppercase tracking-[0.08em] text-ink-faint">
                  Bills due
                </h4>
                <ul className="space-y-1">
                  {(billDays.get(selected) ?? []).map((d) => (
                    <li key={`${d.bill.id}-${d.due}`} className="flex items-center gap-2 text-xs">
                      <span
                        aria-hidden
                        className={`h-2 w-2 shrink-0 rounded-full ${
                          d.paid ? "bg-green-500" : d.overdue ? "bg-rose-500" : "bg-ink-faint"
                        }`}
                      />
                      <span className="min-w-0 flex-1 truncate text-ink">{d.bill.name}</span>
                      <span className="shrink-0 tabular-nums text-ink-muted">
                        {money(d.amount, d.bill.currency)}
                      </span>
                    </li>
                  ))}
                </ul>
                <button className={`${btn} mt-2`} onClick={() => setView("bills")}>
                  Open bills
                </button>
              </div>
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
            <select
              value={draft.remind}
              onChange={(e) => setDraft({ ...draft, remind: Number(e.target.value) })}
              aria-label="Reminder"
              className={`${field} mt-2`}
            >
              <option value={-1}>No reminder</option>
              {REMINDER_CHOICES.map((r) => (
                <option key={r.minutes} value={r.minutes}>
                  Remind me {r.label}
                </option>
              ))}
            </select>
            <div className="mt-2 flex flex-wrap gap-2">
              <button className={btn} onClick={addManual} disabled={!draft.title.trim()}>
                <Icon.Plus width={13} height={13} /> Add here
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

          {editing && (
            <EventDialog
              initial={editing}
              onSubmit={saveEdit}
              onDelete={() => {
                onDashboard(deleteEvent(editing.id));
                setEditing(null);
              }}
              onClose={() => setEditing(null)}
            />
          )}

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

/**
 * The month, once, used by both views: the grid in Month and the strip under
 * the ledger in Bills. Days carry their events and, under them, a chip per
 * state of money — paid, late, still coming — so a day with a bill reads as
 * one at a glance without opening anything.
 */
function MonthGrid({
  grid,
  cursorMonth,
  today,
  selected,
  onSelect,
  byDay,
  clashes,
  billDays,
  compact,
}: {
  grid: Date[];
  cursorMonth: number;
  today: string;
  selected: string;
  onSelect: (iso: string) => void;
  byDay: Map<string, CalEvent[]>;
  clashes: Set<string>;
  billDays: Map<string, DueBill[]>;
  compact?: boolean;
}) {
  return (
    <>
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
          const due = billDays.get(iso) ?? [];
          const otherMonth = d.getMonth() !== cursorMonth;
          const isToday = iso === today;
          // One chip per state, with that state's total: three small marks at
          // most, however many bills land on the day.
          const groups: { key: string; total: number; cls: string; title: string }[] = [];
          const add = (key: string, rows: DueBill[], cls: string, title: string) => {
            if (!rows.length) return;
            groups.push({
              key,
              total: rows.reduce((n, r) => n + r.amount, 0),
              cls,
              title: `${rows.map((r) => r.bill.name).join(", ")} — ${title}`,
            });
          };
          add("paid", due.filter((r) => r.paid), "bg-green-500/15 text-green-300", "paid");
          add("late", due.filter((r) => !r.paid && r.overdue), "bg-rose-500/20 text-rose-300", "late");
          add(
            "due",
            due.filter((r) => !r.paid && !r.overdue),
            "bg-elevated text-ink-muted",
            "still to pay",
          );
          return (
            <button
              key={iso}
              onClick={() => onSelect(iso)}
              className={`border-b border-r border-line-soft p-1 text-left align-top transition hover:bg-panel-2 ${
                compact ? "min-h-[58px]" : "min-h-[64px]"
              } ${selected === iso ? "bg-panel-2" : ""} ${otherMonth ? "opacity-40" : ""}`}
            >
              <span
                className={`text-[11px] ${isToday ? "rounded bg-sky-500/20 px-1 text-sky-200" : "text-ink-muted"}`}
              >
                {d.getDate()}
              </span>
              {groups.map((g) => (
                <span
                  key={g.key}
                  title={g.title}
                  className={`ml-1 mt-1 inline-block rounded-full px-[7px] text-[10px] font-semibold tabular-nums ${g.cls}`}
                >
                  {moneyShort(g.total)}
                </span>
              ))}
              {!compact && (
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
              )}
              {compact && list.length > 0 && (
                <span className="mt-0.5 block truncate rounded bg-panel-2 px-1 text-[10px] text-ink-muted">
                  {list[0].start || "•"} {list[0].title}
                </span>
              )}
            </button>
          );
        })}
      </div>
    </>
  );
}
