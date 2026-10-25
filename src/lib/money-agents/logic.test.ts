import { describe, expect, it } from "vitest";
import type { Persona } from "@/lib/social-personas/types";
import {
  EMPTY_BOARD,
  MAX_BRIEF,
  addItems,
  addPayout,
  arrivedFromPc,
  clipBrief,
  dailyPaid,
  draftFor,
  estimate,
  findMoments,
  formatTime,
  itemViews,
  makeState,
  money,
  newAgent,
  newItem,
  normalizeBoard,
  normalizeCampaigns,
  normalizeMoments,
  parseTimestamp,
  parseTranscript,
  removeAgent,
  sourceKey,
  starterIdeas,
  summarize,
  totals,
  upsertAgent,
  videoBrief,
  wentLive,
} from "./logic";
import type { Payout } from "./types";

const seq = () => {
  let n = 0;
  return () => ((n++ * 0.137) % 1);
};

function persona(over: Partial<Persona> = {}): Persona {
  return {
    id: "p1",
    name: "Money clips",
    overview: "",
    niche: "money podcasts",
    contentTypes: [],
    audience: "",
    tone: "",
    goals: "",
    avoid: "",
    hue: 200,
    accounts: [{ id: "a1", platform: "tiktok", handle: "@clips", url: "" }],
    posts: [],
    brain: null,
    ideaDays: [],
    chat: [],
    drafts: [],
    createdAt: "",
    updatedAt: "",
    ...over,
  };
}

describe("time", () => {
  it("reads the timestamps people paste", () => {
    expect(parseTimestamp("1:02:03")).toBe(3723);
    expect(parseTimestamp("62:03")).toBe(3723);
    expect(parseTimestamp("[1:05]")).toBe(65);
    expect(parseTimestamp("75")).toBe(75);
    expect(parseTimestamp("0:07.5")).toBe(7.5);
    expect(parseTimestamp("hello")).toBeNull();
  });

  it("writes them back short", () => {
    expect(formatTime(65)).toBe("1:05");
    expect(formatTime(3723)).toBe("1:02:03");
  });
});

describe("transcripts", () => {
  it("reads inline and YouTube-style transcripts", () => {
    const inline = parseTranscript("[00:00:05] hello there\n0:10 - second line\nno time here");
    expect(inline).toEqual([
      { start: 5, text: "hello there" },
      { start: 10, text: "second line" },
      { start: 10, text: "no time here" },
    ]);
    const yt = parseTranscript("0:00\nwelcome back\n0:04\nso here's the thing");
    expect(yt).toEqual([
      { start: 0, text: "welcome back" },
      { start: 4, text: "so here's the thing" },
    ]);
  });

  it("finds the strong moments, without overlap, inside the length asked for", () => {
    const lines: string[] = [];
    for (let s = 0; s < 600; s += 5) lines.push(`${formatTime(s)} just talking about the weather and stuff`);
    lines[24] = `${formatTime(120)} Here's why nobody tells you the truth about money — I lost $40k!`;
    lines[90] = `${formatTime(450)} When I quit my job my dad said I was crazy? [laughter]`;
    const moments = findMoments(parseTranscript(lines.join("\n")), { count: 3, minSeconds: 20, maxSeconds: 45 });
    expect(moments.length).toBe(3);
    const starts = moments.map((m) => m.start);
    expect(starts).toContain(120);
    expect(starts).toContain(450);
    for (const m of moments) {
      expect(m.end - m.start).toBeGreaterThanOrEqual(20);
      expect(m.end - m.start).toBeLessThanOrEqual(45);
    }
    for (let i = 0; i < moments.length; i++)
      for (let j = i + 1; j < moments.length; j++)
        expect(moments[i].start < moments[j].end && moments[j].start < moments[i].end).toBe(false);
    expect(moments[0].score).toBeGreaterThanOrEqual(moments[2].score);
  });

  it("cleans an AI reply: bad spans dropped, scores clamped, best first", () => {
    const m = normalizeMoments(
      { moments: [
        { start: "1:00", end: "1:30", hook: "a", score: 140 },
        { start: 50, end: 40, hook: "backwards" },
        { start: 10, end: 9999, hook: "too long", score: 20 },
      ] },
      { maxSeconds: 60, duration: 600 },
    );
    expect(m.map((x) => x.hook)).toEqual(["a", "too long"]);
    expect(m[0].score).toBe(100);
    expect(m[1].end).toBe(100); // capped at 1.5 x maxSeconds
  });
});

