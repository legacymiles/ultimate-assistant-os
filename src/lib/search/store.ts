// ---------------------------------------------------------------------------
// The service's own storage: cache, rate counters, usage rows, service keys.
//
// Supabase with the service-role key when there is one, and an in-process
// fallback when there is not. The fallback is not a toy — the service has to
// work on a laptop with no Supabase project, and `commercial` Step 3's demo
// mode says the layer exists and works before the keys do. What you lose
// without Supabase is everything that has to be SHARED: the cache stops being
// shared between serverless instances, rate counters count per-instance, usage
// history dies with the process, and service keys cannot be issued at all
// (a credential that only one instance recognises is worse than none).
//
// Every table is RLS-on with no policy, so the anon key reads nothing. Only
// this module, holding the service-role key, touches them.
// ---------------------------------------------------------------------------

import "server-only";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { after } from "next/server";
import { SEARCH_LIMITS, isPlan } from "./config";
import type { Caller, Plan, Scope, SearchResponse } from "./types";

/**
 * Keep a background write alive past the response.
 *
 * A bare `void promise.then(...)` is not safe on a serverless host: the
 * instance can be frozen the moment the response is sent, and the insert never
 * lands — which would make the usage dashboard quietly under-report, the one
 * thing a usage dashboard must not do. `after()` is Next's hook for exactly
 * this: the platform keeps the function alive until the work finishes.
 *
 * It throws when called outside a request (a unit test, a script), so the
 * fallback is to let it run detached — correct there, because nothing is about
 * to freeze.
 */
function keepAlive(work: PromiseLike<unknown>): void {
  const swallowed = Promise.resolve(work).then(undefined, () => undefined);
  try {
    after(swallowed);
  } catch {
    void swallowed;
  }
}

const SUPABASE_URL = (process.env.NEXT_PUBLIC_SUPABASE_URL ?? "").trim();
const SERVICE_KEY = (process.env.SUPABASE_SERVICE_ROLE_KEY ?? "").trim();

let cached: SupabaseClient | null = null;

