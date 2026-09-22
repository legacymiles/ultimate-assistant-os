"use client";

// One entry point for Cook Connect's data layer.
//
// With Supabase configured it returns a browser client pinned to the `cook`
// schema — the hub already owns `public`, and Pod Play Connect owns `pod`, so
// Cook Connect keeps its own and neither existing app can be disturbed by it.
// Without Supabase it returns the in-browser demo backend, which implements
// the same surface.

import { createBrowserClient } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";
import { SUPABASE_ANON_KEY, SUPABASE_URL, isSupabaseConfigured } from "@/lib/supabase/config";
import { getLocalCookClient } from "./local";

export const COOK_SCHEMA = "cook";

let client: SupabaseClient | null = null;

/** Null when Supabase is not configured. */
export function getSupabaseCookClient(): SupabaseClient | null {
  if (!isSupabaseConfigured()) return null;
  if (!client) {
    client = createBrowserClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      db: { schema: COOK_SCHEMA },
    });
  }
  return client;
}

export interface CookBackend {
  /** Typed loosely on purpose: the two backends agree on shape, not on types. */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  sb: any;
  /** True when running on the in-browser demo backend. */
  isLocal: boolean;
}

export function getCookBackend(): CookBackend {
  const supabase = getSupabaseCookClient();
  return supabase
    ? { sb: supabase, isLocal: false }
    : { sb: getLocalCookClient(), isLocal: true };
}

/**
 * The `cook` schema is new, so a browser pointed at a Supabase project that
 * has not run the migration yet gets a clear answer instead of a blank screen.
 */
export const SCHEMA_MISSING_MESSAGE =
  "Cook Connect's database tables aren't installed yet. Run supabase/migrations/20260922000000_cook_connect.sql "
  + "in the Supabase SQL editor, then add \"cook\" to Settings → Data API → Exposed schemas.";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function isSchemaMissing(error: any): boolean {
  return error?.code === "42P01" || error?.code === "PGRST205" || error?.code === "PGRST106";
}
