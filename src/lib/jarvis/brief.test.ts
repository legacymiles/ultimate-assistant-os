import { describe, expect, it } from "vitest";
import { briefInputs, eventKey, localDate, overlaps } from "./brief";
import { emptyJarvis } from "./store";
import type { CalEvent, JarvisStore } from "./types";
import { newProfile } from "@/lib/new-dashboard/model";

function ev(partial: Partial<CalEvent> & { id: string }): CalEvent {
  return {
    title: "Event",
    date: "2026-09-19",
    start: "10:00",
    end: "11:00",
    timezone: "Europe/London",
    app: "manual",
    ...partial,
  };
}

describe("brief inputs", () => {
  it("invents nothing when the store is empty", () => {
    const b = briefInputs(null, emptyJarvis(), new Date("2026-09-19T09:00:00"));
    expect(b.openPriorities).toEqual([]);
    expect(b.nextEvents).toEqual([]);
    expect(b.unread).toEqual([]);
    expect(b.recentMemories).toEqual([]);
    expect(b.empty).toBe(true);
  });

  it("lists only the priorities the owner has not ticked off", () => {
    const p = newProfile("Owner");
    p.intake.q3 = ["Ship Jarvis", "", "Find two clients"];
    p.prioritiesDone = [0];
    const b = briefInputs(p, emptyJarvis(), new Date("2026-09-19T09:00:00"));
    expect(b.openPriorities).toEqual([{ index: 2, text: "Find two clients" }]);
  });

  it("shows the next three events and skips ones already finished today", () => {
    const store: JarvisStore = {
      ...emptyJarvis(),
      events: [
        ev({ id: "past", start: "08:00", end: "08:30" }),
        ev({ id: "soon", start: "10:00", end: "11:00" }),
        ev({ id: "later", start: "14:00", end: "15:00" }),
        ev({ id: "tomorrow", date: "2026-09-20", start: "09:00", end: "10:00" }),
        ev({ id: "next-week", date: "2026-09-26", start: "09:00", end: "10:00" }),
      ],
    };
    const b = briefInputs(null, store, new Date("2026-09-19T09:00:00"));
    expect(b.nextEvents.map((e) => e.id)).toEqual(["soon", "later", "tomorrow"]);
  });

  it("keeps an all-day event for today even later in the day", () => {
    const store: JarvisStore = {
      ...emptyJarvis(),
      events: [ev({ id: "allday", start: "", end: "" })],
    };
    const b = briefInputs(null, store, new Date("2026-09-19T21:00:00"));
    expect(b.nextEvents.map((e) => e.id)).toEqual(["allday"]);
  });

  it("sorts an all-day event before a timed one on the same day", () => {
    expect(eventKey(ev({ id: "a", start: "", end: "" })) < eventKey(ev({ id: "b" }))).toBe(true);
  });

  it("uses the local date, not the UTC one", () => {
    // 23:30 local on the 19th is the 19th, even where UTC has already ticked over.
    expect(localDate(new Date(2026, 8, 19, 23, 30))).toBe("2026-09-19");
  });
});

describe("overlap detection", () => {
  it("flags two timed events that clash on one day", () => {
    const clash = overlaps([
      ev({ id: "a", start: "10:00", end: "11:30" }),
      ev({ id: "b", start: "11:00", end: "12:00" }),
      ev({ id: "c", start: "12:00", end: "13:00" }),
    ]);
    expect(clash).toEqual([["a", "b"]]);
  });

  it("does not flag back-to-back events, different days, or all-day events", () => {
    expect(
      overlaps([
        ev({ id: "a", start: "10:00", end: "11:00" }),
        ev({ id: "b", start: "11:00", end: "12:00" }),
        ev({ id: "c", date: "2026-09-20", start: "10:30", end: "11:30" }),
        ev({ id: "d", start: "", end: "" }),
      ]),
    ).toEqual([]);
  });
});
