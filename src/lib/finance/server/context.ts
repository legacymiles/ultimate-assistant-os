import "server-only";

// ---------------------------------------------------------------------------
// Personal Finance, server side — who is asking.
//
// Every read and write goes through the SIGNED-IN USER's Supabase client, never
// the service role. RLS is then the thing guaranteeing one person's bank
// transactions cannot reach another's, rather than the correctness of this
// file. The service-role key would bypass exactly the protection this data
// most needs, so it does not appear anywhere in this feature.
//
// When Supabase is unconfigured or nobody is signed in, every entry point
// reports `available: false` with a reason the UI shows, and the folder falls
// back to what it can do without a server. A missing key degrades visibly.
// ---------------------------------------------------------------------------

import { getSupabaseServerClient } from "@/lib/supabase/server";

export interface FinanceContext {
  available: true;
  userId: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Supabase's generated client type is not wired up in this repo.
  db: any;
}

export type MaybeFinanceContext = FinanceContext | { available: false; reason: string };

export async function financeContext(): Promise<MaybeFinanceContext> {
  const db = await getSupabaseServerClient();
  if (!db) return { available: false, reason: "Supabase is not configured on this deployment." };
  const { data } = await db.auth.getUser();
  const userId = data?.user?.id;
  if (!userId) return { available: false, reason: "Nobody is signed in on this device." };
  return { available: true, userId, db };
}
