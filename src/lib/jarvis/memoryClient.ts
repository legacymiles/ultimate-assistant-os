// ---------------------------------------------------------------------------
// The only module the Jarvis UI talks to about memory.
//
// Today it searches the local store with word overlap. In Stage 2 the same
// functions gain a remote path (Supabase pgvector + hybrid search) and fall
// back to this one when Supabase or the AI key is missing. Keeping the UI
// behind this seam is what makes that swap a one-file change.
// ---------------------------------------------------------------------------

import { keywordScore, recency, rrf } from "./rank";
import { uid } from "./store";
import type { JarvisStore, Memory, MemorySource } from "./types";

export interface SearchHit {
  memory: Memory;
  score: number;
}

/**
 * Rank memories for a question. Muted sources are excluded — the Memory tab's
 * toggles are a real filter, not a display trick.
 */
export function searchMemories(store: JarvisStore, query: string, k = 8, now = Date.now()): SearchHit[] {
  const pool = store.memories.filter((m) => !store.mutedSources.includes(m.source));
  if (!query.trim()) {
    return [...pool]
      .sort((a, b) => b.capturedAt.localeCompare(a.capturedAt))
      .slice(0, k)
      .map((memory) => ({ memory, score: 0 }));
  }
  const scored = pool
    .map((m) => ({ m, s: keywordScore(query, m) }))
    .filter((x) => x.s > 0);
  if (!scored.length) return [];

  // Two orders — best word match, and freshest of the ones that matched at all
  // — fused the same way the server will fuse word and meaning search.
  const byWords = [...scored].sort((a, b) => b.s - a.s).map((x) => x.m.id);
  const byFresh = [...scored]
    .sort((a, b) => recency(b.m.capturedAt, now) - recency(a.m.capturedAt, now))
    .map((x) => x.m.id);
  const byId = new Map(pool.map((m) => [m.id, m]));
  return rrf([byWords, byFresh])
    .slice(0, k)
    .map(({ id, score }) => ({ memory: byId.get(id)!, score }))
    .filter((h) => h.memory);
}

export interface NewMemory {
  source: MemorySource;
  title: string;
  content: string;
  origin?: string;
  tags?: string[];
  capturedAt?: string;
}

/** Build a memory. Titles fall back to the first line so nothing is untitled. */
export function makeMemory(input: NewMemory): Memory {
  const firstLine = input.content.trim().split("\n")[0] ?? "";
  return {
    id: uid(),
    source: input.source,
    title: input.title.trim() || firstLine.slice(0, 60) || "Untitled",
    content: input.content.trim(),
    capturedAt: input.capturedAt || new Date().toISOString(),
    tags: input.tags ?? [],
    origin: input.origin ?? "you",
    links: [],
  };
}

/** Add a memory, newest first, refusing an exact duplicate of the same source. */
export function addMemory(store: JarvisStore, input: NewMemory): JarvisStore {
  const memory = makeMemory(input);
  const duplicate = store.memories.some(
    (m) => m.source === memory.source && m.content === memory.content && m.title === memory.title,
  );
  if (duplicate) return store;
  return { ...store, memories: [memory, ...store.memories] };
}

export interface GraphNode {
  id: string;
  source: MemorySource;
  title: string;
  /** 0–1: how much this memory should stand out. Longer and newer = brighter. */
  strength: number;
  links: string[];
}

/**
 * The sample of memories the sphere draws. Capped because a few hundred
 * thousand points is a slideshow, and the newest are the ones worth seeing.
 */
export function graphNodes(store: JarvisStore, cap = 2000, now = Date.now()): GraphNode[] {
  return store.memories
    .filter((m) => !store.mutedSources.includes(m.source))
    .slice(0, cap)
    .map((m) => ({
      id: m.id,
      source: m.source,
      title: m.title,
      strength: Math.min(1, 0.35 + Math.min(m.content.length, 800) / 1600 + recency(m.capturedAt, now) * 0.3),
      links: m.links,
    }));
}

/** How many links the sphere will draw for a node set (for the HUD count). */
export function linkCount(nodes: GraphNode[]): number {
  const ids = new Set(nodes.map((n) => n.id));
  return nodes.reduce((n, node) => n + node.links.filter((l) => ids.has(l)).length, 0);
}
