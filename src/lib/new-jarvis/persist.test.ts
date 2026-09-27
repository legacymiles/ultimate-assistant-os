import { describe, expect, it } from "vitest";
import { revive, slim, STORED_BLOCKS } from "./persist";
import { newBlock, type Block } from "./types";

function block(over: Partial<Block> = {}): Block {
  return { ...newBlock({ command: "do a thing", mode: "do" }), status: "done", ...over };
}

describe("slim", () => {
  it("never stores a screenshot, and says the picture is gone", () => {
    const b = block({
      steps: [{ id: "s1", n: 1, tool: "system_screenshot", route: "system/screenshot", args: {}, summary: "shot", status: "ok", result: { ok: true, png: "A".repeat(200_000) } }],
    });
    const stored = JSON.stringify(slim([b]));
    expect(stored).not.toContain("AAAA");
    expect(stored).toContain("pngDropped");
  });

  it("truncates a huge page read rather than dropping the step", () => {
    const b = block({
      steps: [{ id: "s1", n: 1, tool: "browser_read", route: "browser/read", args: {}, summary: "read", status: "ok", result: { text: "x".repeat(50_000), url: "https://a.test" } }],
    });
    const [out] = slim([b]);
    const r = out.steps[0].result as Record<string, string>;
    expect(r.text.length).toBeLessThan(2_500);
    expect(r.text).toContain("not kept");
    expect(r.url).toBe("https://a.test");
  });

  // A tab that closes mid-run must not come back with a ticking timer on a job
  // that nothing is driving any more.
  it("stores a run that was still going as stopped", () => {
    const [out] = slim([block({ status: "running" })]);
    expect(out.status).toBe("stopped");
    expect(out.error).toContain("interrupted");
    expect(out.ms).toBeGreaterThanOrEqual(0);
  });

  it("drops a gate rather than reviving a question nobody can answer", () => {
    const [out] = slim([block({ status: "waiting", gate: { stepId: "s1", summary: "Send it.", why: "", risk: "grave" } })]);
    expect(out.gate).toBeNull();
    expect(out.status).toBe("stopped");
  });

  it("keeps the newest and caps how many are stored", () => {
    const many = Array.from({ length: STORED_BLOCKS + 10 }, (_, i) => block({ command: `job ${i}` }));
    const out = slim(many);
    expect(out).toHaveLength(STORED_BLOCKS);
    expect(out[0].command).toBe("job 0");
  });
});

describe("revive", () => {
  it("round-trips a real block", () => {
    const b = block({ command: "open example.com", answer: "It says hello.", ms: 1234 });
    const [out] = revive(JSON.parse(JSON.stringify(slim([b]))));
    expect(out.command).toBe("open example.com");
    expect(out.answer).toBe("It says hello.");
    expect(out.ms).toBe(1234);
  });

  it("brings old work back folded", () => {
    const [out] = revive(JSON.parse(JSON.stringify(slim([block({ collapsed: false })]))));
    expect(out.collapsed).toBe(true);
  });

  it("never revives anything as live", () => {
    const [out] = revive([{ id: "x", command: "c", status: "running" }]);
    expect(out.status).toBe("stopped");
    expect(out.gate).toBeNull();
  });

  it("discards junk instead of rendering a broken block", () => {
    expect(revive(null)).toEqual([]);
    expect(revive("nope")).toEqual([]);
    expect(revive([null, 7, {}, { id: "a" }, { command: "b" }])).toEqual([]);
  });

  it("survives a step array that is not one", () => {
    const [out] = revive([{ id: "a", command: "c", steps: "broken" }]);
    expect(out.steps).toEqual([]);
  });
});