/** The service-role client, or null when this host has no key. */
export function serviceClient(): SupabaseClient | null {
  if (!SUPABASE_URL || !SERVICE_KEY) return null;
  if (!cached) {
    cached = createClient(SUPABASE_URL, SERVICE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  }
  return cached;
}

export function storageReady(): boolean {
  return serviceClient() !== null;
}

/** Which storage is actually in play, for the dashboard to state plainly. */
export function storageMode(): { shared: boolean; detail: string } {
  return storageReady()
    ? { shared: true, detail: "Supabase — cache, limits, usage and keys shared across every instance." }
    : {
        shared: false,
        detail:
          "In-memory only. Searches still work and are still cached, but the cache and the counters live in this one server process and service keys can't be issued. Set SUPABASE_SERVICE_ROLE_KEY to share them.",
      };
}

// ---------------------------------------------------------------------------
// Cache
// ---------------------------------------------------------------------------

interface CacheRow {
  payload: SearchResponse;
  storedAt: number;
}

/**
 * The in-process layer, which runs even WITH Supabase in front of it.
 *
 * An agent researching a topic fires near-identical queries seconds apart, and
 * a local hit saves the Supabase round trip as well as the provider call. Hard
 * cap on entries because a long-running instance would otherwise hold every
 * search it ever served.
 */
const memory = new Map<string, CacheRow>();
const MEMORY_MAX = 500;

function memorySet(key: string, payload: SearchResponse): void {
  if (memory.size >= MEMORY_MAX) {
    // Oldest insertion first — Map preserves insertion order, so the first key
    // is the oldest. Evicting a handful at once beats evicting on every write.
    const stale = [...memory.keys()].slice(0, Math.ceil(MEMORY_MAX / 10));
    for (const k of stale) memory.delete(k);
  }
  memory.set(key, { payload, storedAt: Date.now() });
}

export interface CacheHit {
  payload: SearchResponse;
  ageSeconds: number;
}

export async function cacheGet(key: string, ttlSeconds: number): Promise<CacheHit | null> {
  const local = memory.get(key);
  if (local) {
    const age = Math.round((Date.now() - local.storedAt) / 1000);
    if (age <= ttlSeconds) return { payload: local.payload, ageSeconds: age };
    memory.delete(key);
  }

  const db = serviceClient();
  if (!db) return null;
  const { data, error } = await db
    .from("search_cache")
    .select("payload, created_at")
    .eq("cache_key", key)
    .maybeSingle();
  if (error || !data) return null;

  const storedAt = new Date(data.created_at as string).getTime();
  const age = Math.round((Date.now() - storedAt) / 1000);
  if (!Number.isFinite(age) || age > ttlSeconds) return null;

  const payload = data.payload as SearchResponse;
  memory.set(key, { payload, storedAt });
  return { payload, ageSeconds: age };
}

export async function cacheSet(key: string, payload: SearchResponse): Promise<void> {
  memorySet(key, payload);
  const db = serviceClient();
  if (!db) return;
  // Backgrounded, not awaited: the caller already has its results, and a
  // cache write has no business adding its round trip to their latency. A
  // failure here must never fail the search that already succeeded, and the
  // in-process copy above already covers a second identical request arriving
  // before this lands.
  keepAlive(
    db.from("search_cache").upsert(
      {
        cache_key: key,
        query: payload.query.slice(0, 500),
        kind: payload.kind,
        provider: payload.provider,
        payload,
        created_at: new Date().toISOString(),
      },
      { onConflict: "cache_key" },
    ),
  );
}

/** Drop everything, or everything for one kind. The dashboard's Clear cache. */
export async function cacheClear(kind?: string): Promise<number> {
  let dropped = 0;
  for (const [key, row] of memory) {
    if (!kind || row.payload.kind === kind) {
      memory.delete(key);
      dropped += 1;
    }
  }
  const db = serviceClient();
  if (db) {
    // `count` on the delete itself, not a select after it: a delete builder's
    // .select() takes columns, and the row count is what is wanted here.
    // The `neq` on the all-rows path is there because PostgREST refuses an
    // unfiltered delete outright, as a guard against exactly this statement
    // being written by accident.
    const base = db.from("search_cache").delete({ count: "exact" });
    const { count } = kind ? await base.eq("kind", kind) : await base.neq("cache_key", "");
    dropped = Math.max(dropped, count ?? 0);
  }
  return dropped;
}

/** Rows older than the TTL, swept opportunistically rather than on a cron. */
export async function cacheSweep(): Promise<void> {
  const db = serviceClient();
  if (!db) return;
  const cutoff = new Date(Date.now() - SEARCH_LIMITS.extractTtlSeconds * 1000).toISOString();
  keepAlive(db.from("search_cache").delete().lt("created_at", cutoff));
}

// ---------------------------------------------------------------------------
// Rate limits
// ---------------------------------------------------------------------------

export interface RateVerdict {
  allowed: boolean;
  minuteCount: number;
  dayCount: number;
  perMinute: number;
  perDay: number;
  /** Seconds until the caller may try again. Null when allowed. */
  retryAfter: number | null;
  /** Plain English, ready to hand to a person. */
  message: string | null;
}

const localCounters = new Map<string, { count: number; resetAt: number }>();

function bumpLocal(bucket: string, windowMs: number): number {
  const now = Date.now();
  const existing = localCounters.get(bucket);
  if (!existing || existing.resetAt <= now) {
    localCounters.set(bucket, { count: 1, resetAt: now + windowMs });
    return 1;
  }
  existing.count += 1;
  return existing.count;
}

/**
 * Count this call against the caller's minute and day windows, atomically.
 *
 * Read-then-write would undercount badly here: an agent firing ten parallel
 * searches would have all ten read the same count and all ten pass a limit of
 * one. The Postgres function does the increment and the read in a single
 * statement, so the tenth call sees ten. Without Supabase this falls back to
 * module-local counters, which are correct within one instance and stated as
 * such in storageMode().
 */
export async function rateCheck(caller: Caller): Promise<RateVerdict> {
  const perMinute = caller.perMinute;
  const perDay = caller.perDay;
  const db = serviceClient();

  let minuteCount: number;
  let dayCount: number;

  if (db) {
    const { data, error } = await db.rpc("search_rate_bump", {
      p_caller: caller.id,
      p_minute: new Date(Math.floor(Date.now() / 60_000) * 60_000).toISOString(),
      p_day: new Date(new Date().toISOString().slice(0, 10)).toISOString(),
    });
    if (error || !data) {
      // A limiter that cannot count must not become a limiter that blocks
      // everything. Fall through to the local counters and keep serving.
      minuteCount = bumpLocal(`${caller.id}:m`, 60_000);
      dayCount = bumpLocal(`${caller.id}:d`, 86_400_000);
    } else {
      const row = Array.isArray(data) ? data[0] : data;
      minuteCount = Number(row?.minute_count ?? 1);
      dayCount = Number(row?.day_count ?? 1);
    }
  } else {
    minuteCount = bumpLocal(`${caller.id}:m`, 60_000);
    dayCount = bumpLocal(`${caller.id}:d`, 86_400_000);
  }

  if (minuteCount > perMinute) {
    const retryAfter = 60 - new Date().getSeconds();
    return {
      allowed: false,
      minuteCount,
      dayCount,
      perMinute,
      perDay,
      retryAfter,
      message: `That's ${minuteCount} searches this minute, and the limit for ${caller.label} is ${perMinute}. Try again in ${retryAfter}s.`,
    };
  }
  if (dayCount > perDay) {
    const midnight = new Date();
    midnight.setUTCHours(24, 0, 0, 0);
    const retryAfter = Math.round((midnight.getTime() - Date.now()) / 1000);
    return {
      allowed: false,
      minuteCount,
      dayCount,
      perMinute,
      perDay,
      retryAfter,
      message: `${caller.label} has used ${dayCount} of its ${perDay} searches today. The count resets at midnight UTC.`,
    };
  }

  return { allowed: true, minuteCount, dayCount, perMinute, perDay, retryAfter: null, message: null };
}

/** Only for tests. */
export function resetLocalCounters(): void {
  localCounters.clear();
  memory.clear();
}

// ---------------------------------------------------------------------------
// Usage
// ---------------------------------------------------------------------------

export interface UsageEvent {
  callerId: string;
  callerKind: Caller["kind"];
  callerLabel: string;
  /** The person the calling key belongs to, when it belongs to one. */
  ownerEmail?: string | null;
  plan?: Plan;
  /** The app or agent that said it was calling, from `label` on the request. */
  app: string | null;
  kind: string;
  query: string;
  provider: string | null;
  location: string | null;
  cached: boolean;
  degraded: boolean;
  ms: number;
  resultCount: number;
  extracted: number;
  ok: boolean;
  error: string | null;
}

const recentLocal: (UsageEvent & { at: string })[] = [];

/**
 * Record one call. Never throws and never delays the response.
 *
 * The query text is stored — it has to be, or "which searches are burning the
 * Tavily credit" is unanswerable — and it is the owner's own query on the
 * owner's own infrastructure. It is capped at 500 characters so a pathological
 * caller cannot use the usage log as a blob store.
 */
export function recordUsage(event: UsageEvent): void {
  const row = { ...event, query: event.query.slice(0, 500), at: new Date().toISOString() };
  recentLocal.unshift(row);
  if (recentLocal.length > 200) recentLocal.length = 200;

  const db = serviceClient();
  if (!db) return;
  keepAlive(
    db.from("search_usage").insert({
      caller_id: row.callerId,
      caller_kind: row.callerKind,
      caller_label: row.callerLabel,
      owner_email: row.ownerEmail ?? null,
      plan: row.plan ?? null,
      app: row.app,
      kind: row.kind,
      query: row.query,
      provider: row.provider,
      location: row.location,
      cached: row.cached,
      degraded: row.degraded,
      ms: row.ms,
      result_count: row.resultCount,
      extracted: row.extracted,
      ok: row.ok,
      error: row.error,
    }),
  );
}

export interface UsageSummary {
  windowHours: number;
  total: number;
  ok: number;
  failed: number;
  cacheHits: number;
  cacheHitRate: number;
  degraded: number;
  medianMs: number;
  p95Ms: number;
  byProvider: { provider: string; count: number; failed: number }[];
  byKind: { kind: string; count: number }[];
  byCaller: { label: string; kind: string; count: number; failed: number }[];
  byApp: { app: string; count: number }[];
  /** One row per person a key was issued to. Owner's own calls are grouped as "you". */
  byPerson: { email: string; plan: string; count: number; failed: number; lastAt: string }[];
  topQueries: { query: string; count: number }[];
  recent: (UsageEvent & { at: string })[];
  /** Per-hour counts, oldest first, for the sparkline. */
  series: { hour: string; total: number; cached: number; failed: number }[];
  shared: boolean;
}

interface RawUsageRow {
  caller_id: string;
  caller_kind: string;
  caller_label: string | null;
  owner_email: string | null;
  plan: string | null;
  app: string | null;
  kind: string;
  query: string;
  provider: string | null;
  location: string | null;
  cached: boolean;
  degraded: boolean;
  ms: number;
  result_count: number;
  extracted: number | null;
  ok: boolean;
  error: string | null;
  created_at: string;
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const index = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length));
  return sorted[index];
}

