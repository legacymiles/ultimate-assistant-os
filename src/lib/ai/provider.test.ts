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

  // The bug that emptied $20 of OpenRouter credit: with nothing picked, every
  // general call in the hub went to the model the route had NAMED — Opus 5, the
  // most expensive id in the catalogue — because the sentinel was also used as
  // the destination. With nothing picked the ROUTER decides now, and its
  // ordinary-work rung is free.
  it("with no pick, the router answers and never sends the Claude sentinel", async () => {
    doc = null;
    const { aiFetch, DEFAULT_MODEL } = await fresh();
    expect(await (await aiFetch({ body: ask(DEFAULT_MODEL) })).json()).toEqual({ model: "qwen/qwen3.8-27b:free" });
    expect(models.some((m) => m.startsWith("anthropic/"))).toBe(false);
  });

  it("with no pick, an app's hard-coded Claude id is routed too", async () => {
    doc = null;
    const { aiFetch } = await fresh();
    await aiFetch({ body: ask("anthropic/claude-sonnet-5") });
    expect(models.some((m) => m.startsWith("anthropic/"))).toBe(false);
  });

  // Free first, then free again: the retry is sorted by cost, so plain text that
  // one free model would not answer goes to the OTHER free model before any
  // paid rung gets a turn.
  it("with no pick, a failing free model retries on the other free one", async () => {
    doc = null;
    answer = (model) => (model === "qwen/qwen3.8-27b:free" ? new Response("nope", { status: 404 }) : Response.json({ model }));
    const { aiFetch, DEFAULT_MODEL } = await fresh();
    expect(await (await aiFetch({ body: ask(DEFAULT_MODEL) })).json()).toEqual({ model: "thinkingmachines/inkling:free" });
  });

  // Routing is what happens when NOTHING is picked. Turning it off has to
  // restore the old behaviour exactly, or the switch is a lie.
  it("router off falls back to the one cheap default", async () => {
    doc = { router: false };
    const { aiFetch, DEFAULT_MODEL } = await fresh();
    expect(await (await aiFetch({ body: ask(DEFAULT_MODEL) })).json()).toEqual({ model: "google/gemini-3.8-flash" });
  });

  it("routes a harder request up a rung, and one with audio to the model that listens", async () => {
    doc = null;
    const { aiFetch, DEFAULT_MODEL } = await fresh();
    await aiFetch({
      body: JSON.stringify({
        model: DEFAULT_MODEL,
        messages: [{ role: "user", content: [{ type: "input_audio", input_audio: { data: "A", format: "mp3" } }] }],
      }),
    });
    expect(models[0]).toBe("thinkingmachines/inkling:free");

    models.length = 0;
    await aiFetch({ body: JSON.stringify({ model: DEFAULT_MODEL, messages: [{ role: "user", content: "hi" }], task: { difficulty: "hardest" } }) });
    expect(models[0]).toBe("openai/gpt-6-luna-pro");
  });

  // The hint is this hub's, not a provider's parameter.
  it("strips the task hint and asks OpenRouter for the real cost", async () => {
    doc = null;
    const bodies: Record<string, unknown>[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init: RequestInit) => {
        const body = JSON.parse(String(init.body)) as Record<string, unknown>;
        bodies.push(body);
        models.push(String(body.model));
        return Response.json({ model: body.model });
      }),
    );
    const { aiFetch, DEFAULT_MODEL } = await fresh();
    await aiFetch({ body: JSON.stringify({ model: DEFAULT_MODEL, messages: [{ role: "user", content: "hi" }], task: { app: "Jarvis chat" } }) });
    expect(bodies[0]).not.toHaveProperty("task");
    expect(bodies[0].usage).toEqual({ include: true });
  });

  // The Studio's Film setup deck sets its own chain. It outranks the ladder,
  // because there the choice of brain is part of the creative setup.
  it("follows a surface's own declared chain instead of the ladder", async () => {
    doc = null;
    const { aiFetch, DEFAULT_MODEL } = await fresh();
    await aiFetch({
      body: JSON.stringify({
        model: DEFAULT_MODEL,
        messages: [{ role: "user", content: "plan the film" }],
        task: { app: "Jarvis Studio", models: ["openai/gpt-6-luna-pro", "xiaomi/mimo-v2.6-flash"] },
      }),
    });
    expect(models[0]).toBe("openai/gpt-6-luna-pro");
  });

  it("walks a declared chain in order when the first one is down", async () => {
    doc = null;
    answer = (model) => (model === "openai/gpt-6-luna-pro" ? new Response("down", { status: 503 }) : Response.json({ model }));
    const { aiFetch, DEFAULT_MODEL } = await fresh();
    const res = await aiFetch({
      body: JSON.stringify({
        model: DEFAULT_MODEL,
        messages: [{ role: "user", content: "plan the film" }],
        task: { models: ["openai/gpt-6-luna-pro", "xiaomi/mimo-v2.6-flash"] },
      }),
    });
    expect(await res.json()).toEqual({ model: "xiaomi/mimo-v2.6-flash" });
    expect(models).toEqual(["openai/gpt-6-luna-pro", "xiaomi/mimo-v2.6-flash"]);
  });

  it("an empty declared chain is no opinion, not a broken call", async () => {
    doc = null;
    const { aiFetch, DEFAULT_MODEL } = await fresh();
    await aiFetch({
      body: JSON.stringify({ model: DEFAULT_MODEL, messages: [{ role: "user", content: "hi" }], task: { models: [] } }),
    });
    expect(models[0]).toBe("qwen/qwen3.8-27b:free");
  });

  // The body is built per ATTEMPT, not per model: `usage: {include: true}` is
  // OpenRouter's alone, and reusing one serialised body across a fallback sent
  // that flag to the gateway and then dropped it from the next OpenRouter call,
  // silently losing the per-call cost the ledger depends on.
  it("shapes the body for whichever provider is actually taking the call", async () => {
    doc = null;
    vi.stubEnv("AI_GATEWAY_API_KEY", "gw-key");
    const sent: { url: string; usage: unknown }[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init: RequestInit) => {
        const body = JSON.parse(String(init.body)) as Record<string, unknown>;
        sent.push({ url, usage: body.usage });
        models.push(String(body.model));
        // OpenRouter is down, so every model falls through to the gateway.
        return url.includes("openrouter")
          ? new Response("down", { status: 503 })
          : Response.json({ model: body.model });
      }),
    );
    const { aiFetch, DEFAULT_MODEL } = await fresh();
    await aiFetch({ body: ask(DEFAULT_MODEL) });

    expect(sent.length).toBeGreaterThanOrEqual(2);
    for (const s of sent) {
      if (s.url.includes("openrouter")) expect(s.usage).toEqual({ include: true });
      else expect(s.usage).toBeUndefined();
    }
  });

  // The point of the whole trail: after routing, the LAST failure is rarely the
  // one that explains anything, and that is all a caller used to see.
  it("hands back a failure that names every model it tried and why", async () => {
    doc = null;
    answer = (model) =>
      model.endsWith(":free")
        ? Response.json({ error: { message: "Rate limit exceeded" } }, { status: 429 })
        : Response.json({ error: { message: "Insufficient credits" } }, { status: 402 });
    const { aiFetch, DEFAULT_MODEL } = await fresh();
    const res = await aiFetch({ body: ask(DEFAULT_MODEL) });
    expect(res.ok).toBe(false);

    const body = (await res.json()) as { error: { message: string; kind: string; attempts: unknown[] } };
    // Leads with the cause worth acting on, not the first one that happened.
    expect(body.error.kind).toBe("no-credit");
    expect(body.error.message).toContain("out of credit");
    expect(body.error.message).toContain("openrouter.ai/credits");
    // And every model is named, with what it actually said.
    expect(body.error.message).toContain("qwen3.8-27b free");
    expect(body.error.message).toContain("Rate limit exceeded");
    expect(body.error.message).toContain("Insufficient credits");
    expect(body.error.attempts.length).toBeGreaterThan(1);
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
