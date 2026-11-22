// ---------------------------------------------------------------------------
// Who is calling.
//
// Two kinds of caller, because there are genuinely two:
//
//   • A service key — an agent, the Jarvis harness, a cron, another repo.
//     Not a browser, has no session, and never will. Presents
//     `Authorization: Bearer jsk_…`, gets its own rate limit and its own row
//     in the dashboard so "who burned the Tavily credit" has an answer.
//
//   • The signed-in owner — a hub page calling from the browser. Rides the
//     Supabase session cookie that middleware already maintains.
//
// The keys themselves are stored as SHA-256 hashes. The plaintext is shown
// once, at creation, and is then unrecoverable — so a leaked database is not a
// leaked set of credentials, and "show me the key again" has to be answered
// with "revoke it and make another", which is the correct answer.
// ---------------------------------------------------------------------------

import "server-only";

import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { SEARCH_LIMITS } from "./config";
import { findKeyByHash, insertKey, touchKey } from "./store";
import { type Caller, type Scope, SearchError } from "./types";
import { isOwner, parseOwnerEmails } from "@/lib/hubAccess";
import { getSupabaseServerClient } from "@/lib/supabase/server";

/**
 * `jsk_` for Jarvis Search Key, then 32 random bytes as hex.
 *
 * 256 bits of entropy is far more than needed, and the reason to use it anyway
 * is that this token is the whole of the authentication — there is no second
 * factor behind it and no account it is scoped to beyond the owner's own.
 */
const KEY_PREFIX = "jsk_";

export function mintKeyString(): string {
  return `${KEY_PREFIX}${randomBytes(32).toString("hex")}`;
}

export function hashKey(key: string): string {
  return createHash("sha256").update(key.trim()).digest("hex");
}

/** First 12 characters — enough to recognise a key, useless as a credential. */
export function keyPrefixOf(key: string): string {
  return key.slice(0, 12);
}

/** Create a key, returning the plaintext exactly once. */
export async function createServiceKey(options: {
  name: string;
  scopes?: Scope[];
  perMinute?: number;
  perDay?: number;
}): Promise<{ key: string; row: NonNullable<Awaited<ReturnType<typeof insertKey>>> }> {
  const name = options.name.trim().slice(0, 80) || "Unnamed key";
  const key = mintKeyString();
  const row = await insertKey({
    name,
    prefix: keyPrefixOf(key),
    keyHash: hashKey(key),
    scopes: options.scopes?.length ? options.scopes : ["search", "extract"],
    perMinute: options.perMinute ?? SEARCH_LIMITS.perMinute,
    perDay: options.perDay ?? SEARCH_LIMITS.perDay,
  });
  if (!row) {
    throw new SearchError(
      "Service keys need shared storage, and this host has none. Set SUPABASE_SERVICE_ROLE_KEY, then issue the key again.",
      { status: 503, code: "no_storage" },
    );
  }
  return { key, row };
}

/** Constant-time compare, so a wrong key leaks nothing through timing. */
function sameHash(a: string, b: string): boolean {
  const left = Buffer.from(a, "utf8");
  const right = Buffer.from(b, "utf8");
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

function bearerFrom(request: Request): string | null {
  const header = request.headers.get("authorization") ?? "";
  const match = /^Bearer\s+(.+)$/i.exec(header.trim());
  if (match) return match[1].trim();
  // A second accepted header, because some callers (n8n nodes, a few shell
  // scripts, the odd MCP client) cannot set Authorization but can set this.
  const alt = request.headers.get("x-search-key");
  return alt ? alt.trim() : null;
}

/**
 * An environment-pinned key, so a single-tenant deployment works with no
 * database at all.
 *
 * This is how the laptop and the VPS talk to each other before any Supabase
 * project exists: set SEARCH_SERVICE_KEY on both ends and the bearer check
 * passes without a lookup. It is one shared key with the default limits — fine
 * for the owner's own machines, which is the only thing it is for.
 */
function envKey(): string | null {
  const raw = (process.env.SEARCH_SERVICE_KEY ?? "").trim();
  return raw.length >= 16 ? raw : null;
}

/**
 * Resolve the caller, or throw a SearchError the route can return directly.
 *
 * Order matters: the bearer key is checked first so an agent's call never
 * depends on cookies, and a *present but wrong* key is rejected outright
 * rather than falling through to the session. Falling through would turn a
 * typo'd key into a confusing 401-about-sign-in, and worse, would let a
 * browser-based caller with a bad key succeed on its cookie and never learn
 * the key was broken.
 */
export async function resolveCaller(request: Request): Promise<Caller> {
  const presented = bearerFrom(request);

  if (presented) {
    const pinned = envKey();
    if (pinned && sameHash(hashKey(presented), hashKey(pinned))) {
      return {
        kind: "key",
        id: "env:service-key",
        label: "SEARCH_SERVICE_KEY",
        perMinute: SEARCH_LIMITS.perMinute,
        perDay: SEARCH_LIMITS.perDay,
        scopes: ["search", "extract"],
      };
    }

    const row = await findKeyByHash(hashKey(presented));
    if (!row) {
      throw new SearchError(
        "That API key isn't recognised. It may have been revoked — issue a new one in the Search Infrastructure dashboard.",
        { status: 401, code: "bad_key" },
      );
    }
    touchKey(row.id);
    return {
      kind: "key",
      id: `key:${row.id}`,
      label: row.name,
      perMinute: row.perMinute,
      perDay: row.perDay,
      scopes: row.scopes,
    };
  }

  const supabase = await getSupabaseServerClient();
  if (!supabase) {
    // No Supabase at all: a local dev host with no auth. The hub is not
    // reachable from anywhere else in that state, so treating the local caller
    // as the owner is right — and it is the only way `npm run dev` works
    // before any keys are set.
    return {
      kind: "session",
      id: "local:dev",
      label: "Local dev",
      perMinute: SEARCH_LIMITS.perMinute,
      perDay: SEARCH_LIMITS.perDay,
      scopes: ["search", "extract", "admin"],
    };
  }

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    throw new SearchError(
      "Sign in, or call this endpoint with a service key in the Authorization header.",
      { status: 401, code: "no_auth" },
    );
  }
  if (!isOwner(user.email, parseOwnerEmails(process.env.HUB_OWNER_EMAILS))) {
    throw new SearchError("This endpoint is private.", { status: 403, code: "not_owner" });
  }

  return {
    kind: "session",
    id: `user:${user.id}`,
    label: user.email ?? "Owner",
    perMinute: SEARCH_LIMITS.perMinute,
    perDay: SEARCH_LIMITS.perDay,
    scopes: ["search", "extract", "admin"],
  };
}

/** The owner in a browser, and nobody else. Guards key minting. */
export async function requireAdmin(request: Request): Promise<Caller> {
  const caller = await resolveCaller(request);
  if (!caller.scopes.includes("admin")) {
    throw new SearchError(
      "Managing keys needs the owner signed in — a service key can't mint another service key.",
      { status: 403, code: "not_admin" },
    );
  }
  return caller;
}

export function requireScope(caller: Caller, scope: Scope): void {
  if (!caller.scopes.includes(scope)) {
    throw new SearchError(`The key "${caller.label}" doesn't have the "${scope}" permission.`, {
      status: 403,
      code: "missing_scope",
    });
  }
}
