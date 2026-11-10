import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { describePick, openRouterKey, resolvePick, routes } from "./harness-models.mjs";

describe("resolvePick", () => {
  it("runs a plan pick on the PC's own login, with no extra env", () => {
    const r = resolvePick("claude-subscription:claude-opus-5-5", { key: "" });
    expect(r).toEqual({ harness: "claude", model: "claude-opus-5-5", route: "subscription", env: {} });
  });

  it("an empty pick is the plan with Claude Code's default model", () => {
    expect(resolvePick("", { key: "" })).toMatchObject({ harness: "claude", model: "", route: "subscription" });
  });

  it("points Claude Code at OpenRouter for an API pick, and blanks the direct key", () => {
    const r = resolvePick("openrouter:anthropic/claude-opus-5.5", { key: "sk-or-test" });
    expect(r.model).toBe("anthropic/claude-opus-5.5");
    expect(r.route).toBe("openrouter");
    expect(r.env.ANTHROPIC_BASE_URL).toBe("https://openrouter.ai/api");
    expect(r.env.ANTHROPIC_AUTH_TOKEN).toBe("sk-or-test");
    expect(r.env.ANTHROPIC_API_KEY).toBe("");
  });

  it("refuses an API pick with no key, in a sentence that says where the key goes", () => {
    expect(() => resolvePick("openrouter:anthropic/claude-opus-5", { key: "" })).toThrow(/Connections/);
  });

  it("refuses ids that are the wrong shape for their route", () => {
    expect(() => resolvePick("claude-subscription:anthropic/claude-opus-5", { key: "" })).toThrow();
    expect(() => resolvePick("openrouter:claude-opus-5", { key: "k" })).toThrow();
    expect(() => resolvePick("openrouter:a/b; rm -rf /", { key: "k" })).toThrow();
  });

  it("knows DeepSeek is its own harness", () => {
    expect(resolvePick("deepseek", { key: "" }).harness).toBe("deepseek");
  });
});

describe("openRouterKey", () => {
  it("prefers the environment, then reads the repo's .env.local", () => {
    const dir = mkdtempSync(join(tmpdir(), "hm-"));
    writeFileSync(join(dir, ".env.local"), 'FOO=1\nOPENROUTER_API_KEY="sk-or-file"\n');
    expect(openRouterKey({ env: { OPENROUTER_API_KEY: "sk-or-env" }, repos: [dir] })).toBe("sk-or-env");
    expect(openRouterKey({ env: {}, repos: [dir] })).toBe("sk-or-file");
    expect(openRouterKey({ env: {}, repos: [join(dir, "nope")] })).toBe("");
  });
});

describe("routes", () => {
  it("greys OpenRouter with an actionable reason when there is no key", () => {
    const r = routes({ sdk: true, key: "" });
    expect(r.subscription.available).toBe(true);
    expect(r.openrouter.available).toBe(false);
    expect(r.openrouter.why).toMatch(/Connections/);
  });
});

describe("describePick", () => {
  it("says which Claude and who pays", () => {
    expect(describePick("openrouter:anthropic/claude-opus-5.5")).toBe("anthropic/claude-opus-5.5 via OpenRouter");
    expect(describePick("claude-subscription:claude-opus-5")).toBe("claude-opus-5 on your Claude plan");
  });
});