describe("the board", () => {
  it("survives junk", () => {
    expect(normalizeBoard(null)).toEqual(EMPTY_BOARD);
    const b = normalizeBoard({ agents: [{ id: "x", kind: "weird" }], items: [{ id: "i" }], payouts: [{ id: "p", amount: "no" }] });
    expect(b.agents[0].kind).toBe("clipper");
    expect(b.items).toEqual([]);
    expect(b.payouts).toEqual([]);
  });

  it("never keeps the same clip twice, however the link was copied", () => {
    const agent = newAgent("clipper", {}, seq());
    const a = newItem(agent.id, { sourceUrl: "https://www.youtube.com/watch?v=abcdefghijk&t=5", start: 100 }, seq());
    const b = newItem(agent.id, { sourceUrl: "https://youtu.be/abcdefghijk?si=zz", start: 101.5 }, seq());
    const c = newItem(agent.id, { sourceUrl: "https://youtu.be/abcdefghijk", start: 300 }, seq());
    const { board, added, skipped } = addItems(EMPTY_BOARD, [a, b, c]);
    expect(added.map((i) => i.start)).toEqual([100, 300]);
    expect(skipped).toBe(1);
    expect(board.items[0].start).toBe(100);
    expect(sourceKey("https://youtube.com/shorts/abcdefghijk")).toBe("yt:abcdefghijk");
  });

  it("removing an agent takes its items and payouts with it", () => {
    const a = newAgent("clipper", {}, seq());
    let b = upsertAgent(EMPTY_BOARD, a);
    b = addItems(b, [newItem(a.id, { sourceUrl: "x", start: 1 }, seq())]).board;
    b = addPayout(b, { id: "p", agentId: a.id, amount: 5, date: "2026-10-01", source: "other", note: "", createdAt: "" });
    expect(removeAgent(b, a.id)).toEqual({ ...EMPTY_BOARD });
  });
});

describe("PC briefs", () => {
  it("tell the PC exactly what to cut and never to post", () => {
    const a = newAgent("campaign", { name: "Gym campaign", ratePer1k: 1.5, rules: "No swearing" }, seq());
    a.campaign = { ...a.campaign!, brand: "LiftCo", minViews: 10000 };
    const i = newItem(a.id, { sourceUrl: "https://youtu.be/abcdefghijk", start: 65, end: 95, hook: "Stop doing this" }, seq());
    const brief = clipBrief(a, i);
    expect(brief).toContain("1:05 → 1:35");
    expect(brief).toContain("Stop doing this");
    expect(brief).toContain("No swearing");
    expect(brief).toContain("$1.5/1K");
    expect(brief).toContain("Never post");
    expect(brief.length).toBeLessThanOrEqual(MAX_BRIEF);
  });

  it("stay inside In Queue's limit even with a huge script", () => {
    const a = newAgent("faceless", { niche: "space" }, seq());
    const i = newItem(a.id, {
      kind: "video",
      title: "Space",
      script: { hook: "h", beats: Array(40).fill("x".repeat(500)), cta: "", visuals: [], thumbnail: "", description: "" },
    }, seq());
    expect(videoBrief(a, i).length).toBe(MAX_BRIEF);
  });
});

describe("In Queue status", () => {
  it("follows the request from waiting to a finished video", () => {
    const item = newItem("ag", { requestId: "q-1", stage: "rendering" }, seq());
    expect(makeState({ ...item, requestId: null }, null)).toEqual({ state: "none" });
    expect(makeState(item, { requests: [{ id: "q-1", status: "open" }], finished: [] }).state).toBe("waiting");
    expect(makeState(item, { requests: [{ id: "q-1", status: "working", notes: [{ text: "cutting" }] }], finished: [] })).toEqual({ state: "working", note: "cutting" });
    const done = { requests: [], finished: [{ id: "q-1", video: { key: "k" } }] };
    expect(makeState(item, done).state).toBe("done");
    expect(arrivedFromPc([item], done)).toEqual([item.id]);
    expect(makeState(item, { requests: [], finished: [{ id: "q-1", result: "no ffmpeg" }] })).toEqual({ state: "done-no-video", note: "no ffmpeg" });
  });
});

