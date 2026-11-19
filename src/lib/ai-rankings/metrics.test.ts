import { describe, expect, it } from "vitest";
import {
  METRIC_SOURCE,
  OWNER_SOURCE,
  applyMetricRefresh,
  countApplied,
  llmEntriesOf,
  metricNote,
  metricsOf,
  num,
  oursToWrite,
  pick,
  planMetrics,
  refreshMetrics,
} from "./metrics";
import type { AaLlmEntry } from "./metrics";
import { EMPTY_BOARD } from "./leaderboard";
import type { Model, PublicBoard } from "./leaderboard";

function model(p: Partial<Model> & Pick<Model, "id" | "name">): Model {
  return {
    maker: "OpenAI",
    category: "llm",
    url: `https://example.com/${p.id}`,
    summary: "",
    releasedAt: "2026-06-01",
    addedAt: "2026-11-01T00:00:00Z",
    updatedAt: "2026-11-01T00:00:00Z",
    openSource: false,
    runsLocally: false,
    access: "paid",
    features: [],
    tags: [],
    ...p,
  };
}

const board = (models: Model[]): PublicBoard => ({ ...EMPTY_BOARD, models });

const entry = (p: Partial<AaLlmEntry> & { name: string }): AaLlmEntry => ({
  model_creator: { name: "OpenAI" },
  ...p,
});

// ----- reading the response -------------------------------------------------

describe("reading the endpoint", () => {
  it("takes either a bare array or a wrapped one, and ignores rubbish", () => {
    expect(llmEntriesOf([{ name: "a" }])).toHaveLength(1);
    expect(llmEntriesOf({ data: [{ name: "a" }, null, 7, ["x"]] })).toHaveLength(1);
    expect(llmEntriesOf({ nope: true })).toEqual([]);
    expect(llmEntriesOf(null)).toEqual([]);
  });

  it("reads a number whether it arrives as one or as a price string", () => {
    expect(num(12.5)).toBe(12.5);
    expect(num("1,234.5")).toBe(1234.5);
    expect(num("$3.00")).toBe(3);
    expect(num(0)).toBe(0);
    expect(num(-1)).toBeNull();
    expect(num("")).toBeNull();
    expect(num(true)).toBeNull();
    expect(num("free")).toBeNull();
  });

  it("looks for a field at the top level and inside pricing", () => {
    expect(pick(entry({ name: "a", pricing: { price_1m_blended_3_to_1: 2 } }), ["price_1m_blended_3_to_1"])).toBe(2);
    expect(pick(entry({ name: "a", price_1m_blended_3_to_1: 3 }), ["price_1m_blended_3_to_1"])).toBe(3);
    // Falls through the list of names the field has had.
    expect(pick(entry({ name: "a", pricing: { price_1m_blended: 4 } }), ["price_1m_blended_3_to_1", "price_1m_blended"])).toBe(4);
    expect(pick(entry({ name: "a" }), ["price_1m_blended_3_to_1"])).toBeNull();
  });

  it("maps an entry onto this board's units, and skips what isn't there", () => {
    const full = entry({
      name: "GPT-6.1 Sol",
      pricing: { price_1m_blended_3_to_1: 4.5 },
      median_output_tokens_per_second: 120,
      context_window: 400_000,
    });
    expect(metricsOf(full)).toEqual({ cost: 4.5, speed: 120, context: 400_000 });

    // A zero throughput is a missing measurement, not an instant model, and a
    // context of 8 is a field holding something else entirely.
    expect(metricsOf(entry({ name: "x", median_output_tokens_per_second: 0, context_window: 8 }))).toEqual({});
    expect(metricsOf(entry({ name: "x" }))).toEqual({});
  });
});

// ----- planning -------------------------------------------------------------

