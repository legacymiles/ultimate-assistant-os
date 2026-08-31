// ---------------------------------------------------------------------------
// Password hashing, in one place.
//
// Recall now has two things that hold passwords — the app gate (one shared
// secret) and Lists members (one per person). Both must use the same
// parameters, and a parameter that drifts between two copies of this code is a
// silent security regression, so the numbers live here and nowhere else.
//
// Node runtime only.
// ---------------------------------------------------------------------------

import { pbkdf2, randomBytes, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";

const pbkdf2Async = promisify(pbkdf2);

export const ITERATIONS = 210_000;
export const KEYLEN = 32;
export const DIGEST = "sha256";

export async function deriveKey(password: string, salt: Buffer): Promise<Buffer> {
  return (await pbkdf2Async(password, salt, ITERATIONS, KEYLEN, DIGEST)) as Buffer;
}

export interface PasswordHash {
  salt: string;
  hash: string;
}

export async function hashPassword(password: string): Promise<PasswordHash> {
  const salt = randomBytes(16);
  const hash = await deriveKey(password, salt);
  return { salt: salt.toString("base64"), hash: hash.toString("base64") };
}

/**
 * Constant-time check. Returns false rather than throwing on a malformed
 * record, so a corrupted file locks someone out instead of crashing the route.
 */
export async function verifyPassword(
  password: string,
  stored: Partial<PasswordHash> | null | undefined,
): Promise<boolean> {
  if (!stored?.salt || !stored?.hash) return false;
  try {
    const expected = Buffer.from(stored.hash, "base64");
    const actual = await deriveKey(password, Buffer.from(stored.salt, "base64"));
    return expected.length === actual.length && timingSafeEqual(expected, actual);
  } catch {
    return false;
  }
}

/** Length-safe constant-time string compare, for tokens and cookies. */
export function tokensMatch(a: string, b: string): boolean {
  if (!a || !b || a.length !== b.length) return false;
  return timingSafeEqual(Buffer.from(a), Buffer.from(b));
}
