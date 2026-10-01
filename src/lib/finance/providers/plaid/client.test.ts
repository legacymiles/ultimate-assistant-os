import { afterEach, describe, expect, it, vi } from "vitest";
import { PlaidError, configured, plaidConfig, plaidEnv, plaidFetch } from "./client";

const FULL = {
  PLAID_CLIENT_ID: "cid",
  PLAID_SECRET: "sec",
  FINANCE_ENC_KEY: "k",
} as unknown as NodeJS.ProcessEnv;

afterEach(() => vi.unstubAllGlobals());

describe("configured", () => {
  it("is ok when everything is present", () => {
    expect(configured(FULL)).toEqual({ ok: true, reason: "" });
  });

  // The no-keys rule: name the missing variable so the panel can say it, and
  // never throw — the rest of the app runs on the declared-bills ledger.
  it("names the missing client id", () => {
    expect(configured({ ...FULL, PLAID_CLIENT_ID: undefined })).toMatchObject({
      ok: false,
      reason: expect.stringContaining("PLAID_CLIENT_ID"),
    });
  });

  it("names the missing secret", () => {
    expect(configured({ ...FULL, PLAID_SECRET: undefined })).toMatchObject({
      ok: false,
      reason: expect.stringContaining("PLAID_SECRET"),
    });
  });

  // Refusing without the encryption key is the point: the alternative is
  // storing a bank access token in the clear.
  it("refuses when the encryption key is absent", () => {
    expect(configured({ ...FULL, FINANCE_ENC_KEY: undefined })).toMatchObject({
      ok: false,
      reason: expect.stringContaining("FINANCE_ENC_KEY"),
    });
  });

  it("does not throw with a completely empty environment", () => {
    expect(() => configured({} as NodeJS.ProcessEnv)).not.toThrow();
  });
});

describe("plaidEnv", () => {
  it("defaults to sandbox", () => {
    expect(plaidEnv(undefined)).toBe("sandbox");
    expect(plaidEnv("nonsense")).toBe("sandbox");
  });
  it("honours production only when asked exactly", () => {
    expect(plaidEnv("production")).toBe("production");
  });
});

describe("plaidConfig", () => {
  it("is null without credentials", () => {
    expect(plaidConfig({} as NodeJS.ProcessEnv)).toBeNull();
  });
  it("points at the sandbox host by default", () => {
    expect(plaidConfig(FULL)?.baseUrl).toBe("https://sandbox.plaid.com");
  });
  it("points at production when asked", () => {
    expect(plaidConfig({ ...FULL, PLAID_ENV: "production" })?.baseUrl).toBe(
      "https://production.plaid.com",
    );
  });
});

const CONFIG = plaidConfig(FULL)!;

describe("plaidFetch", () => {
  it("posts the credentials in the body, as Plaid expects", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ ok: true }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    await plaidFetch("/accounts/get", { access_token: "tok" }, CONFIG);

    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://sandbox.plaid.com/accounts/get");
    expect(JSON.parse(String(init.body))).toEqual({
      access_token: "tok",
      client_id: "cid",
      secret: "sec",
    });
  });

  it("returns the parsed body", async () => {
    vi.stubGlobal("fetch", async () => new Response(JSON.stringify({ accounts: [] }), { status: 200 }));
    await expect(plaidFetch("/accounts/get", {}, CONFIG)).resolves.toEqual({ accounts: [] });
  });

  it("raises a PlaidError carrying the error code", async () => {
    vi.stubGlobal(
      "fetch",
      async () =>
        new Response(
          JSON.stringify({
            error_code: "ITEM_LOGIN_REQUIRED",
            error_message: "the login details have changed",
            request_id: "req-1",
          }),
          { status: 400 },
        ),
    );
    const err = await plaidFetch("/transactions/sync", {}, CONFIG).catch((e) => e);
    expect(err).toBeInstanceOf(PlaidError);
    expect(err.code).toBe("ITEM_LOGIN_REQUIRED");
    expect(err.status).toBe(400);
    expect(err.requestId).toBe("req-1");
  });

  it("prefers Plaid's own owner-facing wording when it gives one", async () => {
    vi.stubGlobal(
      "fetch",
      async () =>
        new Response(
          JSON.stringify({
            error_code: "ITEM_LOGIN_REQUIRED",
            error_message: "internal wording",
            display_message: "Please reconnect your bank.",
          }),
          { status: 400 },
        ),
    );
    const err = await plaidFetch("/x", {}, CONFIG).catch((e) => e);
    expect(err.message).toBe("Please reconnect your bank.");
  });

  it("raises rather than returning rubbish on unreadable JSON", async () => {
    vi.stubGlobal("fetch", async () => new Response("<html>502</html>", { status: 502 }));
    const err = await plaidFetch("/x", {}, CONFIG).catch((e) => e);
    expect(err).toBeInstanceOf(PlaidError);
    expect(err.code).toBe("BAD_JSON");
  });

  it("refuses to call anything when Plaid is not configured", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    await expect(plaidFetch("/x", {}, null)).rejects.toThrow(/not configured/);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
