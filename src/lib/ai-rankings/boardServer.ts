// ---------------------------------------------------------------------------
// AI Rankings — the public board's storage and who may change it.
//
// One server document (public.server_docs on deploy, a file under .data
// locally), read and written only from route code with the service role.
// Visitors read it through GET /api/ai-rankings/board; only the owner writes.
// ---------------------------------------------------------------------------

import "server-only";

import path from "node:path";
import { isOwner, parseOwnerEmails } from "@/lib/hubAccess";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import { readDocStrict, writeDoc } from "@/lib/server/docStore";
import { EMPTY_BOARD } from "./leaderboard";
import type { PublicBoard } from "./leaderboard";
import { SEED_MODELS } from "./seedModels";

const DOC = "ai-rankings-public-board";

function dir(): string {
  return path.join(process.cwd(), ".data", "ai-rankings");
}

/** A first board: the curated seed, so the page is never empty on day one. */
function seeded(): PublicBoard {
  const now = new Date().toISOString();
  return {
    ...EMPTY_BOARD,
    models: SEED_MODELS.map((m) => ({ ...m, addedAt: now, updatedAt: now })),
  };
}

/** Throws when storage can't be read — callers must not save over a failed read. */
export async function readBoard(): Promise<PublicBoard> {
  const doc = await readDocStrict<PublicBoard>(DOC, dir());
  if (!doc) return seeded();
  return {
    version: 1,
    models: Array.isArray(doc.models) ? doc.models : [],
    inbox: Array.isArray(doc.inbox) ? doc.inbox : [],
    dismissed: Array.isArray(doc.dismissed) ? doc.dismissed : [],
    lastSweepAt: doc.lastSweepAt,
    lastSweepNote: doc.lastSweepNote,
  };
}

export async function saveBoard(board: PublicBoard): Promise<boolean> {
  return writeDoc(DOC, dir(), board);
}

/**
 * Whether this request may change the board.
 *
 * With no Supabase configured (a fresh clone, the local preview) there are no
 * accounts at all and the person at the keyboard is the owner — the same rule
 * every other app here follows, so the board works with no keys set.
 */
export async function viewerCanEdit(): Promise<boolean> {
  const supabase = await getSupabaseServerClient();
  if (!supabase) return true;
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return isOwner(user?.email, parseOwnerEmails(process.env.HUB_OWNER_EMAILS));
}
