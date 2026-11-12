/**
 * Crash + event logging (R2). Every browser error, unhandled rejection and
 * server failure lands here so it can be fixed before anyone reports it.
 *
 * Logs go to the structured server console (picked up by Vercel) and, when a
 * database is connected, into a ring of recent errors the owner's admin page
 * reads. Logging must never itself throw.
 */

import { SUPABASE_SERVICE, SUPABASE_URL } from "./flags";

export type LogLevel = "info" | "warn" | "error";

export interface LogEntry {
  level: LogLevel;
  event: string;
  message?: string;
  stack?: string;
  url?: string;
  userId?: string | null;
  meta?: Record<string, unknown>;
  at: string;
}

const MAX_RING = 100;
/** In-process fallback so demo mode still has something for the admin page. */
const ring: LogEntry[] = [];

function redact(value: unknown): unknown {
  if (typeof value !== "string") return value;
  return (
    value
      .replace(/(sk-[A-Za-z0-9_-]{8})[A-Za-z0-9_-]+/g, "$1***")
      .replace(/(eyJ[A-Za-z0-9_-]{6})[A-Za-z0-9_.-]+/g, "$1***")
      .replace(/(Bearer\s+)[^\s"']+/gi, "$1***")
      // Supabase's current non-JWT keys and Stripe's webhook secret match
      // none of the patterns above.
      .replace(/(sb_(?:secret|publishable)_[A-Za-z0-9]{6})[A-Za-z0-9_-]+/g, "$1***")
      .replace(/(whsec_[A-Za-z0-9]{6})[A-Za-z0-9_-]+/g, "$1***")
      .replace(/(rk_(?:live|test)_[A-Za-z0-9]{6})[A-Za-z0-9]+/g, "$1***")
  );
}

function clean(meta?: Record<string, unknown>) {
  if (!meta) return undefined;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(meta)) {
    if (/key|secret|token|password|authorization/i.test(k)) {
      out[k] = "***";
    } else {
      out[k] = redact(v);
    }
  }
  return out;
}

export async function log(entry: Omit<LogEntry, "at">): Promise<void> {
  const full: LogEntry = {
    ...entry,
    message: redact(entry.message) as string | undefined,
    stack: redact(entry.stack) as string | undefined,
    meta: clean(entry.meta),
    at: new Date().toISOString(),
  };

  try {
    const line = JSON.stringify({ bf: true, ...full });
    if (full.level === "error") console.error(line);
    else if (full.level === "warn") console.warn(line);
    else console.log(line);
  } catch {
    /* never let logging break a request */
  }

  ring.unshift(full);
  if (ring.length > MAX_RING) ring.length = MAX_RING;

  if (full.level === "error" && SUPABASE_URL && SUPABASE_SERVICE) {
    // Best-effort: stored under the owner's row so the admin page can read it.
    void persist(full).catch(() => {});
  }
}

export function recentLogs(): LogEntry[] {
  return [...ring];
}

/**
 * Errors are persisted into a PER-DAY bucket, not one shared ring.
 *
 * A single 200-entry ring is trivially flushed: anyone can POST to /api/log,
 * so 250 junk entries would evict every genuine error before anyone read them
 * — anti-forensics that hides a real problem. Bucketing by day means a flood
 * can at worst bury today, and the admin page reads several days back.
 */
async function persist(entry: LogEntry) {
  const { ownerUserId } = await import("./db/owner");
  const owner = await ownerUserId();
  if (!owner) return;
  const { serviceStore } = await import("./db/store");
  const store = serviceStore(owner);
  const key = `bf:errors:${entry.at.slice(0, 10)}`;
  const current = (await store.get<{ items: LogEntry[] }>(key)) ?? { items: [] };
  const items = [entry, ...(current.items ?? [])].slice(0, 200);
  await store.set(key, { items });
}

/** Read the recent persisted errors, newest first, across the last few days. */
export async function persistedErrors(days = 5): Promise<LogEntry[]> {
  try {
    const { ownerUserId } = await import("./db/owner");
    const owner = await ownerUserId();
    if (!owner) return [];
    const { serviceStore } = await import("./db/store");
    const store = serviceStore(owner);
    const rows = await store.list<{ items: LogEntry[] }>("bf:errors:");
    return rows
      .slice(0, days)
      .flatMap((r) => r.data?.items ?? [])
      .sort((a, b) => (b.at ?? "").localeCompare(a.at ?? ""));
  } catch {
    return [];
  }
}

/** Wrap a route handler so a thrown error is logged and answered in plain English (R1, R3). */
export function withLogging<T extends unknown[]>(
  event: string,
  handler: (...args: T) => Promise<Response>,
): (...args: T) => Promise<Response> {
  return async (...args: T) => {
    try {
      return await handler(...args);
    } catch (err) {
      const e = err as Error;
      await log({
        level: "error",
        event,
        message: e?.message ?? String(err),
        stack: e?.stack,
      });
      return Response.json(
        {
          error:
            "Something broke on our side. Nothing you typed was lost — try that again in a moment.",
          code: "server_error",
        },
        { status: 500 },
      );
    }
  };
}