function tally<T extends string>(values: T[]): { value: T; count: number }[] {
  const counts = new Map<T, number>();
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
  return [...counts.entries()]
    .map(([value, count]) => ({ value, count }))
    .sort((a, b) => b.count - a.count);
}

export async function usageSummary(windowHours = 24): Promise<UsageSummary> {
  const since = new Date(Date.now() - windowHours * 3_600_000);
  const db = serviceClient();

  let rows: RawUsageRow[];
  if (db) {
    const { data } = await db
      .from("search_usage")
      .select(
        "caller_id, caller_kind, caller_label, owner_email, plan, app, kind, query, provider, location, cached, degraded, ms, result_count, extracted, ok, error, created_at",
      )
      .gte("created_at", since.toISOString())
      .order("created_at", { ascending: false })
      .limit(5000);
    rows = (data ?? []) as RawUsageRow[];
  } else {
    rows = recentLocal
      .filter((row) => new Date(row.at) >= since)
      .map((row) => ({
        caller_id: row.callerId,
        caller_kind: row.callerKind,
        caller_label: row.callerLabel,
        owner_email: row.ownerEmail ?? null,
        plan: row.plan ?? null,
        app: row.app,
        kind: row.kind,
        query: row.query,
        provider: row.provider,
        location: row.location,
        cached: row.cached,
        degraded: row.degraded,
        ms: row.ms,
        result_count: row.resultCount,
        extracted: row.extracted,
        ok: row.ok,
        error: row.error,
        created_at: row.at,
      }));
  }

  const latencies = rows
    .filter((row) => !row.cached && row.ok)
    .map((row) => row.ms)
    .sort((a, b) => a - b);
  const cacheHits = rows.filter((row) => row.cached).length;

  const byCallerMap = new Map<string, { label: string; kind: string; count: number; failed: number }>();
  for (const row of rows) {
    const key = row.caller_id;
    const entry =
      byCallerMap.get(key) ??
      { label: row.caller_label || row.caller_id, kind: row.caller_kind, count: 0, failed: 0 };
    entry.count += 1;
    if (!row.ok) entry.failed += 1;
    byCallerMap.set(key, entry);
  }

  const byProviderMap = new Map<string, { provider: string; count: number; failed: number }>();
  for (const row of rows) {
    const key = row.provider ?? "none";
    const entry = byProviderMap.get(key) ?? { provider: key, count: 0, failed: 0 };
    entry.count += 1;
    if (!row.ok) entry.failed += 1;
    byProviderMap.set(key, entry);
  }

  const buckets = new Map<string, { hour: string; total: number; cached: number; failed: number }>();
  const hours = Math.min(windowHours, 48);
  for (let i = hours - 1; i >= 0; i -= 1) {
    const at = new Date(Date.now() - i * 3_600_000);
    at.setMinutes(0, 0, 0);
    const key = at.toISOString();
    buckets.set(key, { hour: key, total: 0, cached: 0, failed: 0 });
  }
  for (const row of rows) {
    const at = new Date(row.created_at);
    at.setMinutes(0, 0, 0);
    const bucket = buckets.get(at.toISOString());
    if (!bucket) continue;
    bucket.total += 1;
    if (row.cached) bucket.cached += 1;
    if (!row.ok) bucket.failed += 1;
  }

  return {
    windowHours,
    total: rows.length,
    ok: rows.filter((row) => row.ok).length,
    failed: rows.filter((row) => !row.ok).length,
    cacheHits,
    cacheHitRate: rows.length ? Number((cacheHits / rows.length).toFixed(3)) : 0,
    degraded: rows.filter((row) => row.degraded).length,
    medianMs: percentile(latencies, 50),
    p95Ms: percentile(latencies, 95),
    byProvider: [...byProviderMap.values()].sort((a, b) => b.count - a.count),
    byKind: tally(rows.map((row) => row.kind)).map(({ value, count }) => ({ kind: value, count })),
    byCaller: [...byCallerMap.values()].sort((a, b) => b.count - a.count),
    byApp: tally(rows.map((row) => row.app ?? "unlabelled")).map(({ value, count }) => ({
      app: value,
      count,
    })),
    byPerson: (() => {
      const people = new Map<string, { email: string; plan: string; count: number; failed: number; lastAt: string }>();
      for (const row of rows) {
        // A row with no owner_email is the owner's own traffic — their agents,
        // their hub pages. Grouping it under one name keeps the table about
        // "who else is using this", which is the question it exists to answer.
        const email = row.owner_email ?? "you";
        const entry = people.get(email) ?? {
          email,
          plan: row.plan ?? "owner",
          count: 0,
          failed: 0,
          lastAt: row.created_at,
        };
        entry.count += 1;
        if (!row.ok) entry.failed += 1;
        if (row.created_at > entry.lastAt) entry.lastAt = row.created_at;
        people.set(email, entry);
      }
      return [...people.values()].sort((a, b) => b.count - a.count);
    })(),
    topQueries: tally(rows.map((row) => row.query))
      .slice(0, 12)
      .map(({ value, count }) => ({ query: value, count })),
    recent: rows.slice(0, 40).map((row) => ({
      callerId: row.caller_id,
      callerKind: row.caller_kind as Caller["kind"],
      callerLabel: row.caller_label || row.caller_id,
      ownerEmail: row.owner_email,
      plan: isPlan(row.plan) ? row.plan : undefined,
      app: row.app,
      kind: row.kind,
      query: row.query,
      provider: row.provider,
      location: row.location,
      cached: row.cached,
      degraded: row.degraded,
      ms: row.ms,
      resultCount: row.result_count,
      extracted: row.extracted ?? 0,
      ok: row.ok,
      error: row.error,
      at: row.created_at,
    })),
    series: [...buckets.values()],
    shared: Boolean(db),
  };
}

