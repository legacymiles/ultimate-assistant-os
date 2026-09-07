"use client";

// ---------------------------------------------------------------------------
// Recall — reminders.
//
// What this can and cannot do, stated plainly because the difference matters:
// a web app only runs while one of its tabs is open, so these nudges fire when
// Recall is open (or has been left open in a background tab), not when the
// phone is asleep. That is why the calendar also exports .ics — an event handed
// to the phone's own calendar rings without Recall. This engine covers the
// common case (the app is open on the desktop all day) and never pretends to
// cover the other one.
//
// Two channels: a system notification when the user has granted permission,
// and an in-app banner that always works.
// ---------------------------------------------------------------------------

import { useEffect, useRef, useState } from "react";
import { eventStart, formatTime, reminderLabel } from "./types";
import type { CalendarEvent } from "./types";
import { markReminderFired } from "./store";

export interface DueReminder {
  event: CalendarEvent;
  minutes: number;
}

/** Reminders whose moment has arrived and which have not nudged yet. */
export function dueReminders(events: CalendarEvent[], now = Date.now()): DueReminder[] {
  const out: DueReminder[] = [];
  for (const e of events) {
    const start = eventStart(e).getTime();
    const fired = new Set(e.firedReminders ?? []);
    for (const m of e.reminders ?? []) {
      if (fired.has(m)) continue;
      const at = start - m * 60_000;
      // Only fire inside a 12-hour trailing window. Without the floor, adding a
      // reminder to an event that already passed would nudge immediately for
      // every stale offset at once.
      if (now >= at && now - at < 12 * 60 * 60 * 1000) out.push({ event: e, minutes: m });
    }
  }
  return out;
}

export function notificationsAvailable(): boolean {
  return typeof window !== "undefined" && "Notification" in window;
}

export function notificationPermission(): NotificationPermission | "unavailable" {
  return notificationsAvailable() ? Notification.permission : "unavailable";
}

export async function requestNotifications(): Promise<NotificationPermission | "unavailable"> {
  if (!notificationsAvailable()) return "unavailable";
  try {
    return await Notification.requestPermission();
  } catch {
    return Notification.permission;
  }
}

function notify(r: DueReminder): void {
  if (!notificationsAvailable() || Notification.permission !== "granted") return;
  try {
    const when = r.event.time ? formatTime(r.event.time) : "today";
    new Notification(r.event.title, {
      body: `${reminderLabel(r.minutes)} · ${when}${r.event.location ? ` · ${r.event.location}` : ""}`,
      tag: `${r.event.id}:${r.minutes}`,
    });
  } catch {
    /* some browsers throw on constructing Notification outside a SW */
  }
}

/**
 * Watch `events` and surface reminders as they come due.
 *
 * Returns the queue of un-dismissed nudges for the in-app banner. The store is
 * marked immediately on fire (not on dismiss) so a reload never re-nudges.
 */
export function useReminders(events: CalendarEvent[], enabled = true): {
  queue: DueReminder[];
  dismiss: (id: string, minutes: number) => void;
} {
  const [queue, setQueue] = useState<DueReminder[]>([]);
  const eventsRef = useRef(events);
  eventsRef.current = events;

  useEffect(() => {
    if (!enabled) return;
    const tick = () => {
      const due = dueReminders(eventsRef.current);
      if (!due.length) return;
      for (const r of due) {
        markReminderFired(r.event.id, r.minutes);
        notify(r);
      }
      setQueue((q) => {
        const seen = new Set(q.map((x) => `${x.event.id}:${x.minutes}`));
        return [...q, ...due.filter((r) => !seen.has(`${r.event.id}:${r.minutes}`))];
      });
    };
    tick();
    const t = setInterval(tick, 30_000);
    return () => clearInterval(t);
  }, [enabled]);

  return {
    queue,
    dismiss: (id, minutes) =>
      setQueue((q) => q.filter((r) => !(r.event.id === id && r.minutes === minutes))),
  };
}
