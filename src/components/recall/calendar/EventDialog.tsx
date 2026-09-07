"use client";

import { useEffect, useRef, useState } from "react";
import { Icon } from "../../icons";
import { REMINDER_CHOICES, todayKey } from "@/lib/recall/calendar/types";
import type { CalendarEvent } from "@/lib/recall/calendar/types";
import type { EventInput } from "@/lib/recall/calendar/store";

// ---------------------------------------------------------------------------
// Create / edit an event.
//
// Time is optional and OFF by default. Most of what lands here from a photo or
// a passing thought is "sometime on the 14th", and forcing a made-up 09:00 onto
// it would turn a true all-day note into a false appointment.
// ---------------------------------------------------------------------------

interface Props {
  initial?: CalendarEvent | null;
  /** Pre-selected day when creating from a calendar cell. */
  defaultDate?: string;
  onSubmit: (input: EventInput) => void;
  onDelete?: () => void;
  onClose: () => void;
}

export function EventDialog({ initial, defaultDate, onSubmit, onDelete, onClose }: Props) {
  const [title, setTitle] = useState(initial?.title ?? "");
  const [date, setDate] = useState(initial?.date ?? defaultDate ?? todayKey());
  const [timed, setTimed] = useState(Boolean(initial?.time));
  const [time, setTime] = useState(initial?.time ?? "18:00");
  const [endTime, setEndTime] = useState(initial?.endTime ?? "");
  const [location, setLocation] = useState(initial?.location ?? "");
  const [notes, setNotes] = useState(initial?.notes ?? "");
  const [reminders, setReminders] = useState<number[]>(initial?.reminders ?? [1440]);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  function toggleReminder(m: number) {
    setReminders((r) => (r.includes(m) ? r.filter((x) => x !== m) : [...r, m].sort((a, b) => b - a)));
  }

  function submit() {
    if (!title.trim() || !date) return;
    onSubmit({
      title: title.trim(),
      date,
      time: timed ? time : null,
      endTime: timed && endTime ? endTime : null,
      location: location.trim() || undefined,
      notes: notes.trim() || undefined,
      reminders,
    });
    onClose();
  }

  const field =
    "w-full rounded-xl border border-line bg-canvas px-3 py-2 text-sm text-ink outline-none placeholder:text-ink-faint focus:border-brand focus:ring-2 focus:ring-brand/25";
  const label = "mb-1 block text-[11px] font-medium uppercase tracking-wider text-ink-faint";

  return (
    <div
      className="fixed inset-0 z-[60] flex items-start justify-center overflow-y-auto bg-black/60 p-4 pt-[10vh]"
      onClick={onClose}
    >
      <div
        className="animate-fade-in w-full max-w-md rounded-2xl border border-line bg-panel p-4 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-3 flex items-center gap-2">
          <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-brand/15 text-brand">
            <Icon.Calendar width={15} height={15} />
          </span>
          <span className="text-sm font-semibold text-ink">
            {initial ? "Edit event" : "New event"}
          </span>
          {initial?.source === "photo" && (
            <span className="rounded-md bg-amber-400/15 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-amber-300">
              From a photo
            </span>
          )}
          <button
            onClick={onClose}
            aria-label="Close"
            className="ml-auto rounded-lg p-1 text-ink-faint hover:bg-panel-2 hover:text-ink"
          >
            <Icon.Close width={15} height={15} />
          </button>
        </div>

        <label className={label}>What</label>
        <input
          ref={inputRef}
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && submit()}
          placeholder="Parents' evening"
          className={field + " mb-3"}
        />

        <div className="mb-3 grid grid-cols-2 gap-2">
          <div>
            <label className={label}>Day</label>
            <input
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              className={field}
            />
          </div>
          <div>
            <label className={label}>Time</label>
            <div className="flex items-center gap-1.5">
              <button
                onClick={() => setTimed((v) => !v)}
                className={
                  "shrink-0 rounded-lg border px-2 py-2 text-[11px] font-medium transition " +
                  (timed
                    ? "border-brand bg-brand/15 text-brand"
                    : "border-line text-ink-muted hover:text-ink")
                }
                title={timed ? "Make this an all-day event" : "Give this a time"}
              >
                {timed ? "Timed" : "All day"}
              </button>
              {timed && (
                <input
                  type="time"
                  value={time}
                  onChange={(e) => setTime(e.target.value)}
                  className={field}
                />
              )}
            </div>
          </div>
        </div>

        {timed && (
          <div className="mb-3">
            <label className={label}>
              Ends <span className="normal-case tracking-normal text-ink-faint/70">optional</span>
            </label>
            <input
              type="time"
              value={endTime}
              onChange={(e) => setEndTime(e.target.value)}
              className={field}
            />
          </div>
        )}

        <label className={label}>
          Where <span className="normal-case tracking-normal text-ink-faint/70">optional</span>
        </label>
        <input
          value={location}
          onChange={(e) => setLocation(e.target.value)}
          placeholder="School hall"
          className={field + " mb-3 text-xs"}
        />

        <label className={label}>
          Notes <span className="normal-case tracking-normal text-ink-faint/70">optional</span>
        </label>
        <textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          rows={2}
          placeholder="Anything you'll want to remember on the day"
          className={field + " mb-3 resize-none text-xs"}
        />

        <label className={label}>Remind me</label>
        <div className="flex flex-wrap gap-1.5">
          {REMINDER_CHOICES.map((r) => (
            <button
              key={r.minutes}
              onClick={() => toggleReminder(r.minutes)}
              aria-pressed={reminders.includes(r.minutes)}
              className={
                "rounded-full border px-2.5 py-1 text-[11px] transition " +
                (reminders.includes(r.minutes)
                  ? "border-brand bg-brand/15 font-medium text-brand"
                  : "border-line text-ink-muted hover:text-ink")
              }
            >
              {r.label}
            </button>
          ))}
        </div>
        <p className="mt-1.5 text-[10px] leading-relaxed text-ink-faint">
          Reminders show up while Recall is open. For a nudge that reaches your phone, export the
          event to your phone&apos;s own calendar with the ↓ button on the calendar header.
        </p>

        <div className="mt-4 flex items-center gap-2">
          {onDelete && (
            <button
              onClick={() => {
                onDelete();
                onClose();
              }}
              className="rounded-lg border border-line px-3 py-1.5 text-xs text-ink-muted transition hover:border-red-500/40 hover:text-red-400"
            >
              Delete
            </button>
          )}
          <button
            onClick={onClose}
            className="ml-auto rounded-lg border border-line px-3 py-1.5 text-xs text-ink-muted transition hover:text-ink"
          >
            Cancel
          </button>
          <button
            onClick={submit}
            disabled={!title.trim() || !date}
            className="rounded-lg bg-brand px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-brand-2 disabled:opacity-40"
          >
            {initial ? "Save" : "Add to calendar"}
          </button>
        </div>
      </div>
    </div>
  );
}
