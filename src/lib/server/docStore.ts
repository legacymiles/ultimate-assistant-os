// ---------------------------------------------------------------------------
// One JSON document, owned by the server.
//
// STD Safe and the Recall Lists board both keep their entire state as a single
// document that the server owns and guards. Neither can use app_state: that
// table is keyed by viewer and readable by that viewer, and these documents are
// shared, multi-party, and full of things one participant must not see.
//
// Both wrote it to a file next to the project, which is right locally and
// broken on Vercel — a read-only, per-instance filesystem means the write
// either fails or disappears at the next deploy. This module keeps the file
// behaviour for local development and adds a Postgres-backed one for
// deployment, chosen by whether a service-role key is configured.
//
// Why the service role: public.server_docs has RLS enabled and no policy, so
// the publishable key cannot touch it at all. That is the point — the rules
// about who may read which health record live in the route layer, and a
// client-readable copy of the document would route around every one of them.
// This module must therefore only ever be imported from server code.
// ---------------------------------------------------------------------------

import "server-only";

import { promises as fs } from "node:fs";
import path from "node:path";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const TABLE = "server_docs";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";

/** True when documents can be kept in Postgres rather than on local disk. */
export function isRemoteConfigured(): boolean {
  return Boolean(SUPABASE_URL && SERVICE_ROLE_KEY);
}

let client: SupabaseClient | null = null;

function remote(): SupabaseClient | null {
  if (!isRemoteConfigured()) return null;
  if (!client) {
    client = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
      // No session to persist or refresh: this client is a server identity,
      // not a signed-in person, and every request carries the same key.
      auth: { persistSession: false, autoRefreshToken: false },
    });
  }
  return client;
}

// --- local file fallback ---------------------------------------------------

function localPath(name: string, dir: string): string {
  return path.join(dir, name);
}

async function ensureDir(dir: string): Promise<boolean> {
  try {
    await fs.mkdir(dir, { recursive: true });
    return true;
  } catch {
    return false;
  }
}

/**
 * Read a document, or null when it has never been written.
 *
 * `dir` is only consulted by the file backend; callers pass their own data
 * directory so the two apps stay independently relocatable, exactly as they
 * were when each owned its own file.
 */
export async function readDoc<T>(name: string, dir: string): Promise<T | null> {
  const db = remote();
  if (db) {
    try {
      const { data, error } = await db
        .from(TABLE)
        .select("data")
        .eq("name", name)
        .maybeSingle();
      if (error) return null;
      return (data?.data as T) ?? null;
    } catch {
      return null;
    }
  }

  try {
    const raw = await fs.readFile(localPath(name, dir), "utf8");
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

/**
 * Persist a document. Returns whether it actually landed — callers surface
 * that rather than assuming, because "the host silently discarded your health
 * record" is not something to find out later.
 */
export async function writeDoc<T>(name: string, dir: string, data: T): Promise<boolean> {
  const db = remote();
  if (db) {
    try {
      const { error } = await db
        .from(TABLE)
        .upsert({ name, data: data as unknown as object }, { onConflict: "name" });
      return !error;
    } catch {
      return false;
    }
  }

  if (!(await ensureDir(dir))) return false;
  try {
    await fs.writeFile(localPath(name, dir), JSON.stringify(data, null, 2), "utf8");
    return true;
  } catch {
    return false;
  }
}

/**
 * Whether this host will actually keep what is written, and why.
 *
 * Both apps show this to the user. The honest answers differ: Postgres keeps
 * it, a writable local directory keeps it until the next deploy, and a
 * read-only one keeps nothing at all.
 */
export async function persistence(
  dir: string,
): Promise<{ persistent: boolean; reason: string }> {
  if (isRemoteConfigured()) {
    const db = remote();
    if (!db) return { persistent: false, reason: "Storage is not configured." };
    try {
      // A cheap round trip: proves the key works and the table is reachable,
      // without writing anything.
      const { error } = await db.from(TABLE).select("name").limit(1);
      if (error) {
        return {
          persistent: false,
          reason: "The database rejected the connection. Check SUPABASE_SERVICE_ROLE_KEY.",
        };
      }
      return { persistent: true, reason: "Saved to the database." };
    } catch {
      return { persistent: false, reason: "The database could not be reached." };
    }
  }

  if (!(await ensureDir(dir))) {
    return {
      persistent: false,
      reason:
        "This host's filesystem is read-only, so nothing here is saved. Set SUPABASE_SERVICE_ROLE_KEY to store it in the database instead.",
    };
  }
  return {
    persistent: true,
    reason: "Saved to this machine. On a deployed host, set SUPABASE_SERVICE_ROLE_KEY.",
  };
}
