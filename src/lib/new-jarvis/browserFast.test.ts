import { describe, expect, it } from "vitest";
import { autoRead, clickOptions, fastCandidate, fastStreak, parseSnapshot, pickStep, FAST_ID, MAX_STREAK, type Wire } from "./browserFast";
import { mayReroute, uncensoredChain } from "./reroute";
import type { DecisionResult } from "@/lib/ai/decisions";

const read = {
  tabId: "tab_1",
  url: "https://shop.example.com",
  title: "Example Shop",
  text: "Welcome. Pricing, Docs and Blog are above.",
  redacted: false,
  elements: [
    { ref: "ref_1", role: "link", name: "Home" },
    { ref: "ref_2", role: "link", name: "Pricing" },
    { ref: "ref_3", role: "button", name: "Buy now" },
    { ref: "ref_4", role: "input", name: "Search", value: "" },
    { ref: "ref_5", role: "link", name: "Delete account" },
    { ref: "ref_6", role: "link", name: "Docs" },
  ],
};

const turn = (...rest: Wire[]): Wire[] => [{ role: "user", content: "find the pricing for the pro plan" }, ...rest];
const readResult = (id = "call_1"): Wire[] => [
  { role: "assistant", content: "", tool_calls: [{ id, function: { name: "browser_read", arguments: "{}" } }] },
  { role: "tool", tool_call_id: id, name: "browser_read", content: JSON.stringify(read) },
];
const jev = (choice: string, confidence: number): DecisionResult => ({
  answers: { next: { type: "choice", choice, confidence, probabilities: {} } },
  model: "typesafe/jev-1.13",
  cost: 0,
  inputTokens: 0,
  ms: 150,
});

describe("reading the page", () => {
  it("parses a whole read and a read cut off mid-JSON", () => {
    expect(parseSnapshot(JSON.stringify(read))?.controls).toHaveLength(6);
    const cut = JSON.stringify(read).slice(0, 300);
    const snap = parseSnapshot(cut)!;
    expect(snap.url).toBe("https://shop.example.com");
    expect(snap.controls.length).toBeGreaterThan(1);
  });
  it("ignores a failed step", () => {
    expect(parseSnapshot("That step failed: no tab")).toBeNull();
  });
});

describe("what Jev may click", () => {
  it("only links and buttons, never irreversible ones, goal words first", () => {
    const opts = clickOptions(parseSnapshot(JSON.stringify(read))!, "find the pricing", new Set());
    const names = opts.map((o) => o.name);
    expect(names[0]).toBe("Pricing");
    expect(names).not.toContain("Buy now");
    expect(names).not.toContain("Delete account");
    expect(names).not.toContain("Search");
  });
});

describe("the fast lane", () => {
  it("reads the page after a click with no model at all", () => {
    const msgs = turn(
      { role: "assistant", content: "", tool_calls: [{ id: "c1", function: { name: "browser_click", arguments: '{"ref":"ref_2","name":"Pricing"}' } }] },
      { role: "tool", tool_call_id: "c1", name: "browser_click", content: '{"tabId":"tab_1","url":"https://shop.example.com/pricing"}' },
    );
    expect(autoRead(msgs, true)?.toolCall).toMatchObject({ name: "browser_read", args: { tabId: "tab_1" } });
    expect(autoRead(msgs, false)).toBeNull();
  });

  it("does not read after a declined or failed step", () => {
    const msgs = turn({ role: "tool", tool_call_id: "c1", name: "browser_click", content: "The owner declined this step." });
    expect(autoRead(msgs, true)).toBeNull();
  });

  it("turns a confident Jev pick into a click on a real control", () => {
    const msgs = turn(...readResult());
    const c = fastCandidate(msgs, "browse", true)!;
    const step = pickStep(jev("ref_2", 0.9), c, msgs)!;
    expect(step.toolCall).toMatchObject({ name: "browser_click", args: { ref: "ref_2", name: "Pricing", tabId: "tab_1" } });
    expect(step.toolCall.id.startsWith(FAST_ID)).toBe(true);
  });

  it("hands the round to the chat model when Jev is unsure, says think or done, or picks something not offered", () => {
    const msgs = turn(...readResult());
    const c = fastCandidate(msgs, "browse", true)!;
    expect(pickStep(jev("ref_2", 0.5), c, msgs)).toBeNull();
    expect(pickStep(jev("think", 0.95), c, msgs)).toBeNull();
    expect(pickStep(jev("done", 0.95), c, msgs)).toBeNull();
    expect(pickStep(jev("ref_3", 0.95), c, msgs)).toBeNull(); // Buy now was never offered
    expect(pickStep(null, c, msgs)).toBeNull();
  });

  it("stays out of Ask and Run, and steps aside after a long streak", () => {
    const msgs = turn(...readResult());
    expect(fastCandidate(msgs, "ask", true)).toBeNull();
    expect(fastCandidate(msgs, "run", true)).toBeNull();
    const long: Wire[] = turn();
    for (let i = 0; i < MAX_STREAK; i++) long.push({ role: "tool", tool_call_id: `${FAST_ID}${i}`, name: "browser_read", content: JSON.stringify(read) });
    expect(fastStreak(long)).toBe(MAX_STREAK);
    expect(fastCandidate(long, "browse", true)).toBeNull();
  });

  it("does not click the same thing twice in a turn", () => {
    const msgs = turn(
      { role: "assistant", content: "", tool_calls: [{ id: "jev_a", function: { name: "browser_click", arguments: '{"ref":"ref_2","name":"Pricing"}' } }] },
      { role: "tool", tool_call_id: "jev_a", name: "browser_click", content: "{}" },
      ...readResult("jev_b"),
    );
    const c = fastCandidate(msgs, "browse", true)!;
    expect(c.options.map((o) => o.name)).not.toContain("Pricing");
  });
});

describe("rerouting a refusal", () => {
  const D = "anthropic/claude-opus-5";
  it("only for explicit adult content on the default or a Claude brain", () => {
    expect(mayReroute(D, D, "write a nude photo caption for my site")).toBe(true);
    expect(mayReroute(D, D, "summarize this page", '{"text":"NSFW members area"}')).toBe(true);
    expect(mayReroute(D, D, "help me with my taxes")).toBe(false);
    expect(mayReroute("openai/gpt-6-luna-pro", D, "nude photo caption")).toBe(false);
  });
  it("never for content the check blocks", () => {
    expect(mayReroute(D, D, "explicit photos of a 16 year old")).toBe(false);
  });
  it("DeepSeek first by default, overridable", () => {
    expect(uncensoredChain()[0]).toContain("deepseek");
    expect(uncensoredChain({ jarvis: "x/a, x/b" })).toEqual(["x/a", "x/b"]);
  });
});
