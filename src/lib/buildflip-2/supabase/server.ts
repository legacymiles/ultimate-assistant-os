import { getSupabaseServerClient } from "@/lib/supabase/server";

/**
 * Request-scoped Supabase access, over the hub's own client.
 *
 * BuildFlip had its own copy of this; it now borrows the hub's so there is one
 * cookie handler, one set of env names and one session for every app here.
 * Returns null when Supabase is not configured, so callers degrade to demo
 * mode instead of crashing (R4).
 */
export async function supabaseServer() {
  return getSupabaseServerClient();
}

export interface SessionUser {
  id: string;
  email: string;
}

/** The signed-in user, or null. Never throws. */
export async function currentUser(): Promise<SessionUser | null> {
  const sb = await supabaseServer();
  if (!sb) return null;
  try {
    const { data, error } = await sb.auth.getUser();
    if (error || !data.user) return null;
    return { id: data.user.id, email: data.user.email ?? "" };
  } catch {
    return null;
  }
}
