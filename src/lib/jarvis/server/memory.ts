import "server-only";

// ---------------------------------------------------------------------------
// Jarvis's memory, server side.
//
// Reads and writes go through the SIGNED-IN USER's Supabase client, never the
// service role: RLS is then the thing that guarantees one person's memories
// cannot reach another's, rather than correctness of this file. When Supabase
// is not configured, or nobody is signed in, every function reports
// `available: false` and the app falls back to on-device word search.
// ---------------------------------------------------------------------------

import { getSupabaseServerClient } from "@/lib/supabase/server";
import { rrf } from "../rank";
import type { MemorySource } from "../types";
import { embed, embedOne } from "./embed";

export interface RemoteMemory {
  id: string;
  source: MemorySource;
  title: string;
  content: string;
  origin: string;
  capturedAt: string;
  /**
   * The stable key this row mirrors — a vault-relative path, a file path, a
   * message id. Selected because the knowledge graph is keyed by vault path,
   * not by row id: without it there is no way to tell which note a row is.
   */
  externalId?: string | null;
  /**
   * Derived extras. `hash` is what lets a sweep skip an unchanged file,
   * `links` carries the resolved wikilink targets that become graph edges, and
   * `pending` marks a note captured away from the PC and not yet on disk.
   */
  meta?: Record<string, unknown> | null;
  tags?: string[];
}

export interface MemoryContext {
  available: true;
  userId: string;
  profileId: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Supabase's generated client type is not wired up in this repo.
  db: any;
}

export type MaybeContext = MemoryContext | { available: false; reason: string };

/** Who is asking, and whether the database is reachable at all. */
export async function memoryContext(profileId = "owner"): Promise<MaybeContext> {
  const db = await getSupabaseServerClient();
  if (!db) return { available: false, reason: "Supabase is not configured on this deployment." };
  const { data } = await db.auth.getUser();
  const userId = data?.user?.id;
  if (!userId) return { available: false, reason: "Nobody is signed in on this device." };
  return { available: true, userId, profileId, db };
}

export interface SaveInput {
  source: MemorySource;
  title: string;
  content: string;
  origin?: string;
  tags?: string[];
  capturedAt?: string;
  /** Stable key for re-syncable things (a file path, a message id). */
  externalId?: string;
  meta?: Record<string, unknown>;
}

/**
 * Write memories. Rows with an `externalId` replace the row that already
 * carries it, so re-syncing the master folder updates the notes that changed
 * instead of duplicating them. A missing embedding is not an error — the row
 * still exists and is findable by words.
 *
 * ## The hash gate
 *
 * A keyed input carrying `meta.hash` is compared against the hash already
 * stored, and an unchanged row is skipped entirely — not re-embedded, not
 * rewritten. Without this, every sync re-embeds every file: invisible at the
 * couple of hundred files the master folder holds, and the difference between
 * viable and impossible once a vault of a few thousand notes points at it.
 *
 * ## Why one upsert and not a lookup plus a write per row
 *
 * It used to be a lookup followed by `await update()` per existing row — up to
 * twenty serialized round trips per batch, inside a route with a 300-second
 * ceiling. The reason was real but is now historical: the unique index on
 * (user_id, source, external_id) was PARTIAL (`where external_id is not null`)
 * and Postgres refuses to infer a partial index for ON CONFLICT unless the
 * statement repeats its predicate, which PostgREST cannot send. Every upsert
 * failed with 42P10 and that is why the Memory tab sat empty next to a hundred
 * skills on disk. `supabase/migrations/20260925…` made the index total
 * specifically so this could become one statement, and now it is. Rows with a
 * null `external_id` never conflict — NULLs are distinct in a unique index — so
 * the same statement handles both halves.
 */
