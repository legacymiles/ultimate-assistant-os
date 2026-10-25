import { describe, expect, it } from "vitest";
import {
  birthdayDigest,
  birthdayEvents,
  birthdayNotices,
  coerceBirthdays,
  daysUntil,
  nextOccurrence,
  parseBirthdayDate,
  removeBirthday,
  turning,
  upsertBirthday,
  type Birthday,
} from "./engine";

const NOW = new Date(2026, 9, 25, 19, 15); // Sun Oct 25 2026, 7:15 PM local
let n = 0;
const id = () => `b${++n}`;

function add(list: Birthday[], input: Parameters<typeof upsertBirthday>[1]): Birthday[] {
  const out = upsertBirthday(list, input, { now: NOW, id });
  if ("error" in out) throw new Error(out.error);
  return out.list;
}

describe("parseBirthdayDate", () => {
  it("reads what people type", () => {
    expect(parseBirthdayDate("March 14", NOW)).toEqual({ month: 3, day: 14, year: null });
    expect(parseBirthdayDate("mar 14th, 1990", NOW)).toEqual({ month: 3, day: 14, year: 1990 });
    expect(parseBirthdayDate("14th of March", NOW)).toEqual({ month: 3, day: 14, year: null });
    expect(parseBirthdayDate("3/14", NOW)).toEqual({ month: 3, day: 14, year: null });
    expect(parseBirthdayDate("3/14/90", NOW)).toEqual({ month: 3, day: 14, year: 1990 });
    expect(parseBirthdayDate("03/14/2005", NOW)).toEqual({ month: 3, day: 14, year: 2005 });
    expect(parseBirthdayDate("1990-03-14", NOW)).toEqual({ month: 3, day: 14, year: 1990 });
    expect(parseBirthdayDate("Sept 9", NOW)).toEqual({ month: 9, day: 9, year: null });
  });
  it("treats a this-year ISO date as no birth year (the model resolving 'March 14')", () => {
    expect(parseBirthdayDate("2027-03-14", NOW)).toEqual({ month: 3, day: 14, year: null });
  });
  it("refuses days that do not exist", () => {
    expect(parseBirthdayDate("2/30", NOW)).toBeNull();
    expect(parseBirthdayDate("13/1", NOW)).toBeNull();
    expect(parseBirthdayDate("someday", NOW)).toBeNull();
  });
  it("accepts Feb 29", () => {
    expect(parseBirthdayDate("Feb 29", NOW)).toEqual({ month: 2, day: 29, year: null });
  });
});

describe("next birthday", () => {
  it("today counts, and past ones roll to next year", () => {
    expect(daysUntil({ month: 10, day: 25 }, NOW)).toBe(0);
    expect(daysUntil({ month: 10, day: 27 }, NOW)).toBe(2);
    expect(nextOccurrence({ month: 10, day: 24 }, NOW).getFullYear()).toBe(2027);
  });
  it("Feb 29 lands on Feb 28 in a normal year", () => {
    const d = nextOccurrence({ month: 2, day: 29 }, NOW);
    expect([d.getFullYear(), d.getMonth() + 1, d.getDate()]).toEqual([2027, 2, 28]);
  });
  it("knows the age they turn", () => {
    expect(turning({ month: 10, day: 27, year: 1966 }, NOW)).toBe(60);
    expect(turning({ month: 1, day: 2, year: 2000 }, NOW)).toBe(27);
    expect(turning({ month: 1, day: 2, year: null }, NOW)).toBeNull();
  });
});