// ---------------------------------------------------------------------------
// Service keys
// ---------------------------------------------------------------------------

export interface ServiceKeyRow {
  id: string;
  name: string;
  /** First 12 characters, so a person can tell two keys apart. Never the key. */
  prefix: string;
  scopes: Scope[];
  perMinute: number;
  perDay: number;
  createdAt: string;
  lastUsedAt: string | null;
  revokedAt: string | null;
  callsTotal: number;
  /** Who it was issued to. Null = one of the owner's own keys. */
  ownerEmail: string | null;
  /** Set the first time that person signs in with the address it was issued to. */
  ownerUserId: string | null;
  plan: Plan;
  /** When it stops working, if the owner set an expiry. */
  expiresAt: string | null;
  note: string | null;
}

/** Every column a ServiceKeyRow is built from — named once so a select cannot drift. */
const KEY_COLUMNS =
  "id, name, prefix, scopes, per_minute, per_day, created_at, last_used_at, revoked_at, calls_total, owner_email, owner_user_id, plan, expires_at, note";

interface RawKeyRow {
  id: string;
  name: string;
  prefix: string;
  scopes: string[] | null;
  per_minute: number | null;
  per_day: number | null;
  created_at: string;
  last_used_at: string | null;
  revoked_at: string | null;
  calls_total: number | null;
  owner_email: string | null;
  owner_user_id: string | null;
  plan: string | null;
  expires_at: string | null;
  note: string | null;
}

