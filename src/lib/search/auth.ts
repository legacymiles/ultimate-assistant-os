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
import { SEARCH_LIMITS, planLimits } from "./config";
import { claimKeysFor, findKeyByHash, insertKey, listKeysForEmail, touchKey } from "./store";
import { type Caller, type Plan, type Scope, SearchError } from "./types";
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
  /** Issue it TO someone. Omitted = one of the owner's own keys. */
  ownerEmail?: string | null;
  plan?: Plan;
  /** Days until it stops working. Omitted = no expiry. */
  expiresInDays?: number | null;
  note?: string | null;
}): Promise<{ key: string; row: NonNullable<Awaited<ReturnType<typeof insertKey>>> }> {
  const name = options.name.trim().slice(0, 80) || "Unnamed key";
  const key = mintKeyString();
  const plan = planForRecipient(options.ownerEmail, options.plan);
  const limits = planLimits(plan);
  const expiresAt =
    options.expiresInDays && options.expiresInDays > 0
      ? new Date(Date.now() + options.expiresInDays * 86_400_000).toISOString()
      : null;

  const row = await insertKey({
    name,
    prefix: keyPrefixOf(key),
    keyHash: hashKey(key),
    scopes: options.scopes?.length ? options.scopes : ["search", "extract"],
    // An explicit number wins, so the owner can raise one person above their
    // plan without inventing a fourth plan for them.
    perMinute: options.perMinute ?? limits.perMinute,
    perDay: options.perDay ?? limits.perDay,
    ownerEmail: options.ownerEmail ?? null,
    plan,
    expiresAt,
    note: options.note ?? null,
  });
  if (!row) {
    throw new SearchError(
      "Service keys need shared storage, and this host has none. Set SUPABASE_SERVICE_ROLE_KEY, then issue the key again.",
      { status: 503, code: "no_storage" },
    );
  }
  return { key, row };
}

/**
 * Which plan a new key lands on.
 *
 * A key issued TO someone defaults to `member`, never to the owner's own
 * allowance — getting this backwards would hand a stranger the whole Tavily
 * balance, so the default follows who it is for rather than what was passed.
 * Exported and pure because it is the one rule here worth a test of its own.
 */
export function planForRecipient(ownerEmail: string | null | undefined, asked?: Plan): Plan {
  // An explicit `owner` plan on a key issued to someone else is refused rather
  // than honoured: it is far more likely to be a mistake than an intention.
  if (ownerEmail && (!asked || asked === "owner")) return "member";
  if (!ownerEmail && asked && asked !== "owner") {
    // A member/trial plan with nobody to give it to is also a mistake, but the
    // route catches that earlier with a clearer message; default safely here.
    return asked;
  }
  return asked ?? "owner";
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
        plan: "owner",
        ownerEmail: null,
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
      plan: row.plan,
      ownerEmail: row.ownerEmail,
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
      plan: "owner",
      ownerEmail: null,
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
    // A signed-in person who is not the owner used to be refused outright.
    // Now they are a member — but only if the owner has actually issued them a
    // key. Having a hub account is not the same as having been given access to
    // the owner's search providers, and conflating the two would open the
    // service to anyone who can sign up.
    const email = user.email ?? "";
    const keys = email ? await listKeysForEmail(email) : [];
    const live = keys.filter((key) => !key.revokedAt);
    if (live.length === 0) {
      throw new SearchError(
        "You don't have access to this search service yet. Ask the owner to issue you a key.",
        { status: 403, code: "no_access" },
      );
    }
    // First sign-in after being issued a key: link the keys to this account so
    // their own page can find them by account rather than by address.
    if (live.some((key) => !key.ownerUserId)) claimKeysFor(email, user.id);

    // The most generous live key they hold decides their ceiling — holding two
    // keys should not mean being limited by the weaker one.
    const best = live.reduce((a, b) => (b.perDay > a.perDay ? b : a));
    return {
      kind: "session",
      id: `user:${user.id}`,
      label: email || "Member",
      perMinute: best.perMinute,
      perDay: best.perDay,
      scopes: best.scopes.filter((scope) => scope !== "admin"),
      plan: best.plan,
      ownerEmail: email.toLowerCase(),
    };
  }

  return {
    kind: "session",
    id: `user:${user.id}`,
    label: user.email ?? "Owner",
    perMinute: SEARCH_LIMITS.perMinute,
    perDay: SEARCH_LIMITS.perDay,
    scopes: ["search", "extract", "admin"],
    plan: "owner",
    ownerEmail: null,
  };
}

/**
 * The signed-in person, whoever they are, for the member's own page.
 *
 * Separate from resolveCaller because that one answers "may you spend my
 * search quota", and this one answers "who are you, so I can show you your own
 * keys" — a person with no key yet must reach the second without passing the
 * first, or they can never see the page that tells them they have no key.
 */
export async function requireSignedIn(): Promise<{ id: string; email: string; isOwner: boolean }> {
  const supabase = await getSupabaseServerClient();
  if (!supabase) {
    return { id: "local:dev", email: "local@dev", isOwner: true };
  }
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    throw new SearchError("Sign in to see your key.", { status: 401, code: "no_auth" });
  }
  return {
    id: user.id,
    email: (user.email ?? "").toLowerCase(),
    isOwner: isOwner(user.email, parseOwnerEmails(process.env.HUB_OWNER_EMAILS)),
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
