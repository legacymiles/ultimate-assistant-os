// ---------------------------------------------------------------------------
// Personal Finance — proving a webhook really came from Plaid.
//
// This endpoint writes into the owner's bank ledger, and that ledger is what
// every duplicate-charge alert is computed from. An unverified endpoint lets
// anyone who finds the URL insert charges, suppress real ones, or fabricate an
// alert. So verification is not optional and every check below is required.
//
// Two traps worth naming, because both fail in a way that invites someone to
// "fix" it by turning verification off:
//
// 1. A JWT's ES256 signature is raw r||s (IEEE P1363). Node's crypto.verify
//    defaults to DER, so WITHOUT dsaEncoding: "ieee-p1363" every genuine
//    webhook is rejected.
//
// 2. The body must be hashed EXACTLY as received. Re-serializing the parsed
//    JSON changes the whitespace and the digest never matches, so the route
//    must read the raw text before parsing it.
//
// `alg` is pinned to ES256 rather than read from the token: trusting a token's
// own `alg` is the classic JWT forgery, where an attacker says "none" or swaps
// to HMAC and signs with the public key.
// ---------------------------------------------------------------------------

import { createHash, createPublicKey, verify as cryptoVerify } from "node:crypto";
import { sameDigest } from "../../crypto";

/** How old a webhook may be before it is treated as a replay. */
const MAX_AGE_SECONDS = 5 * 60;

export interface PlaidJwk {
  alg?: string;
  crv?: string;
  kty?: string;
  use?: string;
  x?: string;
  y?: string;
  [k: string]: unknown;
}

export type KeyFetcher = (keyId: string) => Promise<PlaidJwk | null>;

export type VerifyResult = { ok: true } | { ok: false; reason: string };

function b64urlToBuffer(s: string): Buffer {
  return Buffer.from(s.replace(/-/g, "+").replace(/_/g, "/"), "base64");
}

function decodeJson(part: string): Record<string, unknown> | null {
  try {
    const parsed: unknown = JSON.parse(b64urlToBuffer(part).toString("utf8"));
    return parsed !== null && typeof parsed === "object"
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

/**
 * Verify a Plaid webhook.
 *
 * @param token  the `plaid-verification` header, verbatim
 * @param rawBody the request body EXACTLY as received, before JSON.parse
 * @param fetchKey looks up a JWK by key id (the network part, injected so this
 *                 function stays testable offline)
 * @param now    seconds since the epoch, injectable for the replay test
 */
export async function verifyWebhook(
  token: string | null | undefined,
  rawBody: string,
  fetchKey: KeyFetcher,
  now: number = Math.floor(Date.now() / 1000),
): Promise<VerifyResult> {
  if (!token) return { ok: false, reason: "No plaid-verification header." };

  const parts = token.split(".");
  if (parts.length !== 3) return { ok: false, reason: "Verification token is malformed." };
  const [headerPart, payloadPart, signaturePart] = parts;

  const header = decodeJson(headerPart);
  if (!header) return { ok: false, reason: "Verification token header is unreadable." };

  // Pinned, never read from the token. See the note above.
  if (header.alg !== "ES256") {
    return { ok: false, reason: `Unexpected signing algorithm: ${String(header.alg)}.` };
  }
  const kid = header.kid;
  if (typeof kid !== "string" || kid.length === 0) {
    return { ok: false, reason: "Verification token names no key." };
  }

  const jwk = await fetchKey(kid);
  if (!jwk) return { ok: false, reason: "Plaid did not return a key for that id." };

  let key;
  try {
    key = createPublicKey({ key: jwk as never, format: "jwk" });
  } catch {
    return { ok: false, reason: "Plaid's verification key could not be read." };
  }

  const signed = Buffer.from(`${headerPart}.${payloadPart}`, "utf8");
  let signatureValid = false;
  try {
    signatureValid = cryptoVerify(
      "sha256",
      signed,
      // Required: a JWT signature is raw r||s, not DER.
      { key, dsaEncoding: "ieee-p1363" },
      b64urlToBuffer(signaturePart),
    );
  } catch {
    signatureValid = false;
  }
  if (!signatureValid) return { ok: false, reason: "Signature does not verify." };

  const payload = decodeJson(payloadPart);
  if (!payload) return { ok: false, reason: "Verification token body is unreadable." };

  const iat = payload.iat;
  if (typeof iat !== "number") return { ok: false, reason: "Verification token has no iat." };
  const age = now - iat;
  // A future-dated token is as suspicious as an old one.
  if (age > MAX_AGE_SECONDS || age < -MAX_AGE_SECONDS) {
    return { ok: false, reason: `Verification token is ${age}s old; replay window is ${MAX_AGE_SECONDS}s.` };
  }

  const claimed = payload.request_body_sha256;
  if (typeof claimed !== "string") {
    return { ok: false, reason: "Verification token carries no body hash." };
  }
  const actual = createHash("sha256").update(rawBody, "utf8").digest("hex");
  if (!sameDigest(actual, claimed)) {
    return { ok: false, reason: "Body does not match the signed hash." };
  }

  return { ok: true };
}

/** The live key lookup. Separated so verifyWebhook stays testable offline. */
export function plaidKeyFetcher(
  post: (path: string, body: Record<string, unknown>) => Promise<Record<string, unknown>>,
): KeyFetcher {
  return async (keyId: string) => {
    const res = await post("/webhook_verification_key/get", { key_id: keyId });
    const key = res.key;
    return key && typeof key === "object" ? (key as PlaidJwk) : null;
  };
}
