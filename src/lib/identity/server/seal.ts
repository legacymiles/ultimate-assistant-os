import "server-only";

// ---------------------------------------------------------------------------
// Face data at rest.
//
// The reference faces derived for recognition are biometric templates. They
// are sealed here — AES-256-GCM with IDENTITY_ENC_KEY, the account id bound in
// as additional data so one account's blob cannot be opened as another's — and
// only the ciphertext is ever written to the synced app_state row.
//
// No key: `configured()` is false, nothing is sealed, and the browser keeps the
// face data in memory only (it is rebuilt from the profile's authorized photos
// on each device). Face data is never written in the clear.
// ---------------------------------------------------------------------------

import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

const ALGO = "aes-256-gcm";

function keyOf(raw = process.env.IDENTITY_ENC_KEY): Buffer | null {
  if (!raw) return null;
  const key = Buffer.from(raw, "base64");
  return key.length === 32 ? key : null;
}

export function configured(raw = process.env.IDENTITY_ENC_KEY): boolean {
  return keyOf(raw) !== null;
}

/** "v1.<iv>.<tag>.<ciphertext>", base64 parts. */
export function seal(plain: string, account: string, raw = process.env.IDENTITY_ENC_KEY): string {
  const key = keyOf(raw);
  if (!key) throw new Error("IDENTITY_ENC_KEY is not set (32 bytes, base64), so face data cannot be stored.");
  const iv = randomBytes(12);
  const c = createCipheriv(ALGO, key, iv);
  c.setAAD(Buffer.from(`identity-faces:${account}`));
  const body = Buffer.concat([c.update(plain, "utf8"), c.final()]);
  return ["v1", iv.toString("base64"), c.getAuthTag().toString("base64"), body.toString("base64")].join(".");
}

export function open(sealed: string, account: string, raw = process.env.IDENTITY_ENC_KEY): string {
  const key = keyOf(raw);
  if (!key) throw new Error("IDENTITY_ENC_KEY is not set.");
  const [v, iv, tag, body] = sealed.split(".");
  if (v !== "v1" || !iv || !tag || !body) throw new Error("Stored face data is malformed.");
  const d = createDecipheriv(ALGO, key, Buffer.from(iv, "base64"));
  d.setAAD(Buffer.from(`identity-faces:${account}`));
  d.setAuthTag(Buffer.from(tag, "base64"));
  return Buffer.concat([d.update(Buffer.from(body, "base64")), d.final()]).toString("utf8");
}
