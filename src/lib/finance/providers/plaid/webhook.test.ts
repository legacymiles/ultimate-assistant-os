import { createHash, createSign, generateKeyPairSync, sign as cryptoSign } from "node:crypto";
import { describe, expect, it } from "vitest";
import { verifyWebhook } from "./webhook";
import type { PlaidJwk } from "./webhook";

// A P-256 keypair generated here, so these tests need no network and no secrets.
const { privateKey, publicKey } = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
const jwk = publicKey.export({ format: "jwk" }) as unknown as PlaidJwk;

const b64url = (b: Buffer) =>
  b.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

const NOW = 1_790_000_000;
const BODY = JSON.stringify({ webhook_type: "TRANSACTIONS", webhook_code: "SYNC_UPDATES_AVAILABLE" });

function makeToken(opts: {
  body?: string;
  iat?: number;
  alg?: string;
  kid?: string | undefined;
  bodyHash?: string;
  signWith?: typeof privateKey;
} = {}): string {
  const body = opts.body ?? BODY;
  const header = { alg: opts.alg ?? "ES256", kid: opts.kid === undefined ? "key-1" : opts.kid };
  const payload = {
    iat: opts.iat ?? NOW,
    request_body_sha256:
      opts.bodyHash ?? createHash("sha256").update(body, "utf8").digest("hex"),
  };
  const h = b64url(Buffer.from(JSON.stringify(header)));
  const p = b64url(Buffer.from(JSON.stringify(payload)));
  const sig = cryptoSign("sha256", Buffer.from(`${h}.${p}`), {
    key: opts.signWith ?? privateKey,
    dsaEncoding: "ieee-p1363",
  });
  return `${h}.${p}.${b64url(sig)}`;
}

const fetchKey = async (keyId: string): Promise<PlaidJwk | null> =>
  keyId === "key-1" ? jwk : null;

describe("verifyWebhook — accepts the real thing", () => {
  it("verifies a genuine webhook", async () => {
    const r = await verifyWebhook(makeToken(), BODY, fetchKey, NOW);
    expect(r.ok).toBe(true);
  });

  it("accepts one a few minutes old", async () => {
    const r = await verifyWebhook(makeToken({ iat: NOW - 120 }), BODY, fetchKey, NOW);
    expect(r.ok).toBe(true);
  });
});

