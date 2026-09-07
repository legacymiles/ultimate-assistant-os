// ---------------------------------------------------------------------------
// Recall — calendar store.
//
// Same shape as the folders/items store: localStorage is the read path,
// saveSynced pushes a copy to app_state so the calendar follows the account
// between devices. Kept in its OWN key rather than folded into recall:v1 —
// the calendar is written by a different surface (and by the photo triage),
// and a shared blob would make every event save re-push the whole knowledge
// base under last-write-wins.
// ---------------------------------------------------------------------------

import { saveSynced } from "@/lib/sync/appState";
import { nowIso, uid } from "../../utils";
import { scopedKey } from "@/lib/sync/identity";
import { compareEvents, dayKey, eventStart, todayKey } from "./types";
import type { CalendarData, CalendarEvent, EventSource } from "./types";

export const CALENDAR_KEY = "recall-calendar:v1";

const EMPTY: CalendarData = { events: [] };

function load(): CalendarData {
  if (typeof window === "undefined") return EMPTY;
  try {
    const raw = window.localStorage.getItem(scopedKey(CALENDAR_KEY));
    if (!raw) return EMPTY;
    const parsed = JSON.parse(raw) as CalendarData;
    return { events: Array.isArray(parsed.events) ? parsed.events.map(normalize) : [] };
  } catch {
    return EMPTY;
  }
}

/** Fill in fields added after an event was first written. */
function normalize(e: CalendarEvent): CalendarEvent {
  return {
    ...e,
    reminders: Array.isArray(e.reminders) ? e.reminders : [],
    firedReminders: Array.isArray(e.firedReminders) ? e.firedReminders : [],
    source: (e.source ?? "manual") as EventSource,
  };
}

function save(data: CalendarData): CalendarData {
  saveSynced(CALENDAR_KEY, data);
  return data;
}

export function getEvents(): CalendarEvent[] {
  return load().events.slice().sort(compareEvents);
}

// ----- mutations -----------------------------------------------------------

export interface EventInput {
  title: string;
  date: string;
  time?: string | null;
  endTime?: string | null;
  notes?: string;
  location?: string;
  reminders?: number[];
  source?: EventSource;
  itemId?: string | null;
}

export function createEvent(input: EventInput): { events: CalendarEvent[]; event: CalendarEvent } {
  const data = load();
  const ts = nowIso();
  const event: CalendarEvent = {
    id: uid("evt"),
    title: input.title.trim() || "Untitled event",
    date: input.date || todayKey(),
    time: input.time ?? null,
    endTime: input.endTime ?? null,
    notes: input.notes?.trim() || undefined,
    location: input.location?.trim() || undefined,
    // A day-out nudge is the useful default; an event with no reminder at all
    // is a note, not an appointment.
    reminders: input.reminders ?? [1440],
    source: input.source ?? "manual",
    itemId: input.itemId ?? null,
    firedReminders: [],
    createdAt: ts,
    updatedAt: ts,
  };
  data.events.push(event);
  save(data);
  return { events: data.events.slice().sort(compareEvents), event };
}

export function updateEvent(id: string, patch: Partial<EventInput>): CalendarEvent[] {
  const data = load();
  const e = data.events.find((x) => x.id === id);
  if (e) {
    if (patch.title !== undefined) e.title = patch.title.trim() || e.title;
    if (patch.date !== undefined) e.date = patch.date || e.date;
    if (patch.time !== undefined) e.time = patch.time;
    if (patch.endTime !== undefined) e.endTime = patch.endTime;
    if (patch.notes !== undefined) e.notes = patch.notes.trim() || undefined;
    if (patch.location !== undefined) e.location = patch.location.trim() || undefined;
    if (patch.reminders !== undefined) {
      e.reminders = patch.reminders;
      // Moving the event or changing its nudges re-arms them.
      e.firedReminders = [];
    }
    if (patch.date !== undefined || patch.time !== undefined) e.firedReminders = [];
    e.updatedAt = nowIso();
  }
  save(data);
  return data.events.slice().sort(compareEvents);
}

export function deleteEvent(id: string): CalendarEvent[] {
  const data = load();
  data.events = data.events.filter((e) => e.id !== id);
  save(data);
  return data.events.slice().sort(compareEvents);
}

/** Record that a reminder has nudged, so re-opening the tab stays quiet. */
export function markReminderFired(id: string, minutes: number): void {
  const data = load();
  const e = data.events.find((x) => x.id === id);
  if (!e) return;
  const fired = new Set(e.firedReminders ?? []);
  fired.add(minutes);
  e.firedReminders = [...fired];
  save(data);
}

