import { describe, expect, it } from "vitest";
import {
  MAX_SEEN,
  OPEN_APPS,
  ago,
  awaitingReply,
  checkReply,
  filterThreads,
  inboxOf,
  isUnread,
  markSeen,
  mergeThreads,
  replyBlocker,
  sampleThreads,
  sortThreads,
  toggleApp,
  unreadCounts,
  withSent,
  type InboxThread,
} from "./inbox";
import { newPersona } from "./logic";

const NOW = Date.parse("2026-10-20T12:00:00Z");
const iso = (minsAgo: number) => new Date(NOW - minsAgo * 60_000).toISOString();

const thread = (o: Partial<InboxThread> & { id: string }): InboxThread => ({
  platform: "instagram",
  accountId: "a1",
  kind: "dm",
  who: { name: "Jo" },
  messages: [{ id: "m1", mine: false, author: "Jo", text: "hey", at: iso(10) }],
  lastAt: iso(10),
  replyTo: "u1",
  ...o,
});

describe("read state", () => {
  it("is unread only when the last word is theirs and it's newer than the read-mark", () => {
    const t = thread({ id: "t1" });
    expect(isUnread(t, {})).toBe(true);
    expect(isUnread(t, { t1: t.lastAt })).toBe(false);
    expect(isUnread(t, { t1: iso(60) })).toBe(true);
    const answered = withSent(t, "hi!", "Me", iso(5));
    expect(awaitingReply(answered)).toBe(false);
    expect(isUnread(answered, {})).toBe(false);
  });

  it("marks read without growing past the cap, dropping the oldest marks", () => {
    let inbox = inboxOf({ ...newPersona({ name: "P" }) });
    expect(markSeen(inbox, [])).toBe(inbox);
    const many = Array.from({ length: MAX_SEEN + 50 }, (_, i) => ({ id: `t${i}`, lastAt: iso(MAX_SEEN + 50 - i) }));
    inbox = markSeen(inbox, many);
    const keys = Object.keys(inbox.seen);
    expect(keys).toHaveLength(MAX_SEEN);
    expect(keys).toContain(`t${MAX_SEEN + 49}`);
    expect(keys).not.toContain("t0");
  });

  it("counts unread per platform", () => {
    const list = [thread({ id: "a" }), thread({ id: "b", platform: "youtube", kind: "comment" }), thread({ id: "c", platform: "youtube", kind: "comment" })];
    expect(unreadCounts(list, { c: list[2]!.lastAt })).toEqual({ total: 2, instagram: 1, youtube: 1 });
  });
});

describe("open-inbox tiles", () => {
  it("toggles without duplicates", () => {
    let i = { apps: [], seen: {} } as { apps: string[]; seen: Record<string, string> };
    i = toggleApp(i, "tinder");
    i = toggleApp(i, "tiktok");
    expect(i.apps).toEqual(["tinder", "tiktok"]);
    expect(toggleApp(i, "tinder").apps).toEqual(["tiktok"]);
  });

  it("has a unique id and a reason for every app", () => {
    expect(new Set(OPEN_APPS.map((a) => a.id)).size).toBe(OPEN_APPS.length);
    for (const a of OPEN_APPS) {
      expect(a.why.length).toBeGreaterThan(5);
      if (a.url) expect(a.url.startsWith("https://")).toBe(true);
    }
    expect(OPEN_APPS.some((a) => a.id === "tinder")).toBe(true);
  });

  it("reads old personas with no inbox safely", () => {
    const p = newPersona({ name: "Old" });
    delete (p as { inbox?: unknown }).inbox;
    expect(inboxOf(p)).toEqual({ apps: [], seen: {} });
  });
});

describe("threads", () => {
  it("sorts newest first and filters by platform, kind, unread and text", () => {
    const list = sortThreads([
      thread({ id: "old", lastAt: iso(100), who: { name: "Ana" } }),
      thread({ id: "new", lastAt: iso(1), platform: "facebook", kind: "comment", post: { title: "Studio tour" } }),
    ]);
    expect(list.map((t) => t.id)).toEqual(["new", "old"]);
    expect(filterThreads(list, { platform: "facebook" }, {}).map((t) => t.id)).toEqual(["new"]);
    expect(filterThreads(list, { kind: "dm" }, {}).map((t) => t.id)).toEqual(["old"]);
    expect(filterThreads(list, { q: "studio" }, {}).map((t) => t.id)).toEqual(["new"]);
    expect(filterThreads(list, { q: "ana" }, {}).map((t) => t.id)).toEqual(["old"]);
    expect(filterThreads(list, { unreadOnly: true }, { new: list[0]!.lastAt }).map((t) => t.id)).toEqual(["old"]);
  });

  it("keeps a just-sent reply until the platform lists it, then doesn't double it", () => {
    const t = thread({ id: "t" });
    const sent = withSent(t, "on my way", "Me", iso(2));
    let merged = mergeThreads([sent], [t]);
    expect(merged[0]!.messages.map((m) => m.text)).toEqual(["hey", "on my way"]);
    const platformHasIt = { ...t, messages: [...t.messages, { id: "p2", mine: true, author: "Me", text: "on my way", at: iso(2) }] };
    merged = mergeThreads(merged, [platformHasIt]);
    expect(merged[0]!.messages.map((m) => m.id)).toEqual(["m1", "p2"]);
  });

  it("keeps threads from accounts that weren't fetched this round", () => {
    const a = thread({ id: "a", accountId: "a1" });
    const b = thread({ id: "b", accountId: "a2" });
    expect(mergeThreads([a, b], [], ["a1"]).map((t) => t.id)).toEqual(["b"]);
  });
});

describe("replying", () => {
  it("blocks DMs older than the platforms' 24-hour window, never comments", () => {
    const fresh = thread({ id: "f" });
    const stale = thread({ id: "s", messages: [{ id: "x", mine: false, author: "Jo", text: "hi", at: iso(60 * 25) }] });
    expect(replyBlocker(fresh, NOW)).toBeNull();
    expect(replyBlocker(stale, NOW)).toMatch(/24 hours/);
    expect(replyBlocker({ ...stale, kind: "comment" }, NOW)).toBeNull();
  });

  it("checks empty and too-long replies, and never sends an example", () => {
    const t = thread({ id: "t" });
    expect(checkReply(t, "  ", NOW)).toMatch(/Write/);
    expect(checkReply(t, "x".repeat(1001), NOW)).toMatch(/1000/);
    expect(checkReply(t, "thanks!", NOW)).toBeNull();
    expect(checkReply({ ...t, sample: true }, "thanks!", NOW)).toMatch(/example/);
  });

  it("writes compact times", () => {
    expect(ago(iso(0.5), NOW)).toBe("now");
    expect(ago(iso(5), NOW)).toBe("5m");
    expect(ago(iso(180), NOW)).toBe("3h");
    expect(ago(iso(60 * 50), NOW)).toBe("2d");
  });
});

describe("examples", () => {
  it("are marked as samples, cover all three live platforms, and are newest first", () => {
    const s = sampleThreads(newPersona({ name: "Nova", niche: "Rap music videos" }), NOW);
    expect(s.every((t) => t.sample)).toBe(true);
    expect(new Set(s.map((t) => t.platform))).toEqual(new Set(["instagram", "facebook", "youtube"]));
    expect(sortThreads(s).map((t) => t.id)).toEqual(s.map((t) => t.id));
    expect(s[0]!.messages[0]!.text).toContain("rap music videos");
  });
});