function toKeyRow(raw: RawKeyRow): ServiceKeyRow {
  return {
    id: raw.id,
    name: raw.name,
    prefix: raw.prefix,
    scopes: (raw.scopes ?? ["search", "extract"]) as Scope[],
    perMinute: raw.per_minute ?? SEARCH_LIMITS.perMinute,
    perDay: raw.per_day ?? SEARCH_LIMITS.perDay,
    createdAt: raw.created_at,
    lastUsedAt: raw.last_used_at,
    revokedAt: raw.revoked_at,
    callsTotal: raw.calls_total ?? 0,
    ownerEmail: raw.owner_email,
    ownerUserId: raw.owner_user_id,
    plan: isPlan(raw.plan) ? raw.plan : "owner",
    expiresAt: raw.expires_at,
    note: raw.note,
  };
}

export async function listKeys(): Promise<ServiceKeyRow[]> {
  const db = serviceClient();
  if (!db) return [];
  const { data } = await db
    .from("search_api_keys")
    .select(KEY_COLUMNS)
    .order("created_at", { ascending: false });
  return ((data ?? []) as RawKeyRow[]).map(toKeyRow);
}

export async function insertKey(row: {
  name: string;
  prefix: string;
  keyHash: string;
  scopes: Scope[];
  perMinute: number;
  perDay: number;
  ownerEmail?: string | null;
  plan?: Plan;
  expiresAt?: string | null;
  note?: string | null;
}): Promise<ServiceKeyRow | null> {
  const db = serviceClient();
  if (!db) return null;
  const { data, error } = await db
    .from("search_api_keys")
    .insert({
      name: row.name,
      prefix: row.prefix,
      key_hash: row.keyHash,
      scopes: row.scopes,
      per_minute: row.perMinute,
      per_day: row.perDay,
      // Lowercased on the way in: the lookup indexes are on lower(owner_email),
      // and a key issued to "Sam@x.com" must be found by "sam@x.com".
      owner_email: row.ownerEmail ? row.ownerEmail.trim().toLowerCase() : null,
      plan: row.plan ?? "owner",
      expires_at: row.expiresAt ?? null,
      note: row.note ?? null,
    })
    .select(KEY_COLUMNS)
    .single();
  if (error || !data) return null;
  return toKeyRow(data as RawKeyRow);
}

