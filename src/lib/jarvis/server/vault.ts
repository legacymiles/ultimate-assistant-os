import "server-only";

// ---------------------------------------------------------------------------
// Mirroring the owner's Obsidian vault into the memory index.
//
// Sibling to masterFolder.ts, and deliberately NOT built on it: that module
// reads the filesystem of the machine the Next server runs on, with node:fs.
// On Vercel there is no vault there. The topology is the other way round —
// browser asks the bridge on 127.0.0.1, bridge reads the disk, browser posts
// what it got up here. So this file never touches a filesystem; it takes a
// manifest and bodies that have already crossed from the owner's PC.
//
// Two tiers, which is the whole design:
//
//   the vault on disk   the durable truth, openable in Obsidian
//   jarvis_memories     a searchable mirror, reachable from a phone
//
// The mirror is explicitly disposable. Everything here can be rebuilt from the
// vault by one sweep, which is why a delete on this side is refused and a
// delete on that side is simply honoured.
// ---------------------------------------------------------------------------

import { parseNote } from "../vault/parse";
import { buildGraph, type VaultEntry } from "../vault/resolve";
import { deleteByKeys, listKeys, saveMemories, type MemoryContext, type SaveInput } from "./memory";

/** One note as the browser uploads it: the manifest entry plus its body. */
export interface UploadedNote {
  path: string;
  hash: string;
  raw: string;
  mtime?: number;
  size?: number;
}

export interface IngestResult {
  saved: number;
  /** Unchanged by hash, so not re-embedded and not rewritten. */
  skipped: number;
  embedded: boolean;
}

/**
 * Write one chunk of notes into the index.
 *
 * Links are resolved WITHIN the chunk plus the keys already in the index, so a
 * note's edges do not depend on which batch it happened to land in. That is
 * why `knownPaths` is taken rather than derived: a 25-note chunk out of two
 * thousand would otherwise resolve almost every link to a ghost.
 */
export async function ingestNotes(
  ctx: MemoryContext,
  notes: UploadedNote[],
  knownPaths: string[] = [],
): Promise<IngestResult> {
  if (!notes.length) return { saved: 0, skipped: 0, embedded: false };

  // Every path the vault is known to contain, so resolution sees the whole
  // vault even while only a slice of it is being written.
  const context: VaultEntry[] = [
    ...notes.map((n) => ({ path: n.path, hash: n.hash, raw: n.raw, mtime: n.mtime, size: n.size })),
    ...knownPaths
      .filter((p) => !notes.some((n) => n.path === p))
      .map((p) => ({ path: p, hash: "" })),
  ];

  const graph = buildGraph(context, { includeGhosts: false });
  const linksByKey = new Map(graph.nodes.map((n) => [n.key, n.links]));

  const inputs: SaveInput[] = notes.map((note) => {
    const parsed = parseNote(note.path, note.raw);
    return {
      source: "vault" as const,
      title: parsed.title,
      content: note.raw,
      origin: note.path,
      tags: parsed.tags,
      externalId: note.path,
      capturedAt: note.mtime ? new Date(note.mtime).toISOString() : undefined,
      meta: {
        hash: note.hash,
        // Resolved targets, not the raw [[names]] — the graph needs keys it can
        // look up, and resolution needs the whole vault to do correctly.
        links: linksByKey.get(note.path) ?? [],
      },
    };
  });

  const { saved, skipped, embedded } = await saveMemories(ctx, inputs);
  return { saved, skipped, embedded };
}

/** Every vault path the index currently holds, with its hash. What a sweep diffs against. */
export async function vaultKeys(ctx: MemoryContext): Promise<{ externalId: string; hash: string; id: string }[]> {
  return listKeys(ctx, "vault");
}

/**
 * Drop rows whose note has left the vault.
 *
 * The guard that decides WHETHER to call this lives in the pure
 * `planSweep` — it is tested there, without a database, because an empty
 * manifest reaching a delete phase would wipe the second brain in one pass.
 * This function does as it is told and nothing more.
 */
export async function forgetNotes(ctx: MemoryContext, keys: string[]): Promise<number> {
  return deleteByKeys(ctx, "vault", keys);
}

/**
 * Remove the master-folder rows the vault has taken over.
 *
 * `~/.claude/projects/*​/memory/*.md` used to be ingested as `master-folder`,
 * and those are exactly the notes that belong in the vault. Running both paths
 * over the same bytes means every note exists twice, `jarvis_search` returns
 * both, and half of a top-eight result is duplicates — a real degradation of
 * the recall this whole feature exists to provide. One owner per byte: the repo
 * files and the skills stay where they are, and this reaps the overlap once.
 */
export async function reapMigratedMasterFolder(ctx: MemoryContext, prefix = "projects/"): Promise<number> {
  const rows = await listKeys(ctx, "master-folder");
  const stale = rows.filter((r) => r.externalId.includes(prefix) && /\/memory\//.test(r.externalId)).map((r) => r.externalId);
  if (!stale.length) return 0;
  return deleteByKeys(ctx, "master-folder", stale);
}
