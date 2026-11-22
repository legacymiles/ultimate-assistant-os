// ---------------------------------------------------------------------------
// The rate limiter, on its in-memory path.
//
// Separate file because these tests share one module-level counter map and
// must reset it between cases, where search.test.ts resets environment and
// breakers instead. Supabase is absent here, so rateCheck falls through to the
// local counters — which is exactly the path a laptop with no service-role key
// runs on, and the one a test can drive deterministically.
// ---------------------------------------------------------------------------

import { beforeEach, describe, expect, it } from "vitest";

import { rateCheck, resetLocalCounters, storageMode } from "./store";
import type { Caller } from "./types";

function caller(overrides: Partial<Caller> = {}): Caller {
  return {
    kind: "key",
    id: "test-caller",
    label: "Test key",
    perMinute: 3,
    perDay: 5,
    scopes: ["search", "extract"],
    ...overrides,
  };
}

beforeEach(() => {
  resetLocalCounters();
});

describe("rate limits", () => {
  it("allows up to the ceiling and refuses the one after it", async () => {
    const who = caller();
    for (let call = 1; call <= 3; call += 1) {
      const verdict = await rateCheck(who);
      expect(verdict.allowed, `call ${call}`).toBe(true);
      expect(verdict.minuteCount).toBe(call);
    }
    const over = await rateCheck(who);
    expect(over.allowed).toBe(false);
    expect(over.minuteCount).toBe(4);
  });

  it("names the caller and the number in the refusal, so it can be shown as-is", async () => {
    const who = caller({ label: "jarvis-harness", perMinute: 1 });
    await rateCheck(who);
    const over = await rateCheck(who);
    expect(over.message).toContain("jarvis-harness");
    expect(over.message).toContain("1");
    expect(over.retryAfter).not.toBeNull();
  });

  it("counts each caller separately, so one runaway agent cannot starve the rest", async () => {
    const loud = caller({ id: "loud", perMinute: 1 });
    const quiet = caller({ id: "quiet", perMinute: 1 });

    expect((await rateCheck(loud)).allowed).toBe(true);
    expect((await rateCheck(loud)).allowed).toBe(false);
    // The quiet caller's own bucket is untouched.
    expect((await rateCheck(quiet)).allowed).toBe(true);
  });

  it("trips the day ceiling even when every minute stayed inside its own", async () => {
    // perMinute is generous, perDay is not: the day window has to be checked
    // independently, or a caller pacing itself under the minute limit would
    // never hit a daily cap at all.
    const who = caller({ perMinute: 1000, perDay: 2 });
    expect((await rateCheck(who)).allowed).toBe(true);
    expect((await rateCheck(who)).allowed).toBe(true);
    const over = await rateCheck(who);
    expect(over.allowed).toBe(false);
    expect(over.message).toContain("today");
    expect(over.dayCount).toBe(3);
  });

  it("reports which storage it is counting in, rather than implying a shared one", () => {
    // Without a service-role key the counters are per-instance, and the
    // dashboard has to say so — a limit that silently counts per serverless
    // instance is a limit nobody can reason about.
    const mode = storageMode();
    expect(mode.shared).toBe(false);
    expect(mode.detail).toMatch(/in-memory/i);
  });
});
