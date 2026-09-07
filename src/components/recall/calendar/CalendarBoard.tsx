"use client";

import { useEffect, useMemo, useState } from "react";
import { Icon } from "../../icons";
import {
  createEvent,
  deleteEvent,
  downloadIcs,
  eventsOn,
  getEvents,
  monthGrid,
  past,
  upcoming,
  updateEvent,
  CALENDAR_KEY,
} from "@/lib/recall/calendar/store";
import type { EventInput } from "@/lib/recall/calendar/store";
import {
  dayKey,
  formatDayKey,
  formatTime,
  todayKey,
} from "@/lib/recall/calendar/types";
import type { CalendarEvent } from "@/lib/recall/calendar/types";
import {
  notificationPermission,
  requestNotifications,
  useReminders,
} from "@/lib/recall/calendar/reminders";
import { useRemotePull } from "@/lib/sync/useSync";
import { EventDialog } from "./EventDialog";

// ---------------------------------------------------------------------------
// Calendar.
//
// Two views, and the default is the one that answers the actual question. You
// open a calendar to find out WHAT IS COMING, not to admire a grid — so Agenda
// leads, and Month is there for the times you need to see shape rather than
// sequence. Both share one selected day, so switching never loses your place.
// ---------------------------------------------------------------------------

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

const SOURCE_CHIP: Record<CalendarEvent["source"], { label: string; className: string } | null> = {
  manual: null,
  photo: { label: "Photo", className: "bg-amber-400/15 text-amber-300" },
  agent: { label: "Assistant", className: "bg-brand/15 text-brand" },
};

interface Props {
  onToast: (msg: string) => void;
  /** Open the item a photo-sourced event came from. */
  onOpenItem?: (itemId: string) => void;
}

