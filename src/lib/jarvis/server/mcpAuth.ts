import "server-only";

// ---------------------------------------------------------------------------
// Who is allowed to reach memory from OUTSIDE a browser.
//
// Every other memory route authenticates with the signed-in user's cookie
// session, and `server/memory.ts` is emphatic that reads and writes go through
// that user's own client so RLS is what keeps one person's rows away from
// another's. An MCP client — Claude Code on a VPS, a claude.ai connector —
// has no cookie session with this app and never will, exactly like the browser
// extension in `record/http.ts`. So this file is the deliberate exception, and
// the two rules that keep it safe are:
//
//   1. A request gets in only by presenting JARVIS_MCP_TOKEN, compared in
//      constant time. No token, no context.
//   2. The user id is read from the environment and NEVER from the request.
//      A caller cannot name whose memories to touch, so the service role's
//      ability to bypass RLS buys an attacker nothing beyond the one account
//      the token already belongs to.
//
// Rotating the token is changing one environment variable and redeploying.
// ---------------------------------------------------------------------------

import { createClient } from "@supabase/supabase-js";
import { timingSafeEqual, createHash } from "node:crypto";
import { SUPABASE_URL } from "@/lib/supabase/config";
import type { MemoryContext } from "./memory";

/** The profile every external client writes into. Not caller-settable. */
const MCP_PROFILE = "owner";

export interface McpConfig {
  tokenSet: boolean;
  userIdSet: boolean;
  serviceKeySet: boolean;
  supabaseSet: boolean;
}

/** What is and is not configured — booleans only, never the values. */
export function mcpConfig(): McpConfig {
  return {
    tokenSet: Boolean(process.env.JARVIS_MCP_TOKEN),
    userIdSet: Boolean(process.env.JARVIS_MCP_USER_ID),
    serviceKeySet: Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY),
    supabaseSet: Boolean(SUPABASE_URL),
  };
}

export function mcpReady(): boolean {
  const c = mcpConfig();
  return c.tokenSet && c.userIdSet && c.serviceKeySet && c.supabaseSet;
}

/** The token off an Authorization header or an x-jarvis-token header. */
export function tokenFrom(req: Request): string {
  const auth = req.headers.get("authorization") ?? "";
  const bearer = /^Bearer\s+(.+)$/i.exec(auth);
  if (bearer) return bearer[1].trim();
  return (req.headers.get("x-jarvis-token") ?? "").trim();
}

/**
 * Compare without leaking length or position through timing. Both sides are
 * hashed first because timingSafeEqual throws on a length mismatch, and the
 * throw itself would be the length oracle.
 */
function sameToken(given: string, want: string): boolean {
  if (!given || !want) return false;
  const a = createHash("sha256").update(given).digest();
  const b = createHash("sha256").update(want).digest();
  return timingSafeEqual(a, b);
}

export type MaybeMcpContext = MemoryContext | { available: false; reason: string; status: number };

/**
 * Build a memory context for a token-bearing caller. The shape returned is the
 * same `MemoryContext` the cookie path produces, which is the point: every
 * function in `server/memory.ts` then works unchanged.
 */
export function mcpContext(req: Request): MaybeMcpContext {
  const want = process.env.JARVIS_MCP_TOKEN ?? "";
  const userId = process.env.JARVIS_MCP_USER_ID ?? "";
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";

  if (!want || !userId || !serviceKey || !SUPABASE_URL) {
    return {
      available: false,
      status: 503,
      reason:
        "Memory sync is not configured on this deployment. Set JARVIS_MCP_TOKEN, JARVIS_MCP_USER_ID, SUPABASE_SERVICE_ROLE_KEY and NEXT_PUBLIC_SUPABASE_URL, then redeploy.",
    };
  }
  if (!sameToken(tokenFrom(req), want)) {
    return { available: false, status: 401, reason: "Missing or wrong token." };
  }

  const db = createClient(SUPABASE_URL, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return { available: true, userId, profileId: MCP_PROFILE, db };
}