export async function saveMemories(
  ctx: MemoryContext,
  inputs: SaveInput[],
): Promise<{ saved: number; skipped: number; embedded: boolean }> {
  if (!inputs.length) return { saved: 0, skipped: 0, embedded: false };

  const keyed = inputs.filter((i) => i.externalId);
  let unchanged = new Set<string>();

  if (keyed.length) {
    // Scoped by source as well as key. Without it this over-fetches rows from
    // other sources that happen to share a path — harmless, but it is the
    // lookup a vault and the master folder would collide in.
    const sources = [...new Set(keyed.map((i) => i.source))];
    const { data: found, error } = await ctx.db
      .from("jarvis_memories")
      .select("source,external_id,meta")
      .eq("user_id", ctx.userId)
      .eq("profile_id", ctx.profileId)
      .in("source", sources)
      .in("external_id", keyed.map((i) => i.externalId as string));
    if (error) throw new Error(error.message);

    const hashes = new Map<string, string>();
    for (const row of (found ?? []) as { source: string; external_id: string; meta: Record<string, unknown> | null }[]) {
      const hash = typeof row.meta?.hash === "string" ? row.meta.hash : "";
      if (hash) hashes.set(`${row.source}\u0000${row.external_id}`, hash);
    }

    unchanged = new Set(
      keyed
        .filter((i) => {
          const hash = typeof i.meta?.hash === "string" ? i.meta.hash : "";
          return hash && hashes.get(`${i.source}\u0000${i.externalId}`) === hash;
        })
        .map((i) => `${i.source}\u0000${i.externalId}`),
    );
  }

  const todo = inputs.filter((i) => !i.externalId || !unchanged.has(`${i.source}\u0000${i.externalId}`));
  const skipped = inputs.length - todo.length;
  if (!todo.length) return { saved: 0, skipped, embedded: false };

  // Embedding happens AFTER the gate, so an unchanged file costs nothing.
  const vectors = await embed(todo.map((i) => `${i.title}\n\n${i.content}`));
  const now = new Date().toISOString();

  const rows = todo.map((i, n) => ({
    user_id: ctx.userId,
    profile_id: ctx.profileId,
    source: i.source,
    title: i.title.slice(0, 300),
    content: i.content,
    origin: i.origin ?? "you",
    tags: i.tags ?? [],
    meta: i.meta ?? {},
    external_id: i.externalId ?? null,
    embedding: vectors?.[n] ?? null,
    captured_at: i.capturedAt ?? now,
    updated_at: now,
  }));

  const { data, error } = await ctx.db
    .from("jarvis_memories")
    .upsert(rows, { onConflict: "user_id,source,external_id" })
    .select("id");
  if (error) throw new Error(error.message);

  return { saved: data?.length ?? rows.length, skipped, embedded: vectors !== null };
}

export interface SearchResult {
  hits: RemoteMemory[];
  /** True when the meaning search actually ran (a key was set and vectors exist). */
  semantic: boolean;
}

/**
 * Hybrid search: meaning and words, fused by rank. The fusion lives in
 * `rank.ts` so it is the same rule the on-device fallback uses and is unit
 * tested without a database.
 */
export async function searchMemory(
  ctx: MemoryContext,
  query: string,
  k = 8,
  sources?: MemorySource[],
): Promise<SearchResult> {
  const vector = query.trim() ? await embedOne(query) : null;
  const { data, error } = await ctx.db.rpc("jarvis_search", {
    p_user: ctx.userId,
    p_profile: ctx.profileId,
    p_embedding: vector,
    p_query: query,
    p_k: Math.max(k, 10),
    p_sources: sources ?? null,
  });
  if (error) throw new Error(error.message);

  type Row = {
    id: string;
    source: MemorySource;
    title: string;
    content: string;
    origin: string;
    captured_at: string;
    vector_rank: number;
    word_rank: number;
  };
  const rows: Row[] = data ?? [];
  const byVector = rows
    .filter((r) => r.vector_rank > 0)
    .sort((a, b) => a.vector_rank - b.vector_rank)
    .map((r) => r.id);
  const byWords = rows
    .filter((r) => r.word_rank > 0)
    .sort((a, b) => a.word_rank - b.word_rank)
    .map((r) => r.id);

  const index = new Map(rows.map((r) => [r.id, r]));
  const hits = rrf([byVector, byWords])
    .slice(0, k)
    .map(({ id }) => index.get(id))
    .filter((r): r is Row => Boolean(r))
    .map((r) => ({
      id: r.id,
      source: r.source,
      title: r.title,
      content: r.content,
      origin: r.origin,
      capturedAt: r.captured_at,
    }));

  return { hits, semantic: vector !== null && byVector.length > 0 };
}

