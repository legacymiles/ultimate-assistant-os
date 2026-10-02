// ---------------------------------------------------------------------------
// Turning a pile of parsed notes into a graph.
//
// A `[[wikilink]]` names a note, not a path, so every link has to be resolved
// against the whole vault before it can become an edge. Obsidian's own rule,
// which this module copies so the hub's graph and Obsidian's graph agree:
//
//   1. an exact path match (`[[notes/Ideas.md]]` or `[[notes/Ideas]]`)
//   2. a unique basename (`[[Ideas]]` when exactly one `Ideas.md` exists)
//   3. the copy in the linking note's own folder, when several exist
//   4. otherwise the shortest path — and the ambiguity is RECORDED, not hidden,
//      because silently picking one of three notes called "Notes" is the kind
//      of thing that makes a second brain quietly wrong.
//
// A link that resolves to nothing becomes a GHOST node. That is deliberate and
// it is the most valuable thing in here: "I have referred to this four times
// and never written it" is a real finding, and Obsidian draws it too.
// ---------------------------------------------------------------------------

import type { GraphEdge, VaultGraph, VaultNode } from "@/lib/jarvis/graph/types";
import type { MemorySource } from "@/lib/jarvis/types";
import { dirname, noteName, normalizePath, parseNote, pathKey, stripExtension, type ParsedNote } from "./parse";

/** One note as the sweep knows it, before any resolution. */
export interface VaultEntry {
  /** Vault-relative, already normalised by `normalizePath`. */
  path: string;
  /** The file's content hash, computed by whoever read the bytes. */
  hash: string;
  /** Epoch millis. Used for `strength` only. */
  mtime?: number;
  size?: number;
  /** Present once the body has been read. A manifest entry has no body. */
  raw?: string;
  /** The row in `jarvis_memories` mirroring this file, when there is one. */
  memoryId?: string;
  /** Captured but not yet written to disk — a phone note waiting for the bridge. */
  pending?: boolean;
}

/** Key prefixes, so a node key can never collide with a real path. */
export const GHOST_PREFIX = "ghost:";
export const TAG_PREFIX = "tag:";

export function ghostKey(name: string): string {
  return `${GHOST_PREFIX}${name.toLowerCase()}`;
}

export function tagKey(tag: string): string {
  return `${TAG_PREFIX}${tag.toLowerCase()}`;
}

/**
 * Collapse a manifest to one entry per real file.
 *
 * This is load-bearing rather than tidy. `external_id` is a unique key, so a
 * manifest carrying both `Notes\A.md` and `Notes/A.md` makes a single batched
 * insert violate the index and take the whole sweep down with it — and a
 * recursive scanner on Windows produces exactly that pairing without trying.
 * The later entry wins, because a scanner that emitted a path twice usually
 * emitted the better-cased one second.
 */
export function dedupeManifest(entries: VaultEntry[]): { entries: VaultEntry[]; dropped: string[] } {
  const byKey = new Map<string, VaultEntry>();
  const dropped: string[] = [];
  for (const entry of entries) {
    const path = normalizePath(entry.path);
    if (!path) continue;
    const key = pathKey(path);
    if (byKey.has(key)) dropped.push(path);
    byKey.set(key, { ...entry, path });
  }
  return { entries: [...byKey.values()], dropped };
}

/** 0..1, where longer and newer reads brighter. Mirrors memoryClient's formula so the two graphs look alike. */
export function strengthOf(entry: { raw?: string; size?: number; mtime?: number }, now: number): number {
  const length = entry.raw?.length ?? entry.size ?? 0;
  const age = entry.mtime ? Math.max(0, now - entry.mtime) / 86_400_000 : 90;
  const recency = Math.pow(0.5, age / 90); // ~90-day half-life, as elsewhere in the hub
  return Math.min(1, 0.35 + Math.min(length, 800) / 1600 + recency * 0.3);
}

interface Candidate {
  path: string;
  key: string;
}

/**
 * The name→path index.
 *
 * Built once per sweep rather than per link, because a 2000-note vault with
 * 10 links each would otherwise be 20,000 scans of the whole manifest.
 */