// ----- queries -------------------------------------------------------------

/** Events on a given "YYYY-MM-DD", in order. */
export function eventsOn(events: CalendarEvent[], key: string): CalendarEvent[] {
  return events.filter((e) => e.date === key).sort(compareEvents);
}

/** Every day key in a month that has at least one event. */
export function busyDays(events: CalendarEvent[]): Set<string> {
  return new Set(events.map((e) => e.date));
}

/**
 * The next `limit` events from now. Today's earlier events are dropped by
 * comparing real instants, so "3pm today" disappears at 3pm rather than at
 * midnight — the thing that makes an agenda feel alive rather than stale.
 */
export function upcoming(events: CalendarEvent[], limit = 20): CalendarEvent[] {
  const now = Date.now();
  const today = todayKey();
  return events
    .filter((e) => (e.date === today ? eventStart(e).getTime() >= now - 60 * 60 * 1000 : e.date >= today))
    .sort(compareEvents)
    .slice(0, limit);
}

/** Events already in the past, newest first. */
export function past(events: CalendarEvent[], limit = 40): CalendarEvent[] {
  const today = todayKey();
  return events
    .filter((e) => e.date < today)
    .sort((a, b) => -compareEvents(a, b))
    .slice(0, limit);
}

/** The 6×7 grid of day keys covering `month`, Monday-first. */
export function monthGrid(year: number, month: number): string[] {
  const first = new Date(year, month, 1);
  // getDay() is Sunday-0; shift so Monday is column 0.
  const lead = (first.getDay() + 6) % 7;
  const start = new Date(year, month, 1 - lead);
  const out: string[] = [];
  for (let i = 0; i < 42; i++) {
    out.push(dayKey(new Date(start.getFullYear(), start.getMonth(), start.getDate() + i)));
  }
  return out;
}

// ----- export --------------------------------------------------------------

function icsStamp(e: CalendarEvent): { start: string; end: string; allDay: boolean } {
  const pad = (n: number) => String(n).padStart(2, "0");
  if (!e.time) {
    const [y, m, d] = e.date.split("-").map(Number);
    const next = new Date(y, m - 1, d + 1);
    return {
      start: e.date.replace(/-/g, ""),
      end: `${next.getFullYear()}${pad(next.getMonth() + 1)}${pad(next.getDate())}`,
      allDay: true,
    };
  }
  const s = eventStart(e);
  const endDate = e.endTime
    ? eventStart({ date: e.date, time: e.endTime })
    : new Date(s.getTime() + 60 * 60 * 1000);
  const local = (d: Date) =>
    `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}T${pad(d.getHours())}${pad(d.getMinutes())}00`;
  return { start: local(s), end: local(endDate), allDay: false };
}

function escapeIcs(s: string): string {
  return s.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\n/g, "\\n");
}

/**
 * Render events as an .ics file.
 *
 * This is the honest bridge to the user's real calendar. Recall's own reminders
 * only fire while the app is open in a tab; importing the .ics into the phone's
 * calendar is what makes a reminder ring when the phone is in a pocket. Times
 * are written as floating local times (no TZID), which is exactly right for
 * "Friday at 7" and avoids re-introducing the UTC shift this module avoids.
 */
export function toIcs(events: CalendarEvent[]): string {
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Recall//Calendar//EN",
    "CALSCALE:GREGORIAN",
  ];
  for (const e of events) {
    const { start, end, allDay } = icsStamp(e);
    lines.push("BEGIN:VEVENT");
    lines.push(`UID:${e.id}@recall`);
    lines.push(`DTSTAMP:${new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "")}`);
    lines.push(allDay ? `DTSTART;VALUE=DATE:${start}` : `DTSTART:${start}`);
    lines.push(allDay ? `DTEND;VALUE=DATE:${end}` : `DTEND:${end}`);
    lines.push(`SUMMARY:${escapeIcs(e.title)}`);
    if (e.location) lines.push(`LOCATION:${escapeIcs(e.location)}`);
    if (e.notes) lines.push(`DESCRIPTION:${escapeIcs(e.notes)}`);
    for (const m of e.reminders) {
      lines.push("BEGIN:VALARM", "ACTION:DISPLAY", `TRIGGER:-PT${m}M`, `DESCRIPTION:${escapeIcs(e.title)}`, "END:VALARM");
    }
    lines.push("END:VEVENT");
  }
  lines.push("END:VCALENDAR");
  return lines.join("\r\n");
}

export function downloadIcs(events: CalendarEvent[], filename = "recall-calendar.ics"): void {
  const blob = new Blob([toIcs(events)], { type: "text/calendar;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}
