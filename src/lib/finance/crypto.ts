// ---------------------------------------------------------------------------
// Personal Finance — access tokens at rest.
//
// A Plaid access token is a long-lived key to someone's bank feed. It is
// encrypted before it touches the database and decrypted only inside the node
// runtime; no API route returns one, or any prefix of one.
//
// AES-256-GCM rather than CBC because GCM authenticates: a tampered ciphertext
// throws instead of decrypting to rubbish that then gets sent to Plaid.
//
// This module throws loudly when the key is missing. That is deliberate, and is
// the one place the repo's "degrade visibly, never 500" rule does not apply:
// callers check `configured()` BEFORE getting here, so reaching this code
// without a key would mean storing a bank token in the clear.
// ---------------------------------------------------------------------------

import { createCipheriv, createDecipheriv, randomBytes, timingSafeEqual } from "node:crypto";

const ALGO = "aes-256-gcm";
const IV_BYTES = 12; // GCM's standard nonce length.

/** A fresh base64 key, for the setup instructions and for tests. */
export function newEncKey(): string {
  return randomBytes(32).toString("base64");
}

function keyOf(raw: string | undefined): Buffer {
  if (!raw) {
    throw new Error("FINANCE_ENC_KEY is not set, so a bank token cannot be stored safely.");
  }
  const key = Buffer.from(raw, "base64");
  if (key.length !== 32) {
    throw new Error(`FINANCE_ENC_KEY must decode to 32 bytes, got ${key.length}.`);
  }
  return key;
}

/** "<iv>.<tag>.<ciphertext>", all base64. */
export function encryptToken(plain: string, encKey = process.env.FINANCE_ENC_KEY): string {
  const key = keyOf(encKey);
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGO, key, iv);
  const body = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return [
    iv.toString("base64"),
    cipher.getAuthTag().toString("base64"),
    body.toString("base64"),
  ].join(".");
}

export function decryptToken(blob: string, encKey = process.env.FINANCE_ENC_KEY): string {
  const key = keyOf(encKey);
  const [ivB64, tagB64, bodyB64] = blob.split(".");
  if (!ivB64 || !tagB64 || !bodyB64) throw new Error("Stored token is malformed.");
  const decipher = createDecipheriv(ALGO, key, Buffer.from(ivB64, "base64"));
  decipher.setAuthTag(Buffer.from(tagB64, "base64"));
  return Buffer.concat([
    decipher.update(Buffer.from(bodyB64, "base64")),
    decipher.final(),
  ]).toString("utf8");
}

/** Constant-time equality, for comparing digests without leaking by timing. */
export function sameDigest(a: string, b: string): boolean {
  const x = Buffer.from(a, "utf8");
  const y = Buffer.from(b, "utf8");
  if (x.length !== y.length) return false;
  return timingSafeEqual(x, y);
}
