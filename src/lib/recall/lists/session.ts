// ---------------------------------------------------------------------------
// Recall Lists — who is asking.
//
// Two principals, two cookies, and one rule that the whole feature rests on:
// a member token must NEVER satisfy the admin check. A member who types
// /apps/recall or calls /api/recall/* directly is rejected by the route, not
// merely shown a different component.
//
//   recall_auth   — the admin. Already exists; derived from the app password.
//   recall_member — a family member. Signed with a secret kept in the lists file.
//
// Node runtime only.
// ---------------------------------------------------------------------------

import { createHmac } from "node:crypto";
import { cookies } from "next/headers";
import { sessionToken, status, tokenMatches } from "../gateStore";
import { tokensMatch } from "../passwords";
import { adminCaller, memberCaller, signingSecret, type Caller } from "./store";

export const MEMBER_COOKIE = "recall_member";
export const ADMIN_COOKIE = "recall_auth";
export const MEMBER_MAX_AGE = 60 * 60 * 24 * 90; // 90 days — a fridge list, not a bank

function sign(payload: string, secret: string): string {
  return createHmac("sha256", secret).update(payload).digest("hex");
}

/** `<memberId>.<expiryMs>.<hmac>` — stateless, revocable by deleting the member. */
export async function mintMemberToken(memberId: string): Promise<string> {
  const secret = await signingSecret();
  const expiry = Date.now() + MEMBER_MAX_AGE * 1000;
  const payload = `${memberId}.${expiry}`;
  return `${payload}.${sign(payload, secret)}`;
}

async function readMemberToken(token: string): Promise<string | null> {
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const [memberId, expiry, mac] = parts;
  if (!/^\d+$/.test(expiry) || Number(expiry) < Date.now()) return null;
  const secret = await signingSecret();
  return tokensMatch(mac, sign(`${memberId}.${expiry}`, secret)) ? memberId : null;
}

async function isAdminCookie(value: string): Promise<boolean> {
  const gate = await status();
  // An ungated Recall is open to whoever reaches it — that is already true of
  // the folder side today, so Lists does not pretend otherwise. The members UI
  // warns that roles only bite once an app password is set.
  if (!gate.gated) return true;
  return Boolean(value) && tokenMatches(value, await sessionToken());
}

/**
 * Resolve the caller from cookies.
 *
 * The member cookie is checked FIRST and wins. Otherwise, on an ungated Recall
 * everyone would resolve to admin — including a member who had signed in
 * properly — and the permission rules would quietly evaporate.
 */
export async function resolveCaller(): Promise<Caller | null> {
  const jar = await cookies();

  const memberToken = jar.get(MEMBER_COOKIE)?.value ?? "";
  if (memberToken) {
    const memberId = await readMemberToken(memberToken);
    // A token for a member who has since been removed resolves to nobody,
    // which is how "remove member" revokes their session.
    if (memberId) {
      const caller = await memberCaller(memberId);
      if (caller) return caller;
    }
  }

  if (await isAdminCookie(jar.get(ADMIN_COOKIE)?.value ?? "")) return adminCaller();
  return null;
}

/** Whether the app password is set at all — roles are advisory until it is. */
export async function gateIsOn(): Promise<boolean> {
  return (await status()).gated;
}

/**
 * True when the caller is signed in as a family member.
 *
 * Members get Lists and nothing else, so the RAG-side routes call this and
 * refuse. Hiding the UI is not enough — this is the check that makes "members
 * cannot reach the rest of Recall" actually true.
 */
export async function callerIsMember(): Promise<boolean> {
  const token = (await cookies()).get(MEMBER_COOKIE)?.value ?? "";
  if (!token) return false;
  const memberId = await readMemberToken(token);
  if (!memberId) return false;
  return Boolean(await memberCaller(memberId));
}