export function CalendarBoard({ onToast, onOpenItem }: Props) {
  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [view, setView] = useState<"agenda" | "month">("agenda");
  const [cursor, setCursor] = useState(() => {
    const now = new Date();
    return { year: now.getFullYear(), month: now.getMonth() };
  });
  const [selected, setSelected] = useState<string>(todayKey());
  const [dialog, setDialog] = useState<{ event: CalendarEvent | null; date?: string } | null>(null);
  const [perm, setPerm] = useState<string>("default");

  useEffect(() => {
    setEvents(getEvents());
    setPerm(notificationPermission());
  }, []);

  // Events added on the phone land in localStorage first, then here.
  useRemotePull(CALENDAR_KEY, () => setEvents(getEvents()));

  const { queue, dismiss } = useReminders(events);

  const today = todayKey();
  const soon = useMemo(() => upcoming(events, 40), [events]);
  const earlier = useMemo(() => past(events, 30), [events]);
  const grid = useMemo(() => monthGrid(cursor.year, cursor.month), [cursor]);
  const byDay = useMemo(() => {
    const m = new Map<string, CalendarEvent[]>();
    for (const e of events) {
      const list = m.get(e.date);
      if (list) list.push(e);
      else m.set(e.date, [e]);
    }
    return m;
  }, [events]);

  const monthLabel = new Date(cursor.year, cursor.month, 1).toLocaleDateString(undefined, {
    month: "long",
    year: "numeric",
  });

  function shiftMonth(delta: number) {
    setCursor(({ year, month }) => {
      const d = new Date(year, month + delta, 1);
      return { year: d.getFullYear(), month: d.getMonth() };
    });
  }

  function goToday() {
    const now = new Date();
    setCursor({ year: now.getFullYear(), month: now.getMonth() });
    setSelected(dayKey(now));
  }

  function submit(input: EventInput) {
    if (dialog?.event) {
      setEvents(updateEvent(dialog.event.id, input));
      onToast("Event updated");
    } else {
      setEvents(createEvent(input).events);
      onToast("Added to your calendar");
    }
  }

  function remove(id: string) {
    setEvents(deleteEvent(id));
    onToast("Event removed");
  }

  async function askNotifications() {
    const next = await requestNotifications();
    setPerm(next);
    if (next === "granted") onToast("Reminders on — while Recall is open");
    else if (next === "denied") onToast("Your browser blocked notifications");
  }

  const selectedEvents = eventsOn(events, selected);

  return (
    <div>
      {/* Reminders that have come due, as a banner nobody can miss. */}
      {queue.length > 0 && (
        <div className="mb-3 space-y-1.5">
          {queue.map((r) => (
            <div
              key={`${r.event.id}:${r.minutes}`}
              className="flex items-center gap-2 rounded-xl border border-brand/40 bg-brand/10 px-3 py-2"
            >
              <Icon.Clock width={15} height={15} className="shrink-0 text-brand" />
              <span className="min-w-0 flex-1 text-xs text-ink">
                <span className="font-semibold">{r.event.title}</span>
                <span className="text-ink-muted">
                  {" · "}
                  {formatDayKey(r.event.date, { weekday: "short", day: "numeric", month: "short" })}
                  {r.event.time ? `, ${formatTime(r.event.time)}` : ""}
                  {r.event.location ? ` · ${r.event.location}` : ""}
                </span>
              </span>
              <button
                onClick={() => dismiss(r.event.id, r.minutes)}
                className="shrink-0 rounded-md p-1 text-ink-faint hover:text-ink"
                aria-label="Dismiss reminder"
              >
                <Icon.Close width={13} height={13} />
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Header */}
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <div className="inline-flex gap-1 rounded-xl border border-line bg-panel p-1">
          {(["agenda", "month"] as const).map((v) => (
            <button
              key={v}
              onClick={() => setView(v)}
              aria-pressed={view === v}
              className={
                "rounded-lg px-2.5 py-1 text-[12px] font-medium capitalize transition " +
                (view === v ? "bg-brand text-white" : "text-ink-muted hover:bg-panel-2 hover:text-ink")
              }
            >
              {v}
            </button>
          ))}
        </div>

        {view === "month" && (
          <div className="flex items-center gap-1">
            <button
              onClick={() => shiftMonth(-1)}
              aria-label="Previous month"
              className="rounded-lg border border-line p-1.5 text-ink-muted hover:text-ink"
            >
              <Icon.Chevron width={14} height={14} className="rotate-180" />
            </button>
            <span className="min-w-[130px] text-center text-sm font-semibold text-ink">
              {monthLabel}
            </span>
            <button
              onClick={() => shiftMonth(1)}
              aria-label="Next month"
              className="rounded-lg border border-line p-1.5 text-ink-muted hover:text-ink"
            >
              <Icon.Chevron width={14} height={14} />
            </button>
          </div>
        )}

        <button
          onClick={goToday}
          className="rounded-lg border border-line px-2.5 py-1.5 text-[11px] text-ink-muted transition hover:text-ink"
        >
          Today
        </button>

        <div className="ml-auto flex items-center gap-1.5">
          {perm === "default" && (
            <button
              onClick={() => void askNotifications()}
              title="Let Recall show a notification when a reminder comes due"
              className="rounded-lg border border-line px-2.5 py-1.5 text-[11px] text-ink-muted transition hover:text-ink"
            >
              Turn on reminders
            </button>
          )}
          <button
            onClick={() => {
              if (!events.length) return onToast("Nothing to export yet");
              downloadIcs(events);
              onToast("Downloaded — open it to add these to your phone's calendar");
            }}
            title="Export every event as .ics for your phone's calendar"
            aria-label="Export calendar"
            className="rounded-lg border border-line p-1.5 text-ink-muted transition hover:text-ink"
          >
            <Icon.Download width={15} height={15} />
          </button>
          <button
            onClick={() => setDialog({ event: null, date: selected })}
            className="inline-flex items-center gap-1.5 rounded-xl bg-brand px-3 py-2 text-[13px] font-semibold text-white transition hover:bg-brand-2"
          >
            <Icon.Plus width={15} height={15} />
            <span className="hidden sm:inline">New event</span>
          </button>
        </div>
      </div>

      {view === "month" ? (
        <>
          <div className="overflow-hidden rounded-2xl border border-line bg-panel">
            <div className="grid grid-cols-7 border-b border-line">
              {WEEKDAYS.map((d) => (
                <div
                  key={d}
                  className="px-2 py-1.5 text-center text-[10px] font-semibold uppercase tracking-wider text-ink-faint"
                >
                  {d}
                </div>
              ))}
            </div>
            <div className="grid grid-cols-7">
              {grid.map((key) => {
                const dayEvents = byDay.get(key) ?? [];
                const inMonth = Number(key.slice(5, 7)) - 1 === cursor.month;
                const isToday = key === today;
                const isSelected = key === selected;
                return (
                  <button
                    key={key}
                    onClick={() => setSelected(key)}
                    onDoubleClick={() => setDialog({ event: null, date: key })}
                    className={
                      "min-h-[72px] border-b border-r border-line/60 p-1.5 text-left align-top transition last:border-r-0 " +
                      (isSelected ? "bg-brand/10 ring-1 ring-inset ring-brand/40 " : "hover:bg-panel-2 ") +
                      (inMonth ? "" : "opacity-40")
                    }
                  >
                    <span
                      className={
                        "inline-flex h-5 w-5 items-center justify-center rounded-full text-[11px] tabular-nums " +
                        (isToday ? "bg-brand font-bold text-white" : "text-ink-muted")
                      }
                    >
                      {Number(key.slice(8, 10))}
                    </span>
                    <span className="mt-1 block space-y-0.5">
                      {dayEvents.slice(0, 2).map((e) => (
                        <span
                          key={e.id}
                          className="block truncate rounded bg-panel-2 px-1 py-0.5 text-[10px] leading-tight text-ink-muted"
                        >
                          {e.time ? `${e.time} ` : ""}
                          {e.title}
                        </span>
                      ))}
                      {dayEvents.length > 2 && (
                        <span className="block px-1 text-[10px] text-ink-faint">
                          +{dayEvents.length - 2} more
                        </span>
                      )}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>

          <div className="mt-3">
            <div className="mb-1.5 flex items-center justify-between">
              <h3 className="text-[11px] font-semibold uppercase tracking-wider text-ink-faint">
                {formatDayKey(selected)}
              </h3>
              <button
                onClick={() => setDialog({ event: null, date: selected })}
                className="text-[11px] text-ink-faint hover:text-brand"
              >
                + Add
              </button>
            </div>
            {selectedEvents.length === 0 ? (
              <p className="rounded-xl border border-dashed border-line px-3 py-5 text-center text-xs text-ink-faint">
                Nothing on this day.
              </p>
            ) : (
              <div className="space-y-1.5">
                {selectedEvents.map((e) => (
                  <EventRow
                    key={e.id}
                    event={e}
                    onEdit={() => setDialog({ event: e })}
                    onOpenItem={onOpenItem}
                  />
                ))}
              </div>
            )}
          </div>
        </>
      ) : (
        <AgendaView
          upcoming={soon}
          past={earlier}
          today={today}
          onEdit={(e) => setDialog({ event: e })}
          onNew={() => setDialog({ event: null, date: selected })}
          onOpenItem={onOpenItem}
        />
      )}

      {dialog && (
        <EventDialog
          initial={dialog.event}
          defaultDate={dialog.date}
          onSubmit={submit}
          onDelete={dialog.event ? () => remove(dialog.event!.id) : undefined}
          onClose={() => setDialog(null)}
        />
      )}
    </div>
  );
}

// ----- agenda --------------------------------------------------------------

function AgendaView({
  upcoming: soon,
  past: earlier,
  today,
  onEdit,
  onNew,
  onOpenItem,
}: {
  upcoming: CalendarEvent[];
  past: CalendarEvent[];
  today: string;
  onEdit: (e: CalendarEvent) => void;
  onNew: () => void;
  onOpenItem?: (itemId: string) => void;
}) {
  const [showPast, setShowPast] = useState(false);

  if (soon.length === 0 && earlier.length === 0) {
    return (
      <div className="rounded-2xl border border-dashed border-line bg-panel/40 px-6 py-16 text-center">
        <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-2xl bg-brand/15 text-brand">
          <Icon.Calendar width={22} height={22} />
        </div>
        <h2 className="text-base font-semibold text-ink">Nothing scheduled</h2>
        <p className="mx-auto mt-1.5 max-w-sm text-xs leading-relaxed text-ink-muted">
          Add something yourself, ask the assistant to (&ldquo;put parents&rsquo; evening on
          Thursday at 6&rdquo;), or drop a photo of a flyer into Photos — Recall reads the date off
          it and offers to put it here.
        </p>
        <button
          onClick={onNew}
          className="mt-5 inline-flex items-center gap-1.5 rounded-xl bg-brand px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-brand-2"
        >
          <Icon.Plus width={16} height={16} /> New event
        </button>
      </div>
    );
  }

  // Grouped by day so the eye lands on "Thursday" before it lands on an event.
  const groups: { key: string; events: CalendarEvent[] }[] = [];
  for (const e of soon) {
    const last = groups[groups.length - 1];
    if (last && last.key === e.date) last.events.push(e);
    else groups.push({ key: e.date, events: [e] });
  }

  return (
    <div className="space-y-4">
      {groups.map((g) => (
        <div key={g.key}>
          <h3 className="mb-1.5 flex items-baseline gap-2">
            <span
              className={
                "text-[12px] font-semibold " + (g.key === today ? "text-brand" : "text-ink")
              }
            >
              {g.key === today ? "Today" : formatDayKey(g.key, { weekday: "long", day: "numeric", month: "long" })}
            </span>
            {g.key === today && (
              <span className="text-[11px] text-ink-faint">
                {formatDayKey(g.key, { day: "numeric", month: "long" })}
              </span>
            )}
          </h3>
          <div className="space-y-1.5">
            {g.events.map((e) => (
              <EventRow key={e.id} event={e} onEdit={() => onEdit(e)} onOpenItem={onOpenItem} />
            ))}
          </div>
        </div>
      ))}

      {earlier.length > 0 && (
        <div>
          <button
            onClick={() => setShowPast((v) => !v)}
            className="flex items-center gap-1 text-[11px] font-semibold uppercase tracking-wider text-ink-faint hover:text-ink"
          >
            <Icon.Chevron width={12} height={12} className={showPast ? "rotate-90" : ""} />
            {earlier.length} past {earlier.length === 1 ? "event" : "events"}
          </button>
          {showPast && (
            <div className="mt-1.5 space-y-1.5 opacity-70">
              {earlier.map((e) => (
                <EventRow key={e.id} event={e} onEdit={() => onEdit(e)} onOpenItem={onOpenItem} />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function EventRow({
  event,
  onEdit,
  onOpenItem,
}: {
  event: CalendarEvent;
  onEdit: () => void;
  onOpenItem?: (itemId: string) => void;
}) {
  const chip = SOURCE_CHIP[event.source];
  return (
    <div className="group flex items-start gap-3 rounded-xl border border-line bg-panel px-3 py-2 transition hover:border-brand/40">
      <span className="mt-0.5 w-[62px] shrink-0 text-[11px] font-medium tabular-nums text-ink-muted">
        {event.time ? formatTime(event.time) : "All day"}
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex flex-wrap items-center gap-1.5">
          <span className="text-[13px] font-medium text-ink">{event.title}</span>
          {chip && (
            <span
              className={
                "rounded px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wider " +
                chip.className
              }
            >
              {chip.label}
            </span>
          )}
          {event.reminders.length > 0 && (
            <Icon.Clock width={11} height={11} className="text-ink-faint" />
          )}
        </span>
        {event.location && (
          <span className="mt-0.5 block truncate text-[11px] text-ink-muted">{event.location}</span>
        )}
        {event.notes && (
          <span className="mt-0.5 block line-clamp-2 text-[11px] leading-relaxed text-ink-faint">
            {event.notes}
          </span>
        )}
      </span>
      <span className="flex shrink-0 items-center gap-0.5 opacity-0 transition group-hover:opacity-100">
        {event.itemId && onOpenItem && (
          <button
            onClick={() => onOpenItem(event.itemId as string)}
            title="Open the photo this came from"
            aria-label="Open source photo"
            className="rounded-md p-1.5 text-ink-faint hover:text-ink"
          >
            <Icon.Image width={13} height={13} />
          </button>
        )}
        <button
          onClick={onEdit}
          title="Edit"
          aria-label={`Edit ${event.title}`}
          className="rounded-md p-1.5 text-ink-faint hover:text-ink"
        >
          <Icon.Edit width={13} height={13} />
        </button>
      </span>
    </div>
  );
}
