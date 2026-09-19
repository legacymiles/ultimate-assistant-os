import { getSupabaseServerClient } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/supabase/config";

/**
 * Whether this request may spend the owner's AI credit.
 *
 * Friends Night Out is public, so an anonymous visitor must not be able to run
 * the AI sweep or the flyer/link extractor. Local demo mode (no Supabase) has
 * no accounts at all, so it keeps AI.
 */
export async function mayUseAi(): Promise<boolean> {
  if (!isSupabaseConfigured()) return true;
  const sb = await getSupabaseServerClient();
  if (!sb) return true;
  const { data } = await sb.auth.getUser();
  return Boolean(data.user);
}
