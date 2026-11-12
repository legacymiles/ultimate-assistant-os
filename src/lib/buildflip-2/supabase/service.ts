import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { SUPABASE_SERVICE, SUPABASE_URL } from "../flags";

let admin: SupabaseClient | null = null;

/**
 * Service-role client. SERVER ONLY — this key bypasses Row Level Security, so
 * every call site must do its own authorisation check first (S1, S3).
 * Used for: public share links (token-checked), the owner admin page
 * (email-checked), and storage signing.
 */
export function supabaseService(): SupabaseClient | null {
  if (!SUPABASE_URL || !SUPABASE_SERVICE) return null;
  if (!admin) {
    admin = createClient(SUPABASE_URL, SUPABASE_SERVICE, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  }
  return admin;
}
