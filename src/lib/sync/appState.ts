// ---------------------------------------------------------------------------
// Cross-device sync for the apps that keep their state as one JSON blob.
//
// Nearly every app here already had a load()/save() pair over a single
// localStorage key. That is a good shape — it just stops at the edge of the
// device. This module keeps that shape and adds a second, optional home for
// the same bytes: a row in public.app_state keyed by (user, key).
//
// Design rules, in priority order:
//
//   1. localStorage stays the read path. Reads are synchronous and never wait
//      on the network, so no app gets slower or flashes empty while a fetch is
//      in flight. Offline still works exactly as before.
//   2. Sync is strictly additive. With Supabase unconfigured or nobody signed
//      in, every function here degrades to the old local-only behaviour rather
//      than throwing. The apps must keep working in local demo mode.
//   3. Last write wins, by the server's clock. See the app_state migration for
//      why this is the right guarantee for this workload and where it is not.
//
// What this deliberately does NOT do: merge. If a phone and a laptop both edit
// while offline, the later save replaces the earlier one wholesale. Apps
// needing real concurrent editing get modelled tables, not this.
// ---------------------------------------------------------------------------

import { getSupabaseBrowserClient } from "@/lib/supabase/client";

/** Rows are per-user; this is the table those rows live in. */
const TABLE = "app_state";

/** Read a blob from localStorage. Never throws, never touches the network. */
export function loadLocal<T>(key: string, fallback: T): T {
  if (typeof window === "undefined") return fallback;
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    // Corrupt or half-written value: fall back rather than break the app.
    return fallback;
  }
}

/** Write a blob to localStorage. Never throws (private mode, quota, SSR). */
export function saveLocal<T>(key: string, value: T): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Quota or a storage-blocked browser. The in-memory state is still right,
    // and the remote push below is a second chance at durability.
  }
}

/**
 * The signed-in user's id, or null when sync is unavailable — either because
 * Supabase is not configured at all, or because nobody has logged in yet.
 * Both are ordinary states, not errors.
 */
async function currentUserId(): Promise<string | null> {
  const supabase = getSupabaseBrowserClient();
  if (!supabase) return null;
  try {
    const { data, error } = await supabase.auth.getUser();
    if (error) return null;
    return data.user?.id ?? null;
  } catch {
    return null;
  }
}

/** True when a remote copy could be read or written right now. */
export async function syncAvailable(): Promise<boolean> {
  return (await currentUserId()) !== null;
}

/**
 * Push the local blob to the user's row. Fire-and-forget by design: a failed
 * sync must never lose the user's edit, which localStorage already holds.
 * Returns whether the write actually landed, for callers that want to show it.
 */
export async function pushRemote<T>(key: string, value: T): Promise<boolean> {
  const supabase = getSupabaseBrowserClient();
  const userId = await currentUserId();
  if (!supabase || !userId) return false;
  try {
    const { error } = await supabase
      .from(TABLE)
      .upsert(
        { user_id: userId, key, data: value as unknown as object },
        { onConflict: "user_id,key" },
      );
    return !error;
  } catch {
    return false;
  }
}

/** The remote blob and when it was last written, or null when unavailable. */
export async function pullRemote<T>(
  key: string,
): Promise<{ data: T; updatedAt: string } | null> {
  const supabase = getSupabaseBrowserClient();
  const userId = await currentUserId();
  if (!supabase || !userId) return null;
  try {
    const { data, error } = await supabase
      .from(TABLE)
      .select("data, updated_at")
      .eq("user_id", userId)
      .eq("key", key)
      .maybeSingle();
    if (error || !data) return null;
    return { data: data.data as T, updatedAt: data.updated_at as string };
  } catch {
    return null;
  }
}

/**
 * Settle this device against the server once, leaving the winning blob in
 * localStorage so the app's own synchronous loader picks it up.
 *
 * Takes no fallback on purpose. An earlier version accepted one and seeded the
 * remote row with it when both sides were empty, which meant a caller passing
 * the obvious `[]` or `{}` could overwrite real data with a placeholder in the
 * window before its store had loaded. Absent stays absent here instead.
 */
export async function reconcile(key: string): Promise<void> {
  if (typeof window === "undefined") return;

  const rawLocal = (() => {
    try {
      return window.localStorage.getItem(key);
    } catch {
      return null;
    }
  })();

  const remote = await pullRemote<unknown>(key);

  // Nothing on the server yet: this device seeds it, but only if it actually
  // holds something. Seeding with nothing would just write an empty row.
  if (!remote) {
    if (rawLocal !== null) {
      try {
        void pushRemote(key, JSON.parse(rawLocal));
      } catch {
        /* unparseable local value — nothing worth uploading */
      }
    }
    return;
  }

  // Remote exists, nothing local: first run on a new device.
  if (rawLocal === null) {
    saveLocal(key, remote.data);
    return;
  }

  // Both exist. updated_at is stamped by the server, so it is the one clock
  // both devices agree on; a local edit recorded after it is genuinely newer.
  const localStamp = loadLocalStamp(key);
  if (localStamp !== null && localStamp > Date.parse(remote.updatedAt)) {
    try {
      void pushRemote(key, JSON.parse(rawLocal));
    } catch {
      /* keep the server's copy if ours will not parse */
    }
    return;
  }

  saveLocal(key, remote.data);
}

// --- local write stamps ----------------------------------------------------
// reconcile() needs to know whether this device edited after the server's last
// stamp. localStorage itself records no write time, so we keep one alongside.

const STAMP_SUFFIX = ":__synced_at";

/** Record that this device just wrote `key`. Call from an app's save path. */
export function stampLocal(key: string): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(key + STAMP_SUFFIX, String(Date.now()));
  } catch {
    /* storage blocked — reconcile falls back to preferring the remote copy */
  }
}

function loadLocalStamp(key: string): number | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(key + STAMP_SUFFIX);
    if (!raw) return null;
    const n = Number(raw);
    return Number.isFinite(n) ? n : null;
  } catch {
    return null;
  }
}

/**
 * The call an app's store should use in place of localStorage.setItem: writes
 * locally, records the write time so reconcile() can compare, and pushes.
 */
export function saveSynced<T>(key: string, value: T): void {
  saveLocal(key, value);
  stampLocal(key);
  void pushRemote(key, value);
}