export async function revokeKey(id: string): Promise<boolean> {
  const db = serviceClient();
  if (!db) return false;
  const { error } = await db
    .from("search_api_keys")
    .update({ revoked_at: new Date().toISOString() })
    .eq("id", id)
    .is("revoked_at", null);
  return !error;
}

/**
 * Look a presented key up by its hash. Revoked or expired keys resolve to null.
 *
 * Expiry is checked here as well as swept in the background, because the sweep
 * is opportunistic and a key must stop working the moment it expires — not the
 * next time something happens to run the sweep.
 */
export async function findKeyByHash(keyHash: string): Promise<ServiceKeyRow | null> {
  const db = serviceClient();
  if (!db) return null;
  const { data } = await db
    .from("search_api_keys")
    .select(KEY_COLUMNS)
    .eq("key_hash", keyHash)
    .is("revoked_at", null)
    .maybeSingle();
  if (!data) return null;
  const row = toKeyRow(data as RawKeyRow);
  if (row.expiresAt && new Date(row.expiresAt).getTime() <= Date.now()) {
    // Tidy it away so the dashboard shows it as revoked rather than live.
    keepAlive(db.rpc("search_keys_expire"));
    return null;
  }
  return row;
}

/** Every live key issued to one person, by the address it was issued to. */
export async function listKeysForEmail(email: string): Promise<ServiceKeyRow[]> {
  const db = serviceClient();
  if (!db) return [];
  const { data } = await db
    .from("search_api_keys")
    .select(KEY_COLUMNS)
    .eq("owner_email", email.trim().toLowerCase())
    .order("created_at", { ascending: false });
  return ((data ?? []) as RawKeyRow[]).map(toKeyRow);
}

/**
 * Attach any keys issued to this address to the account that just signed in.
 *
 * The owner issues a key before the person has an account — that is the normal
 * order — so the link is made on their first sign-in. Never moves a key that
 * already belongs to an account, so a second sign-up on the same address
 * cannot take one over.
 */
export function claimKeysFor(email: string, userId: string): void {
  const db = serviceClient();
  if (!db) return;
  keepAlive(db.rpc("search_key_claim", { p_email: email.trim().toLowerCase(), p_user_id: userId }));
}

/** Stamp last-used and bump the lifetime counter. Fire-and-forget. */
export function touchKey(id: string): void {
  const db = serviceClient();
  if (!db) return;
  keepAlive(db.rpc("search_key_touch", { p_id: id }));
}
