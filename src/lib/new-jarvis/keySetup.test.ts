import { describe, expect, it } from "vitest";
import { KEY_SOURCES, agentTaskForKeys, checkKey, keyRows, thinkingReady, upsertEnvLine } from "./keySetup";
import { callSuggestions, setupChecklist, splitList, EMPTY_ONBOARDING } from "./onboarding";
import { allKeyNames } from "@/lib/armory/catalog";

describe("upsertEnvLine", () => {
  it("replaces an existing line and keeps everything else byte for byte", () => {
    const before = "# keys\nFOO=1\nOPENROUTER_API_KEY=\nBAR=2\n";
    expect(upsertEnvLine(before, "OPENROUTER_API_KEY", "sk-or-abc")).toBe("# keys\nFOO=1\nOPENROUTER_API_KEY=sk-or-abc\nBAR=2\n");
  });

  it("appends when missing and leaves a trailing newline", () => {
    expect(upsertEnvLine("FOO=1\n", "RESEND_API_KEY", "re_x")).toBe("FOO=1\nRESEND_API_KEY=re_x\n");
    expect(upsertEnvLine("", "RESEND_API_KEY", "re_x")).toBe("RESEND_API_KEY=re_x\n");
  });

  it("does not touch a commented-out copy, and keeps CRLF files CRLF", () => {
    const before = "# OPENROUTER_API_KEY=old\r\nFOO=1\r\n";
    expect(upsertEnvLine(before, "OPENROUTER_API_KEY", "sk-or-new")).toBe("# OPENROUTER_API_KEY=old\r\nFOO=1\r\nOPENROUTER_API_KEY=sk-or-new\r\n");
  });

  it("does not match a key that merely starts with the same name", () => {
    expect(upsertEnvLine("FISH_API_KEY_OLD=1\n", "FISH_API_KEY", "abcdefgh")).toBe("FISH_API_KEY_OLD=1\nFISH_API_KEY=abcdefgh\n");
  });

  it("quotes values a dotenv parser would split", () => {
    expect(upsertEnvLine("", "X_KEY", "a#b")).toBe('X_KEY="a#b"\n');
  });
});

describe("checkKey", () => {
  it("catches the usual paste mistakes", () => {
    expect(checkKey("OPENROUTER_API_KEY", "")).toMatch(/Paste/);
    expect(checkKey("OPENROUTER_API_KEY", "sk-or-abc def")).toMatch(/spaces/);
    expect(checkKey("OPENROUTER_API_KEY", "OPENROUTER_API_KEY=sk-or-abcdef")).toMatch(/only the value/);
    expect(checkKey("OPENROUTER_API_KEY", "sk-proj-abcdefgh")).toMatch(/start with/);
    expect(checkKey("OPENROUTER_API_KEY", "  sk-or-v1-abcdefgh  ")).toBe("");
  });
});

describe("keyRows", () => {
  it("leads with Thinking, marked needed, and asks only for keys it can say where to get", () => {
    const rows = keyRows({});
    expect(rows[0].capability.id).toBe("openrouter");
    expect(rows[0].essential).toBe(true);
    for (const r of rows) for (const k of r.ask) expect(KEY_SOURCES[k]).toBeDefined();
  });

  it("shows a set capability as working", () => {
    const rows = keyRows({ OPENROUTER_API_KEY: true });
    expect(rows[0].reading.status).toBe("live");
    expect(thinkingReady({ OPENROUTER_API_KEY: true })).toBe(true);
    expect(thinkingReady({})).toBe(false);
  });

  it("only knows key names the armory route reports", () => {
    const known = new Set(allKeyNames());
    for (const k of Object.keys(KEY_SOURCES)) expect(known.has(k)).toBe(true);
  });
});

describe("agentTaskForKeys", () => {
  it("names the page, the env var, Vercel and the never-type-a-password rule", () => {
    const t = agentTaskForKeys(["OPENROUTER_API_KEY"]);
    expect(t).toContain("https://openrouter.ai/settings/keys");
    expect(t).toContain("OPENROUTER_API_KEY");
    expect(t).toMatch(/Vercel/);
    expect(t).toMatch(/never type a password/);
  });
});

describe("onboarding helpers", () => {
  it("suggests names from the first name", () => {
    expect(callSuggestions("Jack Staxx")[0]).toBe("Jack");
    expect(callSuggestions("")).not.toContain("");
  });

  it("splits a business list", () => {
    expect(splitList("A, B ,, C\nD")).toEqual(["A", "B", "C", "D"]);
  });

  it("puts choosing a brain on the checklist", () => {
    const base = { onboarding: EMPTY_ONBOARDING, connectedAccounts: 0, iphoneLinked: false, rules: 0, favorites: 0 };
    expect(setupChecklist(base).find((i) => i.id === "brain")?.done).toBe(false);
    expect(setupChecklist({ ...base, thinkingReady: true }).find((i) => i.id === "brain")?.done).toBe(true);
    expect(setupChecklist({ ...base, subscriptionBrain: true }).find((i) => i.id === "brain")?.done).toBe(true);
  });
});

describe("connections guides", () => {
  it("YouTube is asked in onboarding with a clickable walk-through ending on Vercel", async () => {
    const { keyRows, stepsFor, checkKey } = await import("./keySetup");
    expect(keyRows({}).some((r) => r.capability.id === "youtube" && r.ask.includes("YOUTUBE_API_KEY"))).toBe(true);
    const steps = stepsFor("YOUTUBE_API_KEY");
    expect(steps[0].url).toContain("console.cloud.google.com");
    expect(steps.some((s) => s.url?.includes("youtube.googleapis.com"))).toBe(true);
    expect(steps[steps.length - 1].url).toBe("https://vercel.com/dashboard");
    expect(checkKey("YOUTUBE_API_KEY", "sk-wrong-key-123")).toMatch(/AIza/);
    expect(checkKey("YOUTUBE_API_KEY", "AIzaSyExampleExample123")).toBe("");
  });
  it("keys with no own steps still get one step to their page", async () => {
    const { stepsFor, KEY_SOURCES } = await import("./keySetup");
    const s = stepsFor("RESEND_API_KEY");
    expect(s[0]).toMatchObject({ url: KEY_SOURCES.RESEND_API_KEY.url });
    expect(stepsFor("NOT_A_KEY")).toEqual([]);
  });
  it("Connections lists every key-switched capability we can source, setup ones first", async () => {
    const { connectionRows, SETUP_CAPABILITIES } = await import("./keySetup");
    const rows = connectionRows({});
    expect(rows[0].capability.id).toBe(SETUP_CAPABILITIES[0]);
    expect(rows.every((r) => r.capability.via === "key" && r.ask.length > 0)).toBe(true);
    expect(connectionRows({ YOUTUBE_API_KEY: true }).find((r) => r.capability.id === "youtube")?.reading.status).toBe("live");
  });
});
