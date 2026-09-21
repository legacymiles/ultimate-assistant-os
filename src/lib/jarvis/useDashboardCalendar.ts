"use client";

// ---------------------------------------------------------------------------
// The Dashboard's calendar, as Jarvis sees it.
//
// Dashboard had its own local calendar — reminders, .ics export, events read
// off photographed flyers — and Jarvis had a separate list of hand-typed
// events. There is one calendar now: the Dashboard store (`recall-calendar`)
// is where anything "added here" lives, because it is the one with reminders.
// Its storage key did not change, so every event already in it is still there.
//
// The hook lives in the shell, not the Calendar tab, so a reminder fires on
// whichever tab the owner happens to be looking at.
// ---------------------------------------------------------------------------

import { useCallback, useEffect, useState } from "react";
import { CALENDAR_KEY, getEvents } from "@/lib/recall/calendar/store";
import { useReminders } from "@/lib/recall/calendar/reminders";
import type { CalendarEvent } from "@/lib/recall/calendar/types";
import { useRemotePull } from "@/lib/sync/useSync";
import type { CalEvent } from "./types";

export function useDashboardCalendar() {
  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const refresh = useCallback(() => setEvents(getEvents()), []);
  useEffect(refresh, [refresh]);
  // Events added on the phone land in localStorage first, then here.
  useRemotePull(CALENDAR_KEY, refresh);
  const reminders = useReminders(events);
  return { events, setEvents, refresh, reminders };
}

/** A Dashboard event in the shape Jarvis's grid, brief and clash check use. */
export function toCalEvent(e: CalendarEvent): CalEvent {
  return {
    id: e.id,
    title: e.title,
    date: e.date,
    start: e.time ?? "",
    end: e.endTime ?? "",
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    where: e.location,
    notes: e.notes,
    app: "dashboard",
  };
}