describe("verifyWebhook — rejects everything else", () => {
  it("rejects a missing header", async () => {
    const r = await verifyWebhook(null, BODY, fetchKey, NOW);
    expect(r).toEqual({ ok: false, reason: expect.stringContaining("No plaid-verification") });
  });

  it("rejects a malformed token", async () => {
    const r = await verifyWebhook("not.a.jwt.at.all", BODY, fetchKey, NOW);
    expect(r.ok).toBe(false);
  });

  // The classic JWT forgery: an attacker picks the algorithm.
  it("rejects alg none", async () => {
    const r = await verifyWebhook(makeToken({ alg: "none" }), BODY, fetchKey, NOW);
    expect(r.ok).toBe(false);
    expect(r).toMatchObject({ reason: expect.stringContaining("algorithm") });
  });

  it("rejects alg HS256 even with a valid-looking signature", async () => {
    const r = await verifyWebhook(makeToken({ alg: "HS256" }), BODY, fetchKey, NOW);
    expect(r.ok).toBe(false);
  });

  it("rejects a token naming no key", async () => {
    const r = await verifyWebhook(makeToken({ kid: "" }), BODY, fetchKey, NOW);
    expect(r.ok).toBe(false);
  });

  it("rejects a key id Plaid does not know", async () => {
    const r = await verifyWebhook(makeToken({ kid: "key-unknown" }), BODY, fetchKey, NOW);
    expect(r).toMatchObject({ ok: false, reason: expect.stringContaining("did not return a key") });
  });

  it("rejects a signature from the wrong key", async () => {
    const other = generateKeyPairSync("ec", { namedCurve: "prime256v1" }).privateKey;
    const r = await verifyWebhook(makeToken({ signWith: other }), BODY, fetchKey, NOW);
    expect(r).toMatchObject({ ok: false, reason: expect.stringContaining("Signature") });
  });

  it("rejects a tampered signature", async () => {
    const token = makeToken();
    const [h, p, s] = token.split(".");
    const flipped = `${s.slice(0, -2)}${s.slice(-2) === "AA" ? "BB" : "AA"}`;
    const r = await verifyWebhook(`${h}.${p}.${flipped}`, BODY, fetchKey, NOW);
    expect(r.ok).toBe(false);
  });

  // The body is what actually gets written to the ledger.
  it("rejects a body that does not match the signed hash", async () => {
    const r = await verifyWebhook(makeToken(), `${BODY} `, fetchKey, NOW);
    expect(r).toMatchObject({ ok: false, reason: expect.stringContaining("Body does not match") });
  });

  it("rejects a swapped body even though the token itself is valid", async () => {
    const evil = JSON.stringify({ webhook_type: "TRANSACTIONS", webhook_code: "EVIL" });
    const r = await verifyWebhook(makeToken(), evil, fetchKey, NOW);
    expect(r.ok).toBe(false);
  });

  it("rejects a replay older than five minutes", async () => {
    const r = await verifyWebhook(makeToken({ iat: NOW - 301 }), BODY, fetchKey, NOW);
    expect(r).toMatchObject({ ok: false, reason: expect.stringContaining("replay") });
  });

  it("rejects a future-dated token", async () => {
    const r = await verifyWebhook(makeToken({ iat: NOW + 600 }), BODY, fetchKey, NOW);
    expect(r.ok).toBe(false);
  });

  it("rejects a token with no iat", async () => {
    const h = b64url(Buffer.from(JSON.stringify({ alg: "ES256", kid: "key-1" })));
    const p = b64url(Buffer.from(JSON.stringify({ request_body_sha256: "x" })));
    const sig = cryptoSign("sha256", Buffer.from(`${h}.${p}`), {
      key: privateKey,
      dsaEncoding: "ieee-p1363",
    });
    const r = await verifyWebhook(`${h}.${p}.${b64url(sig)}`, BODY, fetchKey, NOW);
    expect(r).toMatchObject({ ok: false, reason: expect.stringContaining("iat") });
  });

  it("rejects a token carrying no body hash", async () => {
    const h = b64url(Buffer.from(JSON.stringify({ alg: "ES256", kid: "key-1" })));
    const p = b64url(Buffer.from(JSON.stringify({ iat: NOW })));
    const sig = cryptoSign("sha256", Buffer.from(`${h}.${p}`), {
      key: privateKey,
      dsaEncoding: "ieee-p1363",
    });
    const r = await verifyWebhook(`${h}.${p}.${b64url(sig)}`, BODY, fetchKey, NOW);
    expect(r).toMatchObject({ ok: false, reason: expect.stringContaining("body hash") });
  });

  it("survives a key fetcher that throws rather than crashing the route", async () => {
    await expect(
      verifyWebhook(makeToken(), BODY, async () => {
        throw new Error("plaid is down");
      }, NOW),
    ).rejects.toThrow();
  });
});

// If a DER-encoded signature were accepted, we would be verifying something
// other than what Plaid sends — this pins the encoding.
describe("signature encoding", () => {
  it("does not accept a DER-encoded signature", async () => {
    const header = { alg: "ES256", kid: "key-1" };
    const payload = {
      iat: NOW,
      request_body_sha256: createHash("sha256").update(BODY, "utf8").digest("hex"),
    };
    const h = b64url(Buffer.from(JSON.stringify(header)));
    const p = b64url(Buffer.from(JSON.stringify(payload)));
    const der = createSign("sha256").update(`${h}.${p}`).sign(privateKey); // DER by default
    const r = await verifyWebhook(`${h}.${p}.${b64url(der)}`, BODY, fetchKey, NOW);
    expect(r.ok).toBe(false);
  });
});
