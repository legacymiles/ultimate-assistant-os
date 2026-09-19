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
 * Write memories. Rows with an `externalId` are upserted, so re-syncing the
 * master folder updates the notes that changed instead of duplicating them.
 * A missing embedding is not an error — the row still exists and is findable
 * by words.
 */
export async function saveMemories(ctx: MemoryContext, inputs: SaveInput[]): Promise<{ saved: number; embedded: boolean }> {
  if (!inputs.length) return { saved: 0, embedded: false };
  const vectors = await embed(inputs.map((i) => `${i.title}\n\n${i.content}`));

  const rows = inputs.map((i, n) => ({
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
    captured_at: i.capturedAt ?? new Date().toISOString(),
    updated_at: new Date().toISOString(),
  }));

  const withKey = rows.filter((r) => r.external_id !== null);
  const withoutKey = rows.filter((r) => r.external_id === null);

  let saved = 0;
  if (withKey.length) {
    const { data, error } = await ctx.db
      .from("jarvis_memories")
      .upsert(withKey, { onConflict: "user_id,source,external_id" })
      .select("id");
    if (error) throw new Error(error.message);
    saved += data?.length ?? 0;
  }
  if (withoutKey.length) {
    const { data, error } = await ctx.db.from("jarvis_memories").insert(withoutKey).select("id");
    if (error) throw new Error(error.message);
    saved += data?.length ?? 0;
  }
  return { saved, embedded: vectors !== null };
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
    .select("id, source, title, content, origin, captured_at")
    .eq("user_id", ctx.userId)
    .eq("profile_id", ctx.profileId)
    .order("captured_at", { ascending: false })
    .limit(limit);
  if (error) throw new Error(error.message);
  return (data ?? []).map((r: { id: string; source: MemorySource; title: string; content: string; origin: string; captured_at: string }) => ({
    id: r.id,
    source: r.source,
    title: r.title,
    content: r.content,
    origin: r.origin,
    capturedAt: r.captured_at,
  }));
}

export async function deleteMemory(ctx: MemoryContext, id: string): Promise<void> {
  const { error } = await ctx.db.from("jarvis_memories").delete().eq("id", id).eq("user_id", ctx.userId);
  if (error) throw new Error(error.message);
}
