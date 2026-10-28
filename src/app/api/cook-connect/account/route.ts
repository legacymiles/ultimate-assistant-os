// DELETE /api/cook-connect/account — remove the signed-in person's Cook Connect
// profile and everything hanging off it (cookbooks, recipes, saves, follows,
// messages, journal, groups they made) via the schema's ON DELETE CASCADE.
//
// The hub login itself is NOT deleted: that account is shared with the rest of
// the hub. Opening Cook Connect again starts a brand-new, empty profile.
//
// Row Level Security has no delete policy on cook.profiles on purpose, so this
// runs with the service role — after proving who is asking from their session.

import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { getSupabaseServerClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export async function DELETE() {
  const supabase = await getSupabaseServerClient();
  if (!supabase) {
    return NextResponse.json({ ok: false, error: "Sign-in isn't set up on this site, so there is no account to delete." }, { status: 400 });
  }
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ ok: false, error: "You're signed out. Sign in again, then delete." }, { status: 401 });
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
  if (!url || !key) {
    return NextResponse.json({
      ok: false,
      error: "Deleting accounts needs the site's server key, which isn't set here yet.",
    }, { status: 503 });
  }

  const admin = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
    db: { schema: "cook" },
  });
  const { error } = await admin.from("profiles").delete().eq("id", user.id);
  if (error) {
    return NextResponse.json({ ok: false, error: "The database didn't accept that just now. Try again in a minute." }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
