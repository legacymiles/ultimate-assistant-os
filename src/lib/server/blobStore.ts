// ---------------------------------------------------------------------------
// Server-owned binary files.
//
// The document counterpart of docStore.ts, for the bytes that do not fit in a
// JSON row: STD Safe's uploaded lab reports. Same split — a local directory in
// development, a private Supabase Storage bucket once a service-role key is
// configured, chosen the same way so the two never disagree about which host
// they are on.
//
// The buckets this reaches have RLS on and no policy, so the publishable key
// cannot see them. That is what keeps ownership enforceable in the routes,
// which is the only layer that actually knows who owns a given report.
//
// Server-only, and the `server-only` import makes that a build error rather
// than a code review note.
// ---------------------------------------------------------------------------

import "server-only";

import { promises as fs } from "node:fs";
import path from "node:path";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";

/** True when blobs can go to Supabase Storage rather than local disk. */
export function isRemoteConfigured(): boolean {
  return Boolean(SUPABASE_URL && SERVICE_ROLE_KEY);
}

let client: SupabaseClient | null = null;

function remote(): SupabaseClient | null {
  if (!isRemoteConfigured()) return null;
  if (!client) {
    client = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  }
  return client;
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
 * Store bytes under `key` in `bucket`, returning whether it landed.
 *
 * `localDir` is where the file backend puts it. The key is used verbatim as
 * the object path, so callers are responsible for it being a safe relative
 * path — the STD Safe callers validate that before ever getting here.
 */
export async function putBlob(
  bucket: string,
  key: string,
  localDir: string,
  body: Buffer,
  contentType: string,
): Promise<boolean> {
  const db = remote();
  if (db) {
    try {
      const { error } = await db.storage
        .from(bucket)
        .upload(key, body, { contentType, upsert: true });
      return !error;
    } catch {
      return false;
    }
  }

  const full = path.join(localDir, key);
  if (!(await ensureDir(path.dirname(full)))) return false;
  try {
    await fs.writeFile(full, body);
    return true;
  } catch {
    return false;
  }
}

/** Fetch bytes, or null when absent or unreachable. */
export async function getBlob(
  bucket: string,
  key: string,
  localDir: string,
): Promise<Buffer | null> {
  const db = remote();
  if (db) {
    try {
      const { data, error } = await db.storage.from(bucket).download(key);
      if (error || !data) return null;
      return Buffer.from(await data.arrayBuffer());
    } catch {
      return null;
    }
  }

  try {
    return await fs.readFile(path.join(localDir, key));
  } catch {
    return null;
  }
}

const ensured = new Map<string, Promise<boolean>>();

/**
 * Make sure a private bucket exists. Migrations create the others; this lets a
 * new app's bucket appear on first use instead of failing every upload until
 * someone pastes SQL. A no-op on the file backend.
 */
export function ensureBucket(bucket: string): Promise<boolean> {
  const db = remote();
  if (!db) return Promise.resolve(true);
  let pending = ensured.get(bucket);
  if (!pending) {
    pending = (async () => {
      try {
        const { data } = await db.storage.getBucket(bucket);
        if (data) return true;
        const { error } = await db.storage.createBucket(bucket, { public: false });
        return !error || /already exists/i.test(error.message);
      } catch {
        return false;
      }
    })();
    ensured.set(bucket, pending);
    // A failure is not cached: the next request tries again.
    void pending.then((ok) => ok || ensured.delete(bucket));
  }
  return pending;
}

/**
 * A time-limited read link, for handing a private file to a third party that
 * must download it (a video model). Null on the file backend, where no outside
 * service could reach the file anyway.
 */
export async function signedBlobUrl(bucket: string, key: string, ttlSeconds: number): Promise<string | null> {
  const db = remote();
  if (!db) return null;
  try {
    const { data, error } = await db.storage.from(bucket).createSignedUrl(key, ttlSeconds);
    return error ? null : (data?.signedUrl ?? null);
  } catch {
    return null;
  }
}

/**
 * A one-time upload link, so the browser can send a large file straight to
 * Storage instead of through a function body capped at 4.5 MB.
 */
export async function signedUploadUrl(bucket: string, key: string): Promise<string | null> {
  const db = remote();
  if (!db) return null;
  try {
    const { data, error } = await db.storage.from(bucket).createSignedUploadUrl(key, { upsert: true });
    return error ? null : (data?.signedUrl ?? null);
  } catch {
    return null;
  }
}

/** Remove bytes. Already-gone is the outcome we wanted, so failures are quiet. */
export async function deleteBlob(
  bucket: string,
  key: string,
  localDir: string,
): Promise<void> {
  const db = remote();
  if (db) {
    try {
      await db.storage.from(bucket).remove([key]);
    } catch {
      /* orphan; not worth surfacing */
    }
    return;
  }

  try {
    await fs.unlink(path.join(localDir, key));
  } catch {
    /* already gone */
  }
}
