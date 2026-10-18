// Who is looking at a review link: their Jarvis account, read from the
// session cookie. "none" when accounts are off (local demo mode), so the app
// still works with no keys set, as every app here must.

import "server-only";

import { isOwner, parseOwnerEmails } from "@/lib/hubAccess";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import type { Viewer } from "./logic";

export async function currentViewer(): Promise<Viewer | null | "none"> {
  const supabase = await getSupabaseServerClient();
  if (!supabase) return "none";
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;
  return {
    id: user.id,
    email: user.email ?? "",
    owner: isOwner(user.email, parseOwnerEmails(process.env.HUB_OWNER_EMAILS)),
  };
}
