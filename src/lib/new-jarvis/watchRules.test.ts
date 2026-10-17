import { describe, expect, it } from "vitest";
import { coerceRule, customUpdates, describeRule, parseWatchLocal, type Watch } from "./watchRules";
import { cameraUpdates, collectUpdates, defaultUpdateSettings, emptyUpdateState, localDay, toNotify } from "@/lib/jarvis/updates";
import type { BoardPayload, ListItem } from "@/lib/recall/lists/types";

// Local-time instants, so the tests hold in any timezone.
const at = (y: number, mo: number, d: number, h: number, mi = 0) => new Date(y, mo - 1, d, h, mi).getTime();
const FRI_10AM = at(2026, 10, 16, 10); // a Friday

const watch = (rule: Watch["rule"], extra: Partial<Watch> = {}): Watch => ({
  id: "w1",
  prompt: "test",
  title: "Test",
  rule,
  on: true,
  createdAt: "2026-10-01T00:00:00Z",
  ...extra,
});

describe("parseWatchLocal", () => {
  it("reads a weekday schedule", () => {
    const p = parseWatchLocal("Every weekday at 9am remind me to call my leads");
    expect(p?.rule).toEqual({ kind: "schedule", time: "09:00", days: [1, 2, 3, 4, 5], message: "Call my leads" });
  });

  it("reads pm times and named days", () => {
    const p = parseWatchLocal("remind me every monday and friday at 5:30pm to send invoices");
    expect(p?.rule.kind).toBe("schedule");
    if (p?.rule.kind === "schedule") {
      expect(p.rule.time).toBe("17:30");
      expect(p.rule.days).toEqual([1, 5]);
    }
  });

  it("reads due-date, camera, spend and keyword rules", () => {
    expect(parseWatchLocal("Tell me when a to-do is due tomorrow")?.rule).toEqual({ kind: "due", listId: "todo", daysAhead: 1 });
    expect(parseWatchLocal("Notify me when a new photo is taken")?.rule).toEqual({ kind: "camera", atLeast: 1 });
    expect(parseWatchLocal("Alert me if AI spend goes over $5 today")?.rule).toEqual({ kind: "spend", over: 5 });
    expect(parseWatchLocal("Let me know when anything mentions rent or invoice")?.rule).toEqual({
      kind: "match",
      source: "any",
      contains: ["rent", "invoice"],
    });
  });

  it("says no rather than guessing", () => {
    expect(parseWatchLocal("make me a sandwich")).toBeNull();
    expect(parseWatchLocal("")).toBeNull();
  });
});

describe("coerceRule", () => {
  it("rejects shapes the evaluator can't run", () => {
    expect(coerceRule({ kind: "schedule", time: "25:00", days: [], message: "x" })).toBeNull();
    expect(coerceRule({ kind: "match", contains: [] })).toBeNull();
    expect(coerceRule({ kind: "spend", over: -1 })).toBeNull();
    expect(coerceRule({ kind: "shell", cmd: "rm -rf /" })).toBeNull();
  });
  it("cleans what it keeps", () => {
    expect(coerceRule({ kind: "match", source: "nope", contains: ["  Rent "] })).toEqual({ kind: "match", source: "any", contains: ["rent"] });
    expect(coerceRule({ kind: "schedule", time: "09:00", days: [5, 1, 1, 9], message: "" })).toEqual({ kind: "schedule", time: "09:00", days: [1, 5], message: "Reminder" });
  });
});

describe("describeRule", () => {
  it("reads back what will happen", () => {
    expect(describeRule({ kind: "schedule", time: "09:00", days: [1, 2, 3, 4, 5], message: "Call leads" })).toBe("Every weekday at 9am: “Call leads”");
    expect(describeRule({ kind: "camera", atLeast: 1 })).toMatch(/new photo/);
  });
});