describe("upsert — no duplicates", () => {
  it("adds newest first and guesses family from the relation", () => {
    let list = add([], { name: "Linda", relation: "Mom", date: "March 14" });
    list = add(list, { name: "Tyler", date: "7/4" });
    expect(list.map((b) => b.name)).toEqual(["Tyler", "Linda"]);
    expect(list[1].circle).toBe("family");
    expect(list[0].circle).toBe("friend");
  });
  it("same name updates the one already there", () => {
    let list = add([], { name: "Mom", date: "March 14" });
    const out = upsertBirthday(list, { name: "mom", date: "March 15 1966" }, { now: NOW, id });
    if ("error" in out) throw new Error(out.error);
    expect(out.outcome).toBe("updated");
    list = out.list;
    expect(list).toHaveLength(1);
    expect([list[0].month, list[0].day, list[0].year]).toEqual([3, 15, 1966]);
  });
  it("says plainly what is wrong", () => {
    expect(upsertBirthday([], { name: "", date: "3/14" }, { now: NOW })).toHaveProperty("error");
    expect(upsertBirthday([], { name: "Al", date: "whenever" }, { now: NOW })).toHaveProperty("error");
  });
  it("removes by name", () => {
    const list = add([], { name: "Tyler", date: "7/4" });
    const out = removeBirthday(list, "tyler's");
    expect(out.removed?.name).toBe("Tyler");
    expect(out.list).toHaveLength(0);
  });
  it("coerce drops junk and duplicate names", () => {
    const list = coerceBirthdays({
      people: [
        { id: "a", name: "Mom", month: 3, day: 14 },
        { id: "b", name: "mom", month: 4, day: 1 },
        { id: "c", name: "Bad", month: 2, day: 31 },
        null,
      ],
    });
    expect(list.map((b) => b.id)).toEqual(["a"]);
  });
});

describe("notifications — only from 2 days out", () => {
  const list = add(add(add(add([], { name: "Mom", date: "10/27/1966" }), { name: "Tyler", date: "10/26" }), { name: "Aunt Jo", date: "10/25" }), {
    name: "Sam",
    date: "10/28",
  });

  it("2 days, tomorrow and today show; 3 days out does not", () => {
    const rows = birthdayNotices(list, NOW);
    expect(rows.map((r) => r.when)).toEqual(["today", "tomorrow", "in 2d"]);
    expect(rows.some((r) => r.title.includes("Sam"))).toBe(false);
    expect(rows[2].detail).toContain("turns 60");
  });
  it("each day of the countdown is its own row (one pop-up a day)", () => {
    const mom = list.find((b) => b.name === "Mom")!;
    const d2 = birthdayNotices([mom], NOW)[0].id;
    const d1 = birthdayNotices([mom], new Date(2026, 9, 26, 9))[0].id;
    expect(d1).not.toBe(d2);
  });
  it("is gone the day after", () => {
    expect(birthdayNotices(list, new Date(2026, 9, 29, 8)).some((r) => r.title.includes("Mom"))).toBe(false);
  });
});

describe("calendar events", () => {
  it("one all-day event per person per year, stable ids", () => {
    const list = add([], { name: "Mom", date: "3/14/1966" });
    const evs = birthdayEvents(list, new Date(2026, 0, 1), new Date(2027, 11, 31));
    expect(evs.map((e) => e.date)).toEqual(["2026-03-14", "2027-03-14"]);
    expect(evs[0].title).toBe("🎂 Mom's birthday (turns 60)");
    expect(new Set(evs.map((e) => e.id)).size).toBe(2);
  });
});

describe("digest", () => {
  it("lists soonest first for the chat", () => {
    const list = add(add([], { name: "Mom", date: "3/14" }), { name: "Tyler", date: "10/26" });
    const text = birthdayDigest(list, NOW);
    expect(text.indexOf("Tyler")).toBeLessThan(text.indexOf("Mom"));
    expect(text).toContain("tomorrow");
  });
});

describe("Dashboard notifications feed", () => {
  it("birthdays reach the feed and pop up by default — only from 2 days out", async () => {
    const { collectUpdates, emptyUpdates, toNotify } = await import("@/lib/jarvis/updates");
    const blob = emptyUpdates();
    const state = { ...blob.state, seenAt: new Date(2026, 9, 20).toISOString() };
    const list = add(add([], { name: "Mom", date: "10/27" }), { name: "Sam", date: "10/28" });
    const got = collectUpdates(
      { board: null, events: [], items: [], photoFolderIds: new Set(), proposals: [], actions: [], spend: null, birthdays: list },
      blob.settings,
      state,
      NOW.getTime(),
    );
    const rows = got.updates.filter((u) => u.source === "birthdays");
    expect(rows.map((r) => r.title)).toEqual(["🎂 Mom's birthday is in 2 days"]);
    expect(toNotify(got.updates, blob.settings, state).map((u) => u.source)).toContain("birthdays");
  });
});
