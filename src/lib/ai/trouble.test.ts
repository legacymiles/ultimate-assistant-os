import { describe, expect, it } from "vitest";
import { diagnose, kindOf, shortModel, troubleBody, type Attempt } from "./trouble";

function at(model: string, status: number | undefined, message: string): Attempt {
  return { model, provider: "openrouter", status, message };
}

describe("classifying one refusal", () => {
  it("maps the statuses that mean something different to the owner", () => {
    expect(kindOf(at("a/b", 402, ""))).toBe("no-credit");
    expect(kindOf(at("a/b", 429, ""))).toBe("rate-limit");
    expect(kindOf(at("a/b", 404, ""))).toBe("missing-model");
    expect(kindOf(at("a/b", 413, ""))).toBe("too-big");
    expect(kindOf(at("a/b", 400, ""))).toBe("bad-request");
    expect(kindOf(at("a/b", 503, ""))).toBe("provider-down");
    expect(kindOf(at("a/b", undefined, "Network error"))).toBe("network");
  });

  // Measured: OpenRouter answers 401 for an exhausted balance as well as a bad
  // key, so this must not send the owner to check a key that is fine.
  it("treats 401 as money-or-key rather than key alone", () => {
    expect(kindOf(at("a/b", 401, ""))).toBe("credit-or-key");
    expect(diagnose([at("a/b", 401, "")]).text).toContain("empty balance");
  });
});

describe("diagnosing a whole chain", () => {
  it("says how many refused, so the sentence matches what the router did", () => {
    const d = diagnose([at("qwen/qwen3.8-27b:free", 429, "rate limited"), at("deepseek/deepseek-v4.1-flash", 402, "no credit")]);
    expect(d.headline).toContain("All 2 models the router tried refused");
  });

  it("does not say 'all models' when only one was tried", () => {
    expect(diagnose([at("a/b", 402, "no credit")]).headline).not.toContain("All");
  });

  // A rate limit on the free rung while the paid rung has no money is really a
  // money problem: the free one would have carried on if the fallback had worked.
  it("leads with the actionable cause when the failures are mixed", () => {
    const d = diagnose([at("qwen/qwen3.8-27b:free", 429, "rate limited"), at("deepseek/deepseek-v4.1-flash", 402, "no credit")]);
    expect(d.kind).toBe("no-credit");
    expect(d.fix).toContain("openrouter.ai/credits");
  });

  it("names every model it tried and what each said", () => {
    const d = diagnose([at("qwen/qwen3.8-27b:free", 429, "429 Rate limit exceeded"), at("openai/gpt-6-luna-pro", 402, "402 Insufficient credits")]);
    expect(d.trail).toEqual(["qwen3.8-27b free — 429 Rate limit exceeded", "gpt-6-luna-pro — 402 Insufficient credits"]);
    expect(d.text).toContain("qwen3.8-27b free");
    expect(d.text).toContain("gpt-6-luna-pro");
  });

  // describe() in provider.ts already prefixes the status.
  it("does not print the status twice", () => {
    expect(diagnose([at("a/b", 402, "402 Insufficient credits")]).trail[0]).toBe("b — 402 Insufficient credits");
  });

  it("tells the owner the free models still work when only a paid one was tried", () => {
    const d = diagnose([at("openai/gpt-6-luna-pro", 402, "no credit")]);
    expect(d.fix).toContain("free models are unaffected");
  });

  it("does not claim the free models work when a free model is what failed", () => {
    const d = diagnose([at("qwen/qwen3.8-27b:free", 402, "no credit"), at("openai/gpt-6-luna-pro", 402, "no credit")]);
    expect(d.fix).not.toContain("unaffected");
  });

  // The daily cap is the one thing that explains a free-only rate limit, and
  // "wait a moment" is wrong advice for it.
  it("explains a free-only rate limit as the daily cap", () => {
    const d = diagnose([at("qwen/qwen3.8-27b:free", 429, "rate limited"), at("thinkingmachines/inkling:free", 429, "rate limited")]);
    expect(d.fix).toContain("daily cap");
    expect(d.fix).not.toBe("Wait a moment and try again.");
  });

  it("points a vanished model at the check script rather than at the provider", () => {
    expect(diagnose([at("qwen/qwen3.8-27b:free", 404, "no endpoints")]).fix).toContain("check:router");
  });

  // Captured from the live API by pointing the hub at a model that does not
  // exist: OpenRouter answers 400, not 404, and classifying on the status alone
  // sent this to "go read the server log" when the provider had already said
  // exactly what was wrong.
  it("recognises an unknown model even though OpenRouter calls it a 400", () => {
    const d = diagnose([
      at("openrouter/definitely-not-a-real-model", 400, "400 openrouter/definitely-not-a-real-model is not a valid model ID"),
      at("openrouter/also-not-real", 400, "400 openrouter/also-not-real is not a valid model ID"),
    ]);
    expect(d.kind).toBe("missing-model");
    expect(d.fix).toContain("check:router");
    expect(d.text).toContain("is not a valid model ID");
  });

  it("survives having nothing to go on", () => {
    const d = diagnose([]);
    expect(d.text).toBeTruthy();
    expect(d.kind).toBe("unknown");
  });
});

describe("the body a failed call carries", () => {
  // Every existing reader does body.error.message; they must all improve
  // without being touched.
  it("keeps the provider error shape so existing readers improve for free", () => {
    const body = troubleBody([at("openai/gpt-6-luna-pro", 402, "402 Insufficient credits")]);
    expect(typeof body.error.message).toBe("string");
    expect(body.error.message).toContain("out of credit");
    expect(body.error.kind).toBe("no-credit");
    expect(body.error.attempts).toHaveLength(1);
  });
});

describe("naming a model", () => {
  it("drops the vendor and spells out free", () => {
    expect(shortModel("qwen/qwen3.8-27b:free")).toBe("qwen3.8-27b free");
    expect(shortModel("anthropic/claude-opus-5")).toBe("claude-opus-5");
    expect(shortModel("")).toBe("the model");
  });
});
