// ---------------------------------------------------------------------------
// The 24/7 Queue's database handle — the service-role client.
//
// Used by the API routes (after their own sign-in checks) and by the VPS
// worker, which is bundled from this same code (tools/queue-worker). It does
// not import "server-only" so the worker bundle can include it; it must still
// never be imported from a client component — the key bypasses RLS.
// ---------------------------------------------------------------------------

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

let cached: SupabaseClient | null = null;

export function queueDbConfigured(): boolean {
  return Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY);
}

export const NO_DB_MESSAGE =
  "The 24/7 Queue keeps every task in the database so it survives restarts. This deployment has no SUPABASE_SERVICE_ROLE_KEY, so nothing can be queued here yet.";

export function queueDb(): SupabaseClient {
  if (cached) return cached;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error(NO_DB_MESSAGE);
  cached = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  return cached;
}
