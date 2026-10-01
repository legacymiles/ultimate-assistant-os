import { afterEach, describe, expect, it, vi } from "vitest";
import { clearCooldowns, cooling, coolingUntil, isModelRefusal, markRefused, skipCooling } from "./cooldown";

afterEach(() => {
  clearCooldowns();
  vi.useRealTimers();
});

const FREE = "qwen/qwen3.8-27b:free";
const INKLING = "thinkingmachines/inkling:free";
const PAID = "deepseek/deepseek-v4.1-flash";

describe("what counts as the model refusing", () => {
  it("benches on a rate limit or a policy gate", () => {
    expect(isModelRefusal(429)).toBe(true);
    expect(isModelRefusal(403)).toBe(true);
  });

  // An empty balance is the ACCOUNT's problem. Benching every paid model for an
  // hour over it would strand the hub on a free rung that is itself refusing.
  it("never benches a model over an empty balance", () => {
    expect(isModelRefusal(402)).toBe(false);
    markRefused(PAID, 402, "Insufficient credits");
    expect(coolingUntil(PAID)).toBeNull();
  });

  it("ignores a provider having a bad minute, which the ordinary retry covers", () => {
    expect(isModelRefusal(500)).toBe(false);
    expect(isModelRefusal(undefined)).toBe(false);
  });
});

describe("benching and coming back", () => {
  it("keeps the provider's own words, so the Toolbox can say why", () => {
    markRefused(FREE, 429, "qwen/qwen3.8-27b:free is temporarily rate-limited upstream");
    expect(coolingUntil(FREE)?.why).toContain("rate-limited upstream");
  });

  it("lets a shared-pool limit back in after a few minutes", () => {
    vi.useFakeTimers();
    markRefused(FREE, 429, "rate-limited");
    expect(coolingUntil(FREE)).not.toBeNull();
    vi.advanceTimersByTime(5 * 60_000 + 1);
    expect(coolingUntil(FREE)).toBeNull();
  });

  // Measured: inkling:free answers 403 "only available on agentic harnesses"
  // every single time. Retrying that in five minutes just buys another 403.
  it("keeps a policy gate out for much longer than a rate limit", () => {
    vi.useFakeTimers();
    markRefused(INKLING, 403, "only available on agentic harnesses");
    vi.advanceTimersByTime(10 * 60_000);
    expect(coolingUntil(INKLING)).not.toBeNull();
    vi.advanceTimersByTime(60 * 60_000);
    expect(coolingUntil(INKLING)).toBeNull();
  });
});

describe("filtering a chain", () => {
  it("skips what is refusing and keeps the rest in order", () => {
    markRefused(FREE, 429, "rate-limited");
    expect(skipCooling([FREE, PAID, "openai/gpt-6-luna-pro"])).toEqual([PAID, "openai/gpt-6-luna-pro"]);
  });

  // The guard that matters more than the filter: a stale note about a shared
  // pool must never be the reason the hub stops answering at all.
  it("still tries one when every model is benched", () => {
    markRefused(FREE, 429, "rate-limited");
    markRefused(PAID, 429, "rate-limited");
    expect(skipCooling([FREE, PAID])).toEqual([FREE]);
  });

  it("leaves an untouched chain exactly as it was", () => {
    const chain = [FREE, PAID];
    expect(skipCooling(chain)).toEqual(chain);
  });
});

describe("what the Toolbox can show", () => {
  it("lists what is benched and drops entries once they expire", () => {
    vi.useFakeTimers();
    markRefused(FREE, 429, "rate-limited");
    markRefused(INKLING, 403, "only available on agentic harnesses");
    expect(cooling().map((c) => c.model).sort()).toEqual([INKLING, FREE].sort());
    vi.advanceTimersByTime(6 * 60_000);
    expect(cooling().map((c) => c.model)).toEqual([INKLING]);
  });
});