describe("customUpdates", () => {
  const base = { rows: [], board: null, spend: null, camera: [] };

  it("fires a schedule once its time has passed, on the right days, with a per-day id", () => {
    const w = watch({ kind: "schedule", time: "09:00", days: [1, 2, 3, 4, 5], message: "Call leads" });
    const got = customUpdates([w], { ...base, now: FRI_10AM });
    expect(got).toHaveLength(1);
    expect(got[0].id).toBe(`custom:w1:${localDay(new Date(FRI_10AM).toISOString())}`);
    expect(customUpdates([w], { ...base, now: at(2026, 10, 16, 8) })).toHaveLength(0); // before 9
    expect(customUpdates([w], { ...base, now: at(2026, 10, 17, 10) })).toHaveLength(0); // Saturday
    expect(customUpdates([{ ...w, on: false }], { ...base, now: FRI_10AM })).toHaveLength(0);
  });

  it("matches other rows by word and source", () => {
    const rows = [
      { id: "lists:add:1", source: "lists" as const, title: "Pay rent", detail: "added to To-Do", at: "2026-10-16T13:00:00Z", when: "1h ago" },
      { id: "calendar:soon:2", source: "calendar" as const, title: "Dentist", detail: "starts 14:00", at: "2026-10-16T13:00:00Z", when: "in 3h" },
    ];
    const w = watch({ kind: "match", source: "any", contains: ["rent"] });
    const got = customUpdates([w], { ...base, rows, now: FRI_10AM });
    expect(got.map((g) => g.id)).toEqual(["custom:w1:lists:add:1"]);
    const onlyCal = watch({ kind: "match", source: "calendar", contains: ["rent"] });
    expect(customUpdates([onlyCal], { ...base, rows, now: FRI_10AM })).toHaveLength(0);
  });

  it("raises list items coming due", () => {
    const today = localDay(new Date(FRI_10AM).toISOString());
    const item = (id: string, dueDate: string, extra: Partial<ListItem> = {}): ListItem => ({
      id,
      listId: "todo",
      text: `item ${id}`,
      priority: null,
      dueDate,
      done: false,
      authorId: "me",
      createdAt: "2026-10-01T00:00:00Z",
      updatedAt: "2026-10-01T00:00:00Z",
      ...extra,
    });
    const tomorrow = localDay(new Date(at(2026, 10, 17, 12)).toISOString());
    const board = { items: [item("a", today), item("b", tomorrow), item("c", "2026-12-01"), item("d", today, { done: true })] } as BoardPayload;
    const got = customUpdates([watch({ kind: "due", listId: "todo", daysAhead: 1 })], { ...base, board, now: FRI_10AM });
    expect(got.map((g) => g.title).sort()).toEqual(["item a", "item b"]);
  });

  it("fires on spend over the limit and on new photos", () => {
    const spend = { recent: [{ at: new Date(at(2026, 10, 16, 9)).toISOString(), model: "m", cost: 3 }, { at: new Date(at(2026, 10, 16, 9, 30)).toISOString(), model: "m", cost: 3 }], account: null };
    expect(customUpdates([watch({ kind: "spend", over: 5 })], { ...base, spend, now: FRI_10AM })[0].title).toMatch(/\$6/);
    expect(customUpdates([watch({ kind: "spend", over: 10 })], { ...base, spend, now: FRI_10AM })).toHaveLength(0);
    const camera = [{ id: "p1", addedAt: new Date(at(2026, 10, 16, 9, 50)).toISOString() }];
    const a = customUpdates([watch({ kind: "camera", atLeast: 1 })], { ...base, camera, now: FRI_10AM });
    const b = customUpdates([watch({ kind: "camera", atLeast: 1 })], { ...base, camera: [...camera, { id: "p2", addedAt: new Date(at(2026, 10, 16, 9, 55)).toISOString() }], now: FRI_10AM });
    expect(a[0].id).not.toBe(b[0].id); // a new photo is a new notification
  });
});

describe("camera notifications in the feed", () => {
  it("one row per day, re-raised when more photos arrive, and popping up by default", () => {
    const q = (n: number) => Array.from({ length: n }, (_, i) => ({ id: `p${i}`, addedAt: new Date(at(2026, 10, 16, 9, i)).toISOString() }));
    const one = cameraUpdates(q(2), [], FRI_10AM);
    const two = cameraUpdates(q(3), [], FRI_10AM);
    expect(one).toHaveLength(1);
    expect(one[0].title).toBe("2 new photos to sort");
    expect(one[0].id).not.toBe(two[0].id);
    expect(cameraUpdates([], [{ id: "x", receivedAt: new Date(FRI_10AM).toISOString() }], FRI_10AM)[0].title).toMatch(/on your iPhone/);

    const settings = defaultUpdateSettings();
    const state = { ...emptyUpdateState(), seenAt: new Date(at(2026, 10, 16, 8)).toISOString() };
    const got = collectUpdates(
      { board: null, events: [], items: [], photoFolderIds: new Set(), proposals: [], actions: [], spend: null, camera: q(1), watches: [] },
      settings,
      state,
      FRI_10AM,
    );
    expect(got.updates.map((u) => u.source)).toEqual(["camera"]);
    expect(toNotify(got.updates, settings, state)).toHaveLength(1);
  });
});