describe("planMetrics", () => {
  const entries = [
    entry({ name: "GPT-6.1 Sol", pricing: { price_1m_blended_3_to_1: 4.5 }, median_output_tokens_per_second: 120 }),
    entry({ name: "Claude Opus 5.5", model_creator: { name: "Anthropic" }, pricing: { price_1m_blended_3_to_1: 9 } }),
  ];

  it("fills in what a model has no measurement for", () => {
    const plan = planMetrics([model({ id: "a", name: "GPT-6.1 Sol" })], entries);
    expect(plan.changes.map((c) => [c.dim, c.from, c.to])).toEqual([
      ["cost", null, 4.5],
      ["speed", null, 120],
    ]);
  });

  it("leaves a measurement the owner typed alone", () => {
    const mine = model({
      id: "a",
      name: "GPT-6.1 Sol",
      metrics: { cost: 3 },
      metricsFrom: { cost: OWNER_SOURCE },
    });
    const plan = planMetrics([mine], entries);
    expect(plan.changes.map((c) => c.dim)).toEqual(["speed"]);
    expect(oursToWrite(mine, "cost")).toBe(false);
    expect(oursToWrite(mine, "speed")).toBe(true);
  });

  it("updates one it wrote itself when the price moves", () => {
    const old = model({
      id: "a",
      name: "GPT-6.1 Sol",
      metrics: { cost: 6, speed: 120 },
      metricsFrom: { cost: METRIC_SOURCE, speed: METRIC_SOURCE },
    });
    const plan = planMetrics([old], entries);
    expect(plan.changes.map((c) => [c.dim, c.from, c.to])).toEqual([["cost", 6, 4.5]]);
  });

  it("says nothing changed when every number already agrees", () => {
    const same = model({
      id: "a",
      name: "GPT-6.1 Sol",
      metrics: { cost: 4.5, speed: 120 },
      metricsFrom: { cost: METRIC_SOURCE, speed: METRIC_SOURCE },
    });
    const plan = planMetrics([same], entries);
    expect(plan.changes).toEqual([]);
    expect(plan.unchanged).toBe(1);
  });

  it("will not guess between two candidates, or across a version", () => {
    const two = [entry({ name: "Kling 2.1 Pro" }), entry({ name: "Kling 2.1 Master" })];
    expect(planMetrics([model({ id: "k", name: "Kling 2.1" })], two).skipped[0].why).toBe("ambiguous");
    expect(planMetrics([model({ id: "g", name: "GPT-6.2" })], entries).skipped[0].why).toBe("none");
  });

  it("only looks at the categories this endpoint describes", () => {
    const tts = model({ id: "t", name: "GPT-6.1 Sol", category: "tts" });
    expect(planMetrics([tts], entries).changes).toEqual([]);
  });
});

// ----- applying -------------------------------------------------------------

describe("applyMetricRefresh", () => {
  const entries = [entry({ name: "GPT-6.1 Sol", pricing: { price_1m_blended_3_to_1: 4.5 } })];

  it("writes the number, where it came from, and the day it was read", () => {
    const before = board([model({ id: "a", name: "GPT-6.1 Sol" })]);
    const plan = { ...planMetrics(before.models, entries) };
    const after = applyMetricRefresh(before, plan, "2026-11-18T09:00:00.000Z");
    expect(after.models[0].metrics).toEqual({ cost: 4.5 });
    expect(after.models[0].metricsFrom).toEqual({ cost: METRIC_SOURCE });
    expect(after.models[0].measuredAt).toBe("2026-11-18");
    expect(countApplied(before, after, plan)).toBe(1);
  });

  it("stands down when the owner typed a number while the feed was loading", () => {
    const before = board([model({ id: "a", name: "GPT-6.1 Sol" })]);
    const plan = planMetrics(before.models, entries);
    const meanwhile = board([
      model({ id: "a", name: "GPT-6.1 Sol", metrics: { cost: 3 }, metricsFrom: { cost: OWNER_SOURCE } }),
    ]);
    const after = applyMetricRefresh(meanwhile, plan);
    expect(after.models[0].metrics).toEqual({ cost: 3 });
    expect(countApplied(meanwhile, after, plan)).toBe(0);
  });

  it("changes nothing when there is nothing to change", () => {
    const b = board([model({ id: "a", name: "Nobody" })]);
    expect(applyMetricRefresh(b, { changes: [], skipped: [], unchanged: 0 })).toBe(b);
  });
});

describe("refreshMetrics", () => {
  const b = board([model({ id: "a", name: "GPT-6.1 Sol" })]);

  it("calls nothing without a key, and says so", async () => {
    const r = await refreshMetrics(b, { apiKey: "" });
    expect(r.noKey).toBe(true);
    expect(metricNote(r)).toBe("");
  });

  it("reads the endpoint with the key in a header", async () => {
    let seenUrl = "";
    let seenKey = "";
    const r = await refreshMetrics(b, {
      apiKey: "k",
      fetcher: (async (url: string, init: RequestInit) => {
        seenUrl = String(url);
        seenKey = String((init.headers as Record<string, string>)["x-api-key"]);
        return {
          ok: true,
          json: async () => ({ data: [{ name: "GPT-6.1 Sol", model_creator: { name: "OpenAI" }, pricing: { price_1m_blended_3_to_1: 4.5 } }] }),
        };
      }) as unknown as typeof fetch,
    });
    expect(seenUrl).toContain("/data/llms/models");
    expect(seenKey).toBe("k");
    expect(r.changes).toHaveLength(1);
    expect(r.entries).toHaveLength(1);
    expect(metricNote(r, 1)).toBe("1 price and speed updated");
  });

  it("treats a failure and an empty answer as a failure, not as no prices", async () => {
    const bad = await refreshMetrics(b, {
      apiKey: "k",
      fetcher: (async () => ({ ok: false, json: async () => ({}) })) as unknown as typeof fetch,
    });
    expect(bad.failed).toBe(true);
    expect(metricNote(bad)).toBe("couldn't read prices and speeds");

    const empty = await refreshMetrics(b, {
      apiKey: "k",
      fetcher: (async () => ({ ok: true, json: async () => ({ data: [] }) })) as unknown as typeof fetch,
    });
    expect(empty.failed).toBe(true);
  });
});
