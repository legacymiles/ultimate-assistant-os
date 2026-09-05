// ---------------------------------------------------------------------------
// STD Safe — who is asking.
//
// One principal: a signed-up user. There is no admin here on purpose — nobody
// should hold a key that opens everyone's results, and the owner of the host
// already has the JSON file if they want it.
//
// The cookie is stateless and HMAC-signed with a secret in the store file, the
// same construction recall/lists/session.ts uses. Deleting a user revokes their
// sessions, because the token resolves through callerFor().
//
// Node runtime only.
// ---------------------------------------------------------------------------

import { createHmac } from "node:crypto";
import { cookies } from "next/headers";
import { tokensMatch } from "../recall/passwords";
import { callerFor, signingSecret, type Caller } from "./store";

export const SESSION_COOKIE = "stdsafe_session";
/** Health data on a shared device — far shorter than a fridge list. */
export const SESSION_MAX_AGE = 60 * 60 * 24 * 14;

function sign(payload: string, secret: string): string {
  return createHmac("sha256", secret).update(payload).digest("hex");
}

/** `<userId>.<expiryMs>.<hmac>` */
export async function mintToken(userId: string): Promise<string> {
  const secret = await signingSecret();
  const expiry = Date.now() + SESSION_MAX_AGE * 1000;
  const payload = `${userId}.${expiry}`;
  return `${payload}.${sign(payload, secret)}`;
}

async function readToken(token: string): Promise<string | null> {
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const [userId, expiry, mac] = parts;
  if (!/^\d+$/.test(expiry) || Number(expiry) < Date.now()) return null;
  const secret = await signingSecret();
  return tokensMatch(mac, sign(`${userId}.${expiry}`, secret)) ? userId : null;
}

export async function resolveCaller(): Promise<Caller | null> {
  const token = (await cookies()).get(SESSION_COOKIE)?.value ?? "";
  if (!token) return null;
  const userId = await readToken(token);
  if (!userId) return null;
  // A token for an account that no longer exists resolves to nobody.
  return callerFor(userId);
}

export const COOKIE_OPTIONS = {
  httpOnly: true,
  sameSite: "lax" as const,
  path: "/",
  maxAge: SESSION_MAX_AGE,
  secure: process.env.NODE_ENV === "production",
};
