import type { SupabaseClient } from "@supabase/supabase-js";
import { supabaseServer } from "../supabase/server";
import { supabaseService } from "../supabase/service";

/**
 * The single door to persistence.
 *
 * BuildFlip stores everything in `app_state` — which is the hub's own
 * cross-device table (`src/lib/sync/appState.ts` writes the browser's blobs to
 * it, and `supabase/migrations` created it): a per-user key/value store with a
 * composite primary key `(user_id, key)` and Row Level Security already
 * enforcing "you only see your own rows" (L1, S2, D3). Every BuildFlip key is
 * namespaced `bf:*`, so nothing here can collide with another app's rows.
 *
 * This is the server half of that table, and it stays rather than being folded
 * into `appState.ts`: a plan is read and written by route handlers, listed by
 * key prefix, and — for a share link or the owner's accuracy pool — read
 * through the service role for a user who is not the one asking. None of those
 * are things a browser-side blob loader can do. The client state that IS just a
 * blob (the theme) does go through `appState.ts`.
 *
 * Because all reads and writes funnel through here, graduating to dedicated
 * `bf_*` tables later would be a change to this one file.
 */

export const NS = "bf:";

export const keys = {
  account: () => `${NS}account`,
  project: (id: string) => `${NS}project:${id}`,
  projectPrefix: () => `${NS}project:`,
  /** Idempotency marker. Deliberately NOT under the project prefix: those
   *  rows are listed to build the calibration pool, and request stubs sorted
   *  to the top would starve it. */
  request: (id: string) => `${NS}req:${id}`,
  share: (token: string) => `${NS}share:${token}`,
  sharePrefix: () => `${NS}share:`,
  lead: (hash: string) => `${NS}lead:${hash}`,
  leadPrefix: () => `${NS}lead:`,
  calibration: (buildType: string) => `${NS}calib:${buildType}`,
  rate: (bucket: string) => `${NS}rate:${bucket}`,
  errors: () => `${NS}errors`,
};

export interface Row<T> {
  key: string;
  data: T;
  updatedAt: string;
  userId: string;
}

export interface Store {
  get<T>(key: string): Promise<T | null>;
  set<T>(key: string, data: T): Promise<void>;
  del(key: string): Promise<void>;
  /** All rows whose key starts with `prefix`, newest first. */
  list<T>(prefix: string): Promise<Row<T>[]>;
  /** Delete every BuildFlip row for this user (D4). */
  purge(): Promise<number>;
}

function makeStore(client: SupabaseClient, userId: string): Store {
  return {
    async get<T>(key: string) {
      const { data, error } = await client
        .from("app_state")
        .select("data")
        .eq("user_id", userId)
        .eq("key", key)
        .maybeSingle();
      if (error) throw new Error(`read ${key}: ${error.message}`);
      return (data?.data as T) ?? null;
    },

    async set<T>(key: string, data: T) {
      // Composite PK upsert: writing the same key twice updates, never
      // duplicates — even if the request arrives twice (D5).
      const { error } = await client
        .from("app_state")
        .upsert(
          { user_id: userId, key, data, updated_at: new Date().toISOString() },
          { onConflict: "user_id,key" },
        );
      if (error) throw new Error(`write ${key}: ${error.message}`);
    },

    async del(key: string) {
      const { error } = await client
        .from("app_state")
        .delete()
        .eq("user_id", userId)
        .eq("key", key);
      if (error) throw new Error(`delete ${key}: ${error.message}`);
    },

    async list<T>(prefix: string) {
      const { data, error } = await client
        .from("app_state")
        .select("key, data, updated_at, user_id")
        .eq("user_id", userId)
        .like("key", `${prefix}%`)
        .order("updated_at", { ascending: false });
      if (error) throw new Error(`list ${prefix}: ${error.message}`);
      return (data ?? []).map((r) => ({
        key: r.key as string,
        data: r.data as T,
        updatedAt: r.updated_at as string,
        userId: r.user_id as string,
      }));
    },

    async purge() {
      const { data, error } = await client
        .from("app_state")
        .delete()
        .eq("user_id", userId)
        .like("key", `${NS}%`)
        .select("key");
      if (error) throw new Error(`purge: ${error.message}`);
      return data?.length ?? 0;
    },
  };
}

/** Store scoped to the signed-in user, going through RLS. Null in demo mode. */
export async function userStore(userId: string): Promise<Store | null> {
  const sb = await supabaseServer();
  if (!sb) return null;
  return makeStore(sb, userId);
}

/**
 * Store scoped to a user via the service role — bypasses RLS.
 * Only for share-link reads (token already verified), the owner admin page
 * (email already verified) and server-side calibration pooling.
 */
export function serviceStore(userId: string): Store {
  const sb = supabaseService();
  if (!sb) throw new Error("Service role key is not configured");
  return makeStore(sb, userId);
}

/**
 * Find one row by key across every user. Used only to resolve a share token to
 * its owner; the caller must already have validated the token.
 */
export async function findByKeyAnyUser<T>(key: string): Promise<Row<T> | null> {
  const sb = supabaseService();
  if (!sb) return null;
  const { data, error } = await sb
    .from("app_state")
    .select("key, data, updated_at, user_id")
    .eq("key", key)
    .limit(1)
    .maybeSingle();
  if (error || !data) return null;
  return {
    key: data.key as string,
    data: data.data as T,
    updatedAt: data.updated_at as string,
    userId: data.user_id as string,
  };
}

/** Every row with this key prefix across all users. Admin + calibration only. */
export async function listAllByPrefix<T>(
  prefix: string,
  limit = 1000,
): Promise<Row<T>[]> {
  const sb = supabaseService();
  if (!sb) return [];
  const { data, error } = await sb
    .from("app_state")
    .select("key, data, updated_at, user_id")
    .like("key", `${prefix}%`)
    .order("updated_at", { ascending: false })
    .limit(limit);
  if (error || !data) return [];
  return data.map((r) => ({
    key: r.key as string,
    data: r.data as T,
    updatedAt: r.updated_at as string,
    userId: r.user_id as string,
  }));
}
