import { describe, expect, it } from "vitest";
import { DEMO_SCRIPT, createDemoFeed, demoViewerCount } from "./demo";
import { Director } from "./director";
import { parseEvent } from "./events";

describe("demo feed", () => {
  it("opens with the brief's own conversation", () => {
    const texts = DEMO_SCRIPT.map((b) => b.raw.text);
    expect(texts).toContain("What's your name?");
    expect(texts).toContain("Are you actually AI?");
    expect(texts).toContain("Tell us a joke.");
  });

  it("is deterministic for a seed and keeps going after the script", () => {
    const a = createDemoFeed(3);
    const b = createDemoFeed(3);
    for (let i = 0; i < DEMO_SCRIPT.length + 40; i += 1) expect(a.next()).toEqual(b.next());
  });

  it("only produces events the real parser accepts", () => {
    const feed = createDemoFeed(1);
    for (let i = 0; i < 120; i += 1) expect(parseEvent(feed.next().raw, i)).not.toBeNull();
  });

  it("exercises every safety rule in its opening script, through the real director", () => {
    const d = new Director({ characterName: "Alex", fillers: [] });
    const outcomes = DEMO_SCRIPT.map((b, i) => d.enqueue(parseEvent({ ...b.raw, ts: i }, i)!).status);
    expect(outcomes.filter((s) => s === "blocked")).toHaveLength(2);
    expect(outcomes.filter((s) => s === "queued").length).toBeGreaterThan(10);
  });

  it("drops the scripted duplicate question when the director reaches it", () => {
    const d = new Director({ characterName: "Alex", fillers: [], maxPerMinute: 100 });
    DEMO_SCRIPT.forEach((b, i) => d.enqueue(parseEvent({ ...b.raw, ts: i }, i)!));
    const answered: string[] = [];
    for (let t = 0; t < 40; t += 1) {
      const turn = d.next(1000 + t);
      if (turn?.kind === "answer") answered.push(turn.event.text);
      if (turn) d.markSpoken(1000 + t);
    }
    expect(answered.filter((x) => /actually ai/i.test(x))).toHaveLength(1);
  });
});

describe("demoViewerCount", () => {
  it("climbs, then stays in a plausible band", () => {
    expect(demoViewerCount(0)).toBeLessThan(demoViewerCount(5 * 60_000));
    for (let m = 0; m < 120; m += 7) {
      const n = demoViewerCount(m * 60_000);
      expect(n).toBeGreaterThan(0);
      expect(n).toBeLessThan(260);
    }
  });
});
