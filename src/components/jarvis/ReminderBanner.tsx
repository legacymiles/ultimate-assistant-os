"use client";

// ---------------------------------------------------------------------------
// Calendar nudges, shown above whichever tab is open.
//
// Dashboard only reminded you while its Calendar tab was on screen. In Jarvis
// the reminder hook runs in the shell, so this banner follows the owner round
// every tab — a reminder that needs the right tab open is not a reminder.
// ---------------------------------------------------------------------------

import { Icon } from "../icons";
import type { DueReminder } from "@/lib/recall/calendar/reminders";
import { formatDayKey, formatTime } from "@/lib/recall/calendar/types";

export function ReminderBanner({
  queue,
  onDismiss,
}: {
  queue: DueReminder[];
  onDismiss: (id: string, minutes: number) => void;
}) {
  if (!queue.length) return null;
  return (
    <div className="space-y-1.5 px-3 pt-3 sm:px-4" role="status" aria-live="polite">
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
            onClick={() => onDismiss(r.event.id, r.minutes)}
            className="shrink-0 rounded-md p-1 text-ink-faint hover:text-ink"
            aria-label="Dismiss reminder"
          >
            <Icon.Close width={13} height={13} />
          </button>
        </div>
      ))}
    </div>
  );
}
