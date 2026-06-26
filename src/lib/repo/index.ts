import { getSupabaseBrowserClient } from "../supabase/client";
import { LocalRepo } from "./local";
import { SupabaseRepo } from "./supabase";
import type { Repo } from "./types";

let cached: Repo | null = null;

/** Returns the active repository: Supabase when configured, else localStorage. */
export function getRepo(): Repo {
  if (cached) return cached;
  const db = getSupabaseBrowserClient();
  cached = db ? new SupabaseRepo(db) : new LocalRepo();
  return cached;
}

export type { Repo } from "./types";
