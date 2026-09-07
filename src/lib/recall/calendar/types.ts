// ---------------------------------------------------------------------------
// Recall — calendar domain types.
//
// A deliberate storage decision runs through this whole file: an event's day is
// a PLAIN "YYYY-MM-DD" STRING and its time a separate "HH:MM", never a single
// ISO instant. Recall's events are human/local ("Friday the 12th at 7"), and an
// ISO timestamp would silently shift the day for anyone west of UTC — the same
// bug already paid for once in std-safe. Everything that needs a real Date
// builds one from the parts, in local time, via `eventStart` below.
// ---------------------------------------------------------------------------

/** Where an event came from — drives the little origin chip on the row. */
export type EventSource = "manual" | "photo" | "agent";

export interface CalendarEvent {
  id: string;
  title: string;
  notes?: string;
  /** Local calendar day, "YYYY-MM-DD". Never an instant. */
  date: string;
  /** Local start time "HH:MM", or null for an all-day event. */
  time?: string | null;
  /** Optional local end time "HH:MM". Ignored when `time` is null. */
  endTime?: string | null;
  location?: string;
  /**
   * Minutes before the start to nudge, e.g. [1440, 60] = a day and an hour
   * before. Empty means no reminder.
   */
  reminders: number[];
  source: EventSource;
  /** The Recall item this was read out of (the photo of the flyer, a note). */
  itemId?: string | null;
  /** Reminder ids already fired, so re-opening the app does not re-nudge. */
  firedReminders?: number[];
  createdAt: string;
  updatedAt: string;
}

export interface CalendarData {
  events: CalendarEvent[];
}

/** The reminder offsets offered in the dialog, longest first. */
export const REMINDER_CHOICES: { minutes: number; label: string }[] = [
  { minutes: 10080, label: "1 week before" },
  { minutes: 2880, label: "2 days before" },
  { minutes: 1440, label: "1 day before" },
  { minutes: 120, label: "2 hours before" },
  { minutes: 60, label: "1 hour before" },
  { minutes: 30, label: "30 minutes before" },
  { minutes: 0, label: "At the time" },
];

export function reminderLabel(minutes: number): string {
  return REMINDER_CHOICES.find((r) => r.minutes === minutes)?.label ?? `${minutes} min before`;
}

// ----- local-time helpers --------------------------------------------------
// `new Date("2026-09-12")` is parsed as UTC midnight and prints as the 11th in
// the Americas. Every conversion in the app goes through these instead.

/** "YYYY-MM-DD" (+ optional "HH:MM") → a Date in the viewer's own timezone. */
export function eventStart(event: Pick<CalendarEvent, "date" | "time">): Date {
  const [y, m, d] = event.date.split("-").map(Number);
  const [hh, mm] = (event.time ?? "00:00").split(":").map(Number);
  return new Date(y, (m || 1) - 1, d || 1, hh || 0, mm || 0, 0, 0);
}

/** A Date → the "YYYY-MM-DD" key for the day it falls on locally. */
export function dayKey(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function todayKey(): string {
  return dayKey(new Date());
}

/** "2026-09-12" → "Sat 12 Sep 2026", in the viewer's locale. */
export function formatDayKey(key: string, opts?: Intl.DateTimeFormatOptions): string {
  const [y, m, d] = key.split("-").map(Number);
  if (!y || !m || !d) return key;
  return new Date(y, m - 1, d).toLocaleDateString(
    undefined,
    opts ?? { weekday: "short", day: "numeric", month: "short", year: "numeric" },
  );
}

/** "19:30" → "7:30 PM" (or "19:30" where that is the local convention). */
export function formatTime(time?: string | null): string {
  if (!time) return "All day";
  const [hh, mm] = time.split(":").map(Number);
  if (Number.isNaN(hh)) return time;
  return new Date(2000, 0, 1, hh, mm || 0).toLocaleTimeString(undefined, {
    hour: "numeric",
    minute: "2-digit",
  });
}

/** Sort key: chronological, all-day events first within their day. */
export function compareEvents(a: CalendarEvent, b: CalendarEvent): number {
  if (a.date !== b.date) return a.date < b.date ? -1 : 1;
  const at = a.time ?? "";
  const bt = b.time ?? "";
  if (at !== bt) return at < bt ? -1 : 1;
  return a.title.localeCompare(b.title);
}
