import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { call, probe, readToken } from "./bridge";

// A tiny window + localStorage, since the suite runs in node.
const store = new Map<string, string>();
beforeEach(() => {
  store.clear();
  vi.stubGlobal("window", {
    localStorage: {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
      removeItem: (k: string) => void store.delete(k),
    },
  });
});
afterEach(() => vi.unstubAllGlobals());

const TOKEN = "t".repeat(32);
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

describe("pairing with the PC by itself", () => {
  it("pairs on the first probe — no token to copy", async () => {
    const fetch = vi.fn(async (url: string, _init?: RequestInit) =>
      url.endsWith("/health") ? json({ version: "1", pairable: true, capabilities: { shell: true } }) : json({ token: TOKEN }),
    );
    vi.stubGlobal("fetch", fetch);
    const h = await probe();
    expect(h).toMatchObject({ up: true, paired: true });
    expect(readToken()).toBe(TOKEN);
    const pairCall = fetch.mock.calls.find((c) => String(c[0]).endsWith("/pair"));
    expect(pairCall?.[1]?.headers).toMatchObject({ "X-Jarvis-Pair": "1" });
  });

  it("says it's setting itself up while it installs", async () => {
    store.set("new-jarvis:bridge-token", TOKEN);
    vi.stubGlobal("fetch", vi.fn(async () => json({ pairable: true, setup: { state: "installing", why: "Setting itself up" } })));
    const h = await probe();
    expect(h.settingUp).toBe(true);
    expect(h.problem).toMatch(/Setting itself up/);
  });

  it("is plainly offline when nothing answers", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => {
      throw new TypeError("Failed to fetch");
    }));
    const h = await probe();
    expect(h).toMatchObject({ up: false, paired: false });
    expect(h.problem).toMatch(/isn't running/);
  });

  it("re-pairs once when the saved token went stale (agent reinstalled or moved)", async () => {
    store.set("new-jarvis:bridge-token", "old".repeat(11));
    let shellCalls = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        if (url.endsWith("/pair")) return json({ token: TOKEN });
        shellCalls++;
        const auth = (init?.headers as Record<string, string>)?.Authorization;
        return auth === `Bearer ${TOKEN}` ? json({ ok: true, out: "hi" }) : json({ error: "Not paired" }, 401);
      }),
    );
    await expect(call("shell", { cmd: "echo hi" })).resolves.toMatchObject({ out: "hi" });
    expect(shellCalls).toBe(2);
    expect(readToken()).toBe(TOKEN);
  });
});
