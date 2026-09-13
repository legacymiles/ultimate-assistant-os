// ---------------------------------------------------------------------------
// The studio library — one document per signed-in user.
//
// Server-owned rather than localStorage like the wall, because the server is
// what advances a generation: it starts the render, checks on it, and files
// the finished video. Kept in public.server_docs (or a local file) through the
// hub's docStore, named by user id so two accounts never share a library.
// ---------------------------------------------------------------------------

import "server-only";

import { dataDir } from "@/lib/dances/dataDir";
import { readDoc, writeDoc } from "@/lib/server/docStore";
import { getSupabaseServerClient } from "@/lib/supabase/server";

import type { StudioLibrary } from "../types";

/**
 * Who is asking. "local" when the hub runs without Supabase (no sign-in wall
 * at all); null when Supabase is on but nobody is signed in.
 */
export async function currentUid(): Promise<string | null> {
  const sb = await getSupabaseServerClient();
  if (!sb) return "local";
  const { data } = await sb.auth.getUser();
  const id = data.user?.id;
  return id && /^[A-Za-z0-9-]{1,64}$/.test(id) ? id : null;
}

function docName(uid: string): string {
  return `.dance-studio-${uid}.json`;
}

export async function loadLibrary(uid: string): Promise<StudioLibrary> {
  const doc = await readDoc<Partial<StudioLibrary>>(docName(uid), dataDir());
  return {
    dances: Array.isArray(doc?.dances) ? doc.dances : [],
    characters: (Array.isArray(doc?.characters) ? doc.characters : []).map((c) => ({
      ...c,
      extraImageKeys: c.extraImageKeys ?? [],
    })),
    generations: (Array.isArray(doc?.generations) ? doc.generations : []).map((g) => ({
      ...g,
      warnings: g.warnings ?? [],
    })),
  };
}

// One writer at a time per user within an instance. A status check and a new
// character arriving together would otherwise each read the old document and
// the second write would erase the first.
const chains = new Map<string, Promise<unknown>>();

export async function mutateLibrary<T>(
  uid: string,
  fn: (lib: StudioLibrary) => T,
): Promise<{ lib: StudioLibrary; result: T; saved: boolean }> {
  const prev = chains.get(uid) ?? Promise.resolve();
  const run = prev
    .catch(() => undefined)
    .then(async () => {
      const lib = await loadLibrary(uid);
      const result = fn(lib);
      const saved = await writeDoc(docName(uid), dataDir(), lib);
      return { lib, result, saved };
    });
  chains.set(uid, run.catch(() => undefined));
  return run;
}
