import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
// `doc` is the ai-settings document; other documents (ai-health) live in `others`.
let doc: unknown = null;
const others: Record<string, unknown> = {};
vi.mock("@/lib/server/docStore", () => ({
  readDoc: vi.fn(async (name: string) => (name === "ai-settings" ? doc : (others[name] ?? null))),
  writeDoc: vi.fn(async (name: string, _d: string, data: unknown) => {
    if (name === "ai-settings") doc = data;
    else others[name] = data;
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

describe("aiFetch model choice", () => {
  const models: string[] = [];
  let answer: (model: string) => Response;

  beforeEach(() => {
    doc = null;
    models.length = 0;
    vi.stubEnv("OPENROUTER_API_KEY", "or-key");
    vi.stubEnv("AI_GATEWAY_API_KEY", "");
    vi.stubEnv("VERCEL_OIDC_TOKEN", "");
    vi.stubEnv("AI_MODEL", "");
    answer = (model) => Response.json({ model });
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init: RequestInit) => {
        const model = String(JSON.parse(String(init.body)).model);
        models.push(model);
        return answer(model);
      }),
    );
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  const ask = (model: string) => JSON.stringify({ model, messages: [{ role: "user", content: "hi" }] });

  it("sends general calls to the owner's picked model", async () => {
    doc = { model: "google/gemini-3.8-flash" };
    const { aiFetch, DEFAULT_MODEL } = await fresh();
    expect(await (await aiFetch({ body: ask(DEFAULT_MODEL) })).json()).toEqual({ model: "google/gemini-3.8-flash" });
  });

  it("walks the fallback models when the pick fails", async () => {
    doc = { model: "x-ai/grok-4.6", fallbackModels: ["deepseek/deepseek-v4-pro-0813", "openai/gpt-5.6-sol"] };
    answer = (model) => (model === "x-ai/grok-4.6" ? new Response("down", { status: 503 }) : Response.json({ model }));
    const { aiFetch, DEFAULT_MODEL } = await fresh();
    expect(await (await aiFetch({ body: ask(DEFAULT_MODEL) })).json()).toEqual({ model: "deepseek/deepseek-v4-pro-0813" });
    expect(models).toEqual(["x-ai/grok-4.6", "deepseek/deepseek-v4-pro-0813"]);
  });

  it("with no pick, a failing default still falls to a non-Claude model", async () => {
    answer = (model) => (model.startsWith("anthropic/") ? new Response("nope", { status: 404 }) : Response.json({ model }));
    const { aiFetch, DEFAULT_MODEL } = await fresh();
    expect(await (await aiFetch({ body: ask(DEFAULT_MODEL) })).json()).toEqual({ model: "google/gemini-3.8-flash" });
  });

  it("leaves specialist models alone", async () => {
    doc = { model: "x-ai/grok-4.6" };
    const { aiFetch } = await fresh();
    await aiFetch({ body: ask("google/gemini-3.1-flash-image") });
    expect(models).toEqual(["google/gemini-3.1-flash-image"]);
  });
});

describe("saving the model pick", () => {
  beforeEach(() => {
    doc = null;
  });

  it("keeps an OpenRouter alias id like ~openai/gpt-sol-latest", async () => {
    const { PUT } = await import("@/app/api/ai/settings/route");
    const { loadSettings } = await fresh();
    const res = await PUT(new Request("http://x", { method: "PUT", body: JSON.stringify({ model: "~openai/gpt-sol-latest" }) }));
    expect(res.status).toBe(200);
    expect((await loadSettings(true)).model).toBe("~openai/gpt-sol-latest");
  });

  it("rejects a bad id out loud instead of silently keeping the old one", async () => {
    vi.resetModules();
    const { PUT } = await import("@/app/api/ai/settings/route");
    const res = await PUT(new Request("http://x", { method: "PUT", body: JSON.stringify({ model: "not a model" }) }));
    expect(res.status).toBe(400);
  });

  it("a provider health write never overwrites the pick", async () => {
    const { saveSettings, recordOk, recordError } = await fresh();
    await saveSettings({ model: "x-ai/grok-4.6" });
    recordError("openrouter", { status: 429, message: "slow down" });
    recordOk("vercel-gateway");
    await new Promise((r) => setTimeout(r, 20));
    const again = await fresh();
    const loaded = await again.loadSettings(true);
    expect(loaded.model).toBe("x-ai/grok-4.6");
    expect(loaded.lastError.openrouter?.status).toBe(429);
  });
});
