import { describe, expect, it } from "vitest";
import { addSnapshot, mergePosts, newPersona, MAX_SNAPSHOTS } from "./logic";
import { normalizeBoard } from "./store";
import {
  bestTimes,
  captionFor,
  dailyViews,
  draftFromIdea,
  draftsOn,
  gainedSince,
  growthCurve,
  momentum,
  nextBestSlot,
  newDraft,
  parseHashtags,
  personaTotals,
  scheduleOnDay,
  weekDays,
  weekStart,
  withFollowerPoint,
  withResult,
} from "./studio";
import type { Account, Post } from "./types";

const H = 3_600_000;
const post = (o: Partial<Post>): Post => ({
  id: Math.random().toString(36).slice(2),
  platform: "tiktok",
  url: "",
  caption: "",
  addedAt: "2026-10-01T00:00:00Z",
  source: "sync",
  ...o,
});

describe("stat history", () => {
  it("records a reading per sync and skips one that changed nothing", () => {
    let h = addSnapshot([], { views: 10 }, "2026-10-01T01:00:00Z");
    h = addSnapshot(h, { views: 10 }, "2026-10-01T02:00:00Z");
    h = addSnapshot(h, { views: 50 }, "2026-10-01T03:00:00Z");
    expect(h.map((x) => x.views)).toEqual([10, 50]);
  });

  it("never grows past the cap and keeps the first and latest readings", () => {
    let h = addSnapshot([], { views: 0 }, new Date(0).toISOString());
    for (let i = 1; i <= 200; i++) h = addSnapshot(h, { views: i }, new Date(i * H).toISOString());
    expect(h.length).toBe(MAX_SNAPSHOTS);
    expect(h[0].views).toBe(0);
    expect(h[h.length - 1].views).toBe(200);
  });

  it("re-syncing a post keeps one copy and adds to its history (D5)", () => {
    const a = post({ externalId: "tiktok:1", stats: { views: 100 }, addedAt: "2026-10-01T01:00:00Z" });
    const merged1 = mergePosts([], [a]);
    const merged2 = mergePosts(merged1, [{ ...a, id: "other", stats: { views: 900 }, addedAt: "2026-10-02T01:00:00Z" }]);
    expect(merged2).toHaveLength(1);
    expect(merged2[0].history?.map((x) => x.views)).toEqual([100, 900]);
    expect(merged2[0].stats?.views).toBe(900);
  });
});

describe("growth and momentum", () => {
  it("draws a curve from zero at posting time", () => {
    const p = post({ postedAt: "2026-10-01T00:00:00Z", history: [{ at: "2026-10-01T02:00:00Z", views: 200 }, { at: "2026-10-01T10:00:00Z", views: 1000 }] });
    expect(growthCurve(p)).toEqual([
      { h: 0, views: 0, likes: 0 },
      { h: 2, views: 200, likes: 0 },
      { h: 10, views: 1000, likes: 0 },
    ]);
  });

  it("calls a breakout against the persona's own median", () => {
    const now = Date.parse("2026-10-10T00:00:00Z");
    const old = (v: number) => post({ postedAt: "2026-10-01T00:00:00Z", stats: { views: v } });
    const peers = [old(1000), old(1200), old(800)];
    const hit = old(9000);
    expect(momentum(hit, [...peers, hit], now).kind).toBe("breakout");
    expect(momentum(peers[0], [...peers, hit], now).kind).toBe("normal");
    const fresh = post({ postedAt: "2026-10-09T22:00:00Z", stats: { views: 5 } });
    expect(momentum(fresh, [...peers, fresh], now).kind).toBe("new");
  });

  it("works out views gained in a window", () => {
    const now = Date.parse("2026-10-10T00:00:00Z");
    const p = post({ history: [{ at: "2026-10-01T00:00:00Z", views: 100 }, { at: "2026-10-05T00:00:00Z", views: 400 }, { at: "2026-10-09T00:00:00Z", views: 1000 }] });
    // Window starts 3 Oct, halfway between the 100 and 400 readings → 250.
    expect(gainedSince(p, 7 * 24, now)).toBe(750);
  });
});