describe("money", () => {
  it("estimates from synced views, respects the campaign minimum and budget", () => {
    const a = newAgent("campaign", { ratePer1k: 2 }, seq());
    a.campaign = { ...a.campaign!, minViews: 5000, budget: 30 };
    const p = persona({
      posts: [
        { id: "x1", platform: "tiktok", url: "", caption: "", addedAt: "", source: "sync", draftId: "d1", stats: { views: 12000 } },
        { id: "x2", platform: "tiktok", url: "", caption: "", addedAt: "", source: "sync", draftId: "d2", stats: { views: 3000 } },
      ],
    });
    const big = newItem(a.id, { stage: "approved", personaId: "p1", draftId: "d1", sourceUrl: "a", start: 1 }, seq());
    const small = newItem(a.id, { stage: "approved", personaId: "p1", draftId: "d2", sourceUrl: "b", start: 1 }, seq());
    const manual = newItem(a.id, { stage: "posted", manualViews: 20000, sourceUrl: "c", start: 1 }, seq());
    expect(itemViews(big, [p])).toBe(12000);
    expect(estimate(big, a, [p])).toBe(24);
    expect(estimate(small, a, [p])).toBe(0);
    let b = upsertAgent(EMPTY_BOARD, a);
    b = addItems(b, [big, small, manual]).board;
    const s = summarize(a, b, [p]);
    expect(s.views).toBe(35000);
    expect(s.estimated).toBe(30); // 24 + 40 capped by the $30 budget
    expect(s.live).toBe(3);
    expect(wentLive(b.items, [p]).sort()).toEqual([big.id, small.id].sort());
  });

  it("totals this month and draws the last days", () => {
    const pay = (date: string, amount: number): Payout => ({ id: date + amount, agentId: "a", amount, date, source: "campaign", note: "", createdAt: "" });
    let b = EMPTY_BOARD;
    for (const p of [pay("2026-10-24", 10), pay("2026-10-25", 5.5), pay("2026-09-30", 100)]) b = addPayout(b, p);
    expect(b.payouts[0].date).toBe("2026-10-25");
    const t = totals(b, [], "2026-10-25");
    expect(t.paidThisMonth).toBe(15.5);
    expect(t.paidAllTime).toBe(115.5);
    expect(dailyPaid(b.payouts, 3, "2026-10-25")).toEqual([
      { day: "2026-10-23", amount: 0 },
      { day: "2026-10-24", amount: 10 },
      { day: "2026-10-25", amount: 5.5 },
    ]);
    expect(money(15.5)).toBe("$15.50");
    expect(money(1500)).toBe("$1,500");
  });
});

describe("hand-off", () => {
  it("becomes a Ready (or Scheduled) Personas draft that says where it came from", () => {
    const a = newAgent("campaign", { name: "Gym" }, seq());
    a.campaign = { ...a.campaign!, url: "https://whop.com/x" };
    const i = newItem(a.id, { title: "T", hook: "H", caption: "C", hashtags: ["gym"], sourceUrl: "https://youtu.be/abcdefghijk", start: 30 }, seq());
    const ready = draftFor(i, a, { accountIds: ["a1"], scheduledAt: null, media: null, draftId: "d" });
    expect(ready.stage).toBe("ready");
    expect(ready.notes).toContain("0:30");
    expect(ready.notes).toContain("whop.com/x");
    const later = draftFor(i, a, { accountIds: ["a1"], scheduledAt: "2026-10-26T15:00:00Z", media: null, draftId: "d" });
    expect(later.stage).toBe("scheduled");
  });

  it("keeps found campaigns that have a real link, once", () => {
    const found = normalizeCampaigns({ campaigns: [
      { name: "A", url: "https://whop.com/a", ratePer1k: "$1.50" },
      { name: "A again", url: "https://www.whop.com/a/" },
      { name: "no link", url: "whop" },
    ] });
    expect(found).toHaveLength(1);
    expect(found[0].ratePer1k).toBe(1.5);
  });

  it("has offline ideas so the panel is never empty", () => {
    expect(starterIdeas("sharks", 3)).toHaveLength(3);
    expect(starterIdeas("", 2)[0].title).toContain("your niche");
  });
});
