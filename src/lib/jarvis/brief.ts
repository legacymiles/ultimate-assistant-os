// ---------------------------------------------------------------------------
// What the dashboard is allowed to show.
//
// The one rule the owner's prompt pack and this app agree on: never invent
// activity or progress. So this module only ever selects from what is actually
// stored — and returns empty arrays when there is nothing, so the UI shows an
// honest empty state instead of filler.
// ---------------------------------------------------------------------------

import type { Profile } from "@/lib/new-dashboard/types";
import type { CalEvent, InboxMessage, JarvisStore, Memory } from "./types";

export interface BriefInputs {
  /** The profile's 90-day priorities that are not ticked off. */
  openPriorities: { index: number; text: string }[];
  donePriorities: number[];
  /** Next three events at or after `now`, soonest first. */
  nextEvents: CalEvent[];
  unread: InboxMessage[];
  recentMemories: Memory[];
  /** True when there is nothing at all to say. */
  empty: boolean;
}

/** Local YYYY-MM-DD. Using the local date matters: a calendar must not shift a day. */
export function localDate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** Sortable key for an event, so "today 09:00" precedes "today 14:00" and all-day sorts first. */
export function eventKey(e: CalEvent): string {
  return `${e.date} ${e.start || "00:00"}`;
}

export function briefInputs(profile: Profile | null, store: JarvisStore, now = new Date()): BriefInputs {
  const priorities = (profile?.intake.q3 ?? ["", "", ""])
    .map((text, index) => ({ index, text: text.trim() }))
    .filter((p) => p.text.length > 0);
  const done = profile?.prioritiesDone ?? [];
  const openPriorities = priorities.filter((p) => !done.includes(p.index));

  const cutoff = `${localDate(now)} ${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;
  const nextEvents = [...store.events]
    .filter((e) => eventKey(e) >= `${localDate(now)} 00:00` && (e.start === "" || eventKey(e) >= cutoff))
    .sort((a, b) => eventKey(a).localeCompare(eventKey(b)))
    .slice(0, 3);

  const unread = store.messages.filter((m) => !m.read);
  const recentMemories = [...store.memories]
    .sort((a, b) => b.capturedAt.localeCompare(a.capturedAt))
    .slice(0, 5);

  return {
    openPriorities,
    donePriorities: done,
    nextEvents,
    unread,
    recentMemories,
    empty: !openPriorities.length && !nextEvents.length && !unread.length && !recentMemories.length,
  };
}

/** Two events that overlap in time on the same day (the prompt pack's check). */
export function overlaps(events: CalEvent[]): [string, string][] {
  const timed = events.filter((e) => e.start && e.end);
  const out: [string, string][] = [];
  for (let i = 0; i < timed.length; i += 1) {
    for (let j = i + 1; j < timed.length; j += 1) {
      const a = timed[i];
      const b = timed[j];
      if (a.date !== b.date) continue;
      if (a.start < b.end && b.start < a.end) out.push([a.id, b.id]);
    }
  }
  return out;
}