/** Everything, newest first, for the ball and the memory list. */
export async function listMemories(ctx: MemoryContext, limit = 2000): Promise<RemoteMemory[]> {
  const { data, error } = await ctx.db
    .from("jarvis_memories")
    // external_id and meta are selected because the knowledge graph is keyed by
    // vault path and draws its edges from meta.links. Without them a listed row
    // cannot be matched to a note, and every node is an island.
    .select("id, source, title, content, origin, captured_at, external_id, meta, tags")
    .eq("user_id", ctx.userId)
    .eq("profile_id", ctx.profileId)
    .order("captured_at", { ascending: false })
    .limit(limit);
  if (error) throw new Error(error.message);
  return (data ?? []).map(
    (r: {
      id: string;
      source: MemorySource;
      title: string;
      content: string;
      origin: string;
      captured_at: string;
      external_id: string | null;
      meta: Record<string, unknown> | null;
      tags: string[] | null;
    }) => ({
      id: r.id,
      source: r.source,
      title: r.title,
      content: r.content,
      origin: r.origin,
      capturedAt: r.captured_at,
      externalId: r.external_id,
      meta: r.meta,
      tags: r.tags ?? [],
    }),
  );
}

/** Just the key and hash of every row for one source — what a sweep diffs against. */
export async function listKeys(ctx: MemoryContext, source: MemorySource): Promise<{ externalId: string; hash: string; id: string }[]> {
  const { data, error } = await ctx.db
    .from("jarvis_memories")
    .select("id, external_id, meta")
    .eq("user_id", ctx.userId)
    .eq("profile_id", ctx.profileId)
    .eq("source", source)
    .not("external_id", "is", null);
  if (error) throw new Error(error.message);
  return (data ?? [])
    .filter((r: { external_id: string | null }) => r.external_id)
    .map((r: { id: string; external_id: string; meta: Record<string, unknown> | null }) => ({
      id: r.id,
      externalId: r.external_id,
      hash: typeof r.meta?.hash === "string" ? r.meta.hash : "",
    }));
}

/** Delete rows by their external key, for the reconciling half of a sweep. */
export async function deleteByKeys(ctx: MemoryContext, source: MemorySource, keys: string[]): Promise<number> {
  if (!keys.length) return 0;
  const { data, error } = await ctx.db
    .from("jarvis_memories")
    .delete()
    .eq("user_id", ctx.userId)
    .eq("profile_id", ctx.profileId)
    .eq("source", source)
    .in("external_id", keys)
    .select("id");
  if (error) throw new Error(error.message);
  return data?.length ?? 0;
}

/** What source a row belongs to, so the delete route can refuse to delete a mirror of a real file. */
export async function sourceOf(ctx: MemoryContext, id: string): Promise<MemorySource | null> {
  const { data, error } = await ctx.db
    .from("jarvis_memories")
    .select("source")
    .eq("id", id)
    .eq("user_id", ctx.userId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return (data?.source as MemorySource | undefined) ?? null;
}

export async function deleteMemory(ctx: MemoryContext, id: string): Promise<void> {
  const { error } = await ctx.db.from("jarvis_memories").delete().eq("id", id).eq("user_id", ctx.userId);
  if (error) throw new Error(error.message);
}