describe("totals", () => {
  it("counts this week's views without relabelling lifetime totals", () => {
    const now = Date.parse("2026-10-10T12:00:00Z");
    const p = newPersona({ name: "X" });
    p.posts = [
      // Old post: 10.5k lifetime, but only 500 gained this week (readings either side of the window start).
      post({ postedAt: "2026-09-01T00:00:00Z", stats: { views: 10_500 }, history: [{ at: "2026-10-03T12:00:00Z", views: 10_000 }, { at: "2026-10-09T00:00:00Z", views: 10_500 }] }),
      // New post this week.
      post({ postedAt: "2026-10-08T00:00:00Z", stats: { views: 2000 } }),
    ];
    const t = personaTotals(p, now);
    expect(t.views7d).toBe(2500);
    expect(t.posts7d).toBe(1);
  });

  it("spreads daily views over the days they happened", () => {
    const now = Date.parse("2026-10-10T12:00:00Z");
    const p = post({ postedAt: "2026-10-08T10:00:00Z", history: [{ at: "2026-10-08T12:00:00Z", views: 100 }, { at: "2026-10-09T12:00:00Z", views: 300 }, { at: "2026-10-10T08:00:00Z", views: 350 }] });
    const d = dailyViews([p], 3, now);
    expect(d.reduce((s, n) => s + n, 0)).toBe(350);
    expect(d[2]).toBe(50);
  });

  it("keeps one follower point per day", () => {
    let a: Account = { id: "a", platform: "tiktok", handle: "x", url: "" };
    a = withFollowerPoint(a, 100, "2026-10-01T01:00:00Z");
    a = withFollowerPoint(a, 120, "2026-10-01T09:00:00Z");
    a = withFollowerPoint(a, 150, "2026-10-02T09:00:00Z");
    expect(a.followerHistory?.map((x) => x.n)).toEqual([120, 150]);
  });
});

describe("drafts and the calendar", () => {
  it("turns an idea into a draft aimed at the matching accounts", () => {
    const p = newPersona({ name: "X" });
    p.accounts = [
      { id: "t", platform: "tiktok", handle: "x", url: "" },
      { id: "i", platform: "instagram", handle: "x", url: "" },
    ];
    const d = draftFromIdea({ id: "i1", title: "T", hook: "H", format: "", outline: ["a"], why: "w", platform: "instagram", status: "saved" }, p);
    expect(d.accountIds).toEqual(["i"]);
    expect(d.stage).toBe("script");
  });

  it("fits hashtags inside each platform's limit", () => {
    const d = { title: "t", caption: "a".repeat(270), hashtags: ["one", "two", "three"] };
    expect(captionFor(d, "x").length).toBeLessThanOrEqual(280);
    expect(captionFor(d, "tiktok")).toContain("#three");
    expect(parseHashtags("#Rap #rap, fyp music")).toEqual(["rap", "fyp", "music"]);
  });

  it("builds Monday-first weeks", () => {
    const s = weekStart(new Date(2026, 9, 18)); // a Sunday
    expect(weekDays(s)[0]).toBe("2026-10-12");
    expect(weekDays(s)[6]).toBe("2026-10-18");
  });

  it("never schedules into the past", () => {
    const now = new Date(2026, 9, 18, 20, 30);
    const at = new Date(scheduleOnDay(newDraft(), "2026-10-18", 9, now));
    expect(at.getTime()).toBeGreaterThan(now.getTime());
    const later = new Date(scheduleOnDay(newDraft(), "2026-10-20", 9, now));
    expect(later.getHours()).toBe(9);
  });

  it("finds drafts on a day and moves to posted when every account is done", () => {
    let d = newDraft({ accountIds: ["a", "b"], scheduledAt: new Date(2026, 9, 20, 18).toISOString() });
    expect(draftsOn([d], "2026-10-20")).toHaveLength(1);
    d = withResult(d, { accountId: "a", status: "posted", at: "x" });
    expect(d.stage).not.toBe("posted");
    d = withResult(d, { accountId: "b", status: "failed", at: "x" });
    d = withResult(d, { accountId: "b", status: "manual", at: "y" });
    expect(d.results).toHaveLength(2);
    expect(d.stage).toBe("posted");
  });
});

describe("next best slot", () => {
  it("skips the past and slots already taken", () => {
    const p = newPersona({ name: "X" });
    const now = new Date(2026, 9, 18, 17, 50);
    const first = new Date(nextBestSlot(p, now));
    expect(first.getHours()).toBe(20); // 6 pm is 10 minutes away — too soon
    p.drafts = [newDraft({ scheduledAt: first.toISOString(), stage: "scheduled" })];
    const second = new Date(nextBestSlot(p, now));
    expect(second.getDate()).toBe(19);
    expect(second.getHours()).toBe(12);
  });
});

describe("best time", () => {
  it("ranks the slot whose posts did best", () => {
    const at = (dow: number, h: number, v: number) => {
      const d = new Date(2026, 9, 12 + dow, h); // 12 Oct 2026 is a Monday
      return post({ postedAt: d.toISOString(), stats: { views: v } });
    };
    const { top, grid } = bestTimes([at(0, 9, 100), at(2, 18, 5000), at(2, 18, 4000), at(4, 12, 300)]);
    expect(top[0]).toMatchObject({ dow: 2, hour: 18 });
    expect(grid[6][3]).toBeNull();
  });
});

describe("old saved data", () => {
  it("loads a Social Personas blob from before the Studio", () => {
    const b = normalizeBoard({ version: 1, personas: [{ id: "p", name: "Old", accounts: [], posts: [], ideaDays: [], chat: [] }] });
    expect(b.personas[0].drafts).toEqual([]);
    expect(b.personas[0].overview).toBe("");
  });
});