function buildIndex(paths: string[]): {
  byPath: Map<string, string>;
  byName: Map<string, Candidate[]>;
} {
  const byPath = new Map<string, string>();
  const byName = new Map<string, Candidate[]>();
  for (const path of paths) {
    byPath.set(pathKey(path), path);
    // Also index the path without its extension, so `[[notes/Ideas]]` hits.
    byPath.set(pathKey(stripExtension(path)), path);
    const name = noteName(path).toLowerCase();
    const list = byName.get(name) ?? [];
    list.push({ path, key: pathKey(path) });
    byName.set(name, list);
  }
  return { byPath, byName };
}

export interface Resolution {
  path: string | null;
  among?: string[];
}

/** Resolve one link target against the index, from the folder the link was written in. */
function resolveOne(
  target: string,
  fromDir: string,
  index: { byPath: Map<string, string>; byName: Map<string, Candidate[]> },
): Resolution {
  const cleaned = normalizePath(target.replace(/^\.\//, ""));
  if (!cleaned) return { path: null };

  // 1. An exact path, with or without the extension.
  const exact = index.byPath.get(pathKey(cleaned)) ?? index.byPath.get(pathKey(stripExtension(cleaned)));
  if (exact) return { path: exact };

  // A relative markdown link resolves against the linking note's folder.
  if (fromDir) {
    const joined = normalizePath(`${fromDir}/${cleaned}`);
    const relative = index.byPath.get(pathKey(joined)) ?? index.byPath.get(pathKey(stripExtension(joined)));
    if (relative) return { path: relative };
  }

  // 2. A unique basename.
  const name = stripExtension(cleaned.includes("/") ? cleaned.slice(cleaned.lastIndexOf("/") + 1) : cleaned).toLowerCase();
  const matches = index.byName.get(name);
  if (!matches || !matches.length) return { path: null };
  if (matches.length === 1) return { path: matches[0].path };

  // 3. Prefer the one in the linking note's own folder.
  const sameFolder = matches.filter((c) => dirname(c.path).toLowerCase() === fromDir.toLowerCase());
  if (sameFolder.length === 1) return { path: sameFolder[0].path, among: matches.map((c) => c.path) };

  // 4. Shortest path, ties broken alphabetically so the choice is stable across sweeps.
  const sorted = [...matches].sort((a, b) => a.path.length - b.path.length || a.path.localeCompare(b.path));
  return { path: sorted[0].path, among: matches.map((c) => c.path) };
}

export interface BuildOptions {
  /** Draw a node per `#tag`, as Obsidian can. Off by default — tags multiply fast. */
  includeTags?: boolean;
  /** Draw ghosts for links that resolve to nothing. On by default; it is the point. */
  includeGhosts?: boolean;
  now?: number;
}

/**
 * Build the graph.
 *
 * Entries without a `raw` body still become nodes — they are real files, they
 * are just not parsed yet — they simply contribute no edges. That matters
 * because the first paint happens off the manifest, before any bodies have
 * been read, and a graph that appears empty until every note downloads looks
 * broken rather than loading.
 */
export function buildGraph(entries: VaultEntry[], options: BuildOptions = {}): VaultGraph {
  const { includeTags = false, includeGhosts = true, now = Date.now() } = options;
  const { entries: unique } = dedupeManifest(entries);
  const index = buildIndex(unique.map((e) => e.path));

  const nodes = new Map<string, VaultNode>();
  const ambiguous: VaultGraph["ambiguous"] = [];
  const edgeSet = new Map<string, GraphEdge>();
  /** How many real notes point at each ghost — a ghost's strength is its demand. */
  const ghostDemand = new Map<string, number>();
  const ghostTitle = new Map<string, string>();

  const parsed = new Map<string, ParsedNote>();
  for (const entry of unique) {
    const key = normalizePath(entry.path);
    const note = entry.raw !== undefined ? parseNote(key, entry.raw) : null;
    if (note) parsed.set(key, note);
    nodes.set(key, {
      key,
      kind: "note",
      ...(entry.memoryId ? { memoryId: entry.memoryId } : {}),
      source: "vault" as MemorySource,
      title: note?.title ?? noteName(key) ?? "Untitled",
      strength: strengthOf(entry, now),
      links: [],
      tags: note?.tags ?? [],
      path: key,
    });
  }

  const addEdge = (a: string, b: string, embed: boolean) => {
    if (a === b) return; // a note linking itself is not an edge
    const [x, y] = a < b ? [a, b] : [b, a];
    const id = `${x}\u0000${y}`;
    const existing = edgeSet.get(id);
    if (existing) {
      // An embed anywhere in the pair makes the pair an embed.
      if (embed) existing.embed = true;
      return;
    }
    edgeSet.set(id, { a: x, b: y, embed });
  };

  for (const [path, note] of parsed) {
    const node = nodes.get(path);
    if (!node) continue;
    const fromDir = dirname(path);
    const out = new Set<string>();

    for (const link of note.links) {
      const { path: hit, among } = resolveOne(link.target, fromDir, index);
      if (hit) {
        if (among) ambiguous.push({ from: path, target: link.target, chose: hit, among });
        if (hit === path) continue;
        out.add(hit);
        addEdge(path, hit, link.kind === "embed");
        continue;
      }
      if (!includeGhosts) continue;
      // Nothing on disk answers this name. Obsidian would draw a ghost here,
      // and so do we — keyed by name, so four notes referring to the same
      // unwritten idea converge on one node rather than four.
      const bare = stripExtension(link.target.includes("/") ? link.target.slice(link.target.lastIndexOf("/") + 1) : link.target);
      if (!bare) continue;
      const gkey = ghostKey(bare);
      ghostDemand.set(gkey, (ghostDemand.get(gkey) ?? 0) + 1);
      if (!ghostTitle.has(gkey)) ghostTitle.set(gkey, bare);
      out.add(gkey);
      addEdge(path, gkey, false);
    }

    if (includeTags) {
      for (const tag of note.tags) {
        const tkey = tagKey(tag);
        if (!nodes.has(tkey)) {
          nodes.set(tkey, {
            key: tkey,
            kind: "tag",
            source: "vault" as MemorySource,
            title: `#${tag}`,
            strength: 0.3,
            links: [],
            tags: [],
          });
        }
        out.add(tkey);
        addEdge(path, tkey, false);
      }
    }

    node.links = [...out];
  }

  for (const [gkey, demand] of ghostDemand) {
    nodes.set(gkey, {
      key: gkey,
      kind: "ghost",
      source: "vault" as MemorySource,
      title: ghostTitle.get(gkey) ?? gkey.slice(GHOST_PREFIX.length),
      // A ghost referred to once is a typo; one referred to five times is a
      // note the owner owes themselves. Brightness says which.
      strength: Math.min(0.9, 0.2 + demand * 0.14),
      links: [],
      tags: [],
    });
  }

  // Tags and ghosts get their back-edges filled in, so the inspector can show
  // "what points at this" without walking every node.
  for (const edge of edgeSet.values()) {
    for (const [self, other] of [
      [edge.a, edge.b],
      [edge.b, edge.a],
    ] as const) {
      const node = nodes.get(self);
      if (node && node.kind !== "note" && !node.links.includes(other)) node.links.push(other);
    }
  }

  return {
    nodes: [...nodes.values()],
    edges: [...edgeSet.values()],
    ambiguous,
  };
}

/** Which notes point AT a node. Derived rather than stored, so it cannot go stale. */
export function backlinks(graph: VaultGraph, key: string): string[] {
  const out: string[] = [];
  for (const node of graph.nodes) {
    if (node.key !== key && node.kind === "note" && node.links.includes(key)) out.push(node.key);
  }
  return out;
}

/**
 * Ghosts worth writing — referred to at least `min` times and still absent.
 *
 * This is a self-improvement auditor's input, not decoration: it is the graph
 * telling the owner which note they keep needing and have never written.
 */
export function owedNotes(graph: VaultGraph, min = 2): { title: string; key: string; referrers: number }[] {
  return graph.nodes
    .filter((n) => n.kind === "ghost")
    .map((n) => ({ title: n.title, key: n.key, referrers: backlinks(graph, n.key).length }))
    .filter((g) => g.referrers >= min)
    .sort((a, b) => b.referrers - a.referrers || a.title.localeCompare(b.title));
}

/** Nodes with no edges at all — real notes nothing links to and which link to nothing. */
export function orphans(graph: VaultGraph): VaultNode[] {
  const touched = new Set<string>();
  for (const edge of graph.edges) {
    touched.add(edge.a);
    touched.add(edge.b);
  }
  return graph.nodes.filter((n) => n.kind === "note" && !touched.has(n.key));
}
