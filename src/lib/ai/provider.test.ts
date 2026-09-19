import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
let doc: unknown = null;
vi.mock("@/lib/server/docStore", () => ({
  readDoc: vi.fn(async () => doc),
  writeDoc: vi.fn(async (_n: string, _d: string, data: unknown) => {
    doc = data;
    return true;
  }),
}));

const OR = "https://openrouter.ai/api/v1/chat/completions";
const GW = "https://ai-gateway.vercel.sh/v1/chat/completions";

async function fresh() {
  vi.resetModules();
  const provider = await import("./provider");
  const settings = await import("./settings");
  return { ...provider, ...settings };
}

describe("aiFetch", () => {
  const calls: { url: string; auth: string | null }[] = [];
  let answers: Record<string, () => Response>;

  beforeEach(() => {
    doc = null;
    calls.length = 0;
    vi.stubEnv("OPENROUTER_API_KEY", "or-key");
    vi.stubEnv("AI_GATEWAY_API_KEY", "gw-key");
    vi.stubEnv("VERCEL_OIDC_TOKEN", "");
    answers = { [OR]: () => Response.json({ ok: "or" }), [GW]: () => Response.json({ ok: "gw" }) };
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init: RequestInit) => {
        calls.push({ url, auth: new Headers(init.headers).get("Authorization") });
        return answers[url]();
      }),
    );
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("uses OpenRouter by default and sets the key itself", async () => {
    const { aiFetch } = await fresh();
    const res = await aiFetch({ body: "{}" });
    expect(await res.json()).toEqual({ ok: "or" });
    expect(calls).toEqual([{ url: OR, auth: "Bearer or-key" }]);
  });

  it("follows the owner's choice", async () => {
    doc = { choice: "vercel-gateway" };
    const { aiFetch } = await fresh();
    await aiFetch({ body: "{}" });
    expect(calls[0]).toEqual({ url: GW, auth: "Bearer gw-key" });
  });

  it("falls back when the chosen provider is out of credit, and records why", async () => {
    answers[OR] = () => Response.json({ error: { message: "Insufficient credits" } }, { status: 402 });
    const { aiFetch, cachedSettings } = await fresh();
    const res = await aiFetch({ body: "{}" });
    expect(await res.json()).toEqual({ ok: "gw" });
    expect(calls.map((c) => c.url)).toEqual([OR, GW]);
    expect(cachedSettings().lastError.openrouter?.message).toMatch(/402 Insufficient credits/);
  });

  it("does not fall back on a bad request, or when fallback is off", async () => {
    answers[OR] = () => Response.json({ error: "bad body" }, { status: 400 });
    let { aiFetch } = await fresh();
    expect((await aiFetch({ body: "{}" })).status).toBe(400);
    expect(calls).toHaveLength(1);

    calls.length = 0;
    doc = { fallback: false };
    answers[OR] = () => new Response("down", { status: 503 });
    ({ aiFetch } = await fresh());
    expect((await aiFetch({ body: "{}" })).status).toBe(503);
    expect(calls).toHaveLength(1);
  });

  it("answers 503 instead of throwing when no provider has a key", async () => {
    vi.stubEnv("OPENROUTER_API_KEY", "");
    vi.stubEnv("AI_GATEWAY_API_KEY", "");
    const { aiFetch } = await fresh();
    expect((await aiFetch({ body: "{}" })).status).toBe(503);
    expect(calls).toHaveLength(0);
  });
});
