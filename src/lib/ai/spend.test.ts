import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
// The ledger is a document; these tests are about the arithmetic, not the store.
vi.mock("@/lib/server/docStore", () => ({
  readDoc: vi.fn(async () => null),
  writeDoc: vi.fn(async () => true),
}));

import { EMPTY_LEDGER, addCalls, priceOf, usageOf, type CallRecord } from "./spend";

function call(over: Partial<CallRecord> = {}): CallRecord {
  return {
    at: "2026-09-30T12:00:00.000Z",
    model: "qwen/qwen3.8-27b:free",
    provider: "openrouter",
    cost: 0,
    promptTokens: 100,
    completionTokens: 50,
    ...over,
  };
}

describe("reading a provider's usage block", () => {
  it("takes OpenRouter's reported charge", () => {
    expect(usageOf({ usage: { prompt_tokens: 10, completion_tokens: 5, cost: 0.0004 } })).toEqual({
      prompt_tokens: 10,
      completion_tokens: 5,
      cost: 0.0004,
    });
  });

  it("takes token counts from a provider that reports no cost", () => {
    expect(usageOf({ usage: { prompt_tokens: 10, completion_tokens: 5 } })).toEqual({
      prompt_tokens: 10,
      completion_tokens: 5,
      cost: undefined,
    });
  });

  // A zero here would read as a free call and quietly understate the day.
  it("answers null rather than zero when a reply carries no usage at all", () => {
    expect(usageOf({ choices: [] })).toBeNull();
    expect(usageOf({ usage: {} })).toBeNull();
    expect(usageOf(null)).toBeNull();
  });
});

describe("what a call cost", () => {
  it("prefers the charge the provider reported, and calls it measured", async () => {
    expect(await priceOf("openai/gpt-6-luna-pro", { prompt_tokens: 1e6, completion_tokens: 0, cost: 0.07 })).toEqual({
      cost: 0.07,
      estimated: false,
    });
  });

  it("keeps a reported zero as measured, because the free models really are free", async () => {
    const priced = await priceOf("qwen/qwen3.8-27b:free", { prompt_tokens: 5000, completion_tokens: 900, cost: 0 });
    expect(priced).toEqual({ cost: 0, estimated: false });
  });

  it("prices from the router's own table when the provider reported no cost", async () => {
    // Luna Pro is $0.10/M in, $0.50/M out.
    const priced = await priceOf("openai/gpt-6-luna-pro", { prompt_tokens: 1_000_000, completion_tokens: 1_000_000 });
    expect(priced.estimated).toBe(true);
    expect(priced.cost).toBeCloseTo(0.6, 6);
  });

  it("does not invent a figure for Jev, which bills as whatever it routed to", async () => {
    const priced = await priceOf("typesafe/jev-router", { prompt_tokens: 1_000_000, completion_tokens: 1_000_000 });
    expect(priced).toEqual({ cost: 0, estimated: true });
  });
});

describe("folding calls into the ledger", () => {
  it("keeps calls in time order and adds up what it counted", () => {
    const led = addCalls(EMPTY_LEDGER, [
      call({ at: "2026-09-30T13:00:00.000Z", cost: 0.02 }),
      call({ at: "2026-09-30T11:00:00.000Z", cost: 0.01 }),
    ]);
    expect(led.recent.map((c) => c.at)).toEqual(["2026-09-30T11:00:00.000Z", "2026-09-30T13:00:00.000Z"]);
    expect(led.countedEver).toBeCloseTo(0.03, 6);
  });

  it("rolls whatever falls off the end into its UTC day instead of dropping it", () => {
    // 300 is the cap, so 302 calls across two days must leave two survivors' worth
    // of history behind rather than two lost calls.
    const many = Array.from({ length: 302 }, (_, i) =>
      call({ at: `2026-09-${i < 2 ? "28" : "29"}T0${i % 10}:00:00.000Z`, cost: 0.01 }),
    );
    const led = addCalls(EMPTY_LEDGER, many);
    expect(led.recent).toHaveLength(300);
    const rolled = led.days.reduce((sum, d) => sum + d.calls, 0);
    expect(rolled).toBe(2);
    expect(led.days[0].date).toBe("2026-09-28");
    // Nothing is lost: the 302 calls are all still accounted for somewhere.
    expect(led.recent.length + rolled).toBe(302);
    expect(led.countedEver).toBeCloseTo(3.02, 6);
  });

  it("keeps day history newest first and no longer than a month", () => {
    const old = Array.from({ length: 40 }, (_, i) => ({
      date: `2026-0${i < 9 ? "1" : "2"}-${String((i % 28) + 1).padStart(2, "0")}`,
      cost: 0.1,
      calls: 1,
    }));
    const led = addCalls({ ...EMPTY_LEDGER, days: old }, [call()]);
    expect(led.days.length).toBeLessThanOrEqual(30);
    expect(led.days[0].date >= led.days[1].date).toBe(true);
  });

  it("survives a ledger document that is missing its fields", () => {
    const led = addCalls({} as never, [call({ cost: 0.5 })]);
    expect(led.recent).toHaveLength(1);
    expect(led.days).toEqual([]);
    expect(led.countedEver).toBe(0.5);
  });
});
