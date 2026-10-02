// ---------------------------------------------------------------------------
// Planning one sweep of the vault.
//
// The existing memory sync only ever upserts, which is why deleting a source
// file leaves its mirror row to be cited as current forever, and renaming one
// leaves two identical rows. That is survivable at a couple of hundred files
// and it is not survivable at vault scale, where renaming notes is routine.
//
// So a sweep RECONCILES: paths whose hash changed get re-read and re-written,
// paths that left the manifest get deleted, and — the bit that matters — paths
// whose hash is unchanged are not touched at all. The hash gate is what makes a
// 2000-note vault viable, because today every sync re-embeds every file.
//
// The delete phase is the dangerous half. A scan that only half-completed looks
// exactly like a vault whose notes were all deleted, and acting on that would
// destroy the index in one pass. Hence the guard below, which refuses rather
// than deletes and says why. It is cheap, and it is the difference between a
// flaky readdir being an annoyance and being a catastrophe.
// ---------------------------------------------------------------------------

import { normalizePath, pathKey } from "./parse";
import { dedupeManifest, type VaultEntry } from "./resolve";

/** A `source: "vault"` row as the index reports it. */
export interface MirrorRow {
  /** The vault-relative path this row mirrors. */
  externalId: string;
  /** The content hash recorded when it was last written. Empty for a row written before hashing existed. */
  hash: string;
  id?: string;
}

/** Why a delete phase was refused. Surfaced to the owner, never swallowed. */
export interface DeleteRefusal {
  reason: string;
  /** How many rows would have been deleted had it gone ahead. */
  would: number;
}

export interface SweepPlan {
  /** Paths whose body must be read and uploaded — new or changed. */
  upsert: VaultEntry[];
  /** `external_id`s to remove, because their file is gone. Empty when refused. */
  remove: string[];
  /** Paths whose hash matched, so nothing is read, uploaded or embedded. */
  unchanged: number;
  /** Set when the delete phase was declined. The upsert half still runs. */
  refused: DeleteRefusal | null;
  /** Duplicate manifest spellings that were collapsed, so the sweep can report them. */
  dropped: string[];
  /** Rows carrying a path the manifest also has but with no recorded hash — re-read once to backfill. */
  rehashed: number;
}

export interface PlanOptions {
  /**
   * The fraction of existing rows the manifest must cover before deletes are
   * allowed. 0.5 means "a scan that found less than half of what we know about
   * is not trusted to say the rest is gone".
   */
  minCoverage?: number;
  /**
   * True when the scan itself reported hitting a limit. A truncated scan can
   * never authorise a delete, regardless of how much it covered.
   */
  truncated?: boolean;
  /** Below this many existing rows the coverage ratio is meaningless, so deletes are allowed. */
  smallVault?: number;
}

/**
 * Work out what this sweep has to do.
 *
 * Pure, and takes the manifest and the rows rather than fetching either, so
 * the two failure modes that would lose data — an empty manifest and a
 * truncated scan — are both testable without a database or a filesystem.
 */
export function planSweep(manifest: VaultEntry[], rows: MirrorRow[], options: PlanOptions = {}): SweepPlan {
  const { minCoverage = 0.5, truncated = false, smallVault = 8 } = options;

  const { entries, dropped } = dedupeManifest(manifest);

  // Rows are keyed the same way paths are, so a row written as `Notes/A.md`
  // and a file scanned as `Notes\A.md` are recognised as the same thing rather
  // than becoming a delete plus an insert.
  const rowByKey = new Map<string, MirrorRow>();
  for (const row of rows) {
    const key = pathKey(row.externalId);
    if (key) rowByKey.set(key, row);
  }

  const upsert: VaultEntry[] = [];
  const seen = new Set<string>();
  let unchanged = 0;
  let rehashed = 0;

  for (const entry of entries) {
    const key = pathKey(entry.path);
    seen.add(key);
    const row = rowByKey.get(key);
    if (!row) {
      upsert.push(entry);
      continue;
    }
    if (!row.hash) {
      // A row from before hashing. Read it once so the next sweep can skip it,
      // rather than re-reading it every time forever.
      rehashed += 1;
      upsert.push({ ...entry, memoryId: row.id });
      continue;
    }
    if (row.hash !== entry.hash) {
      upsert.push({ ...entry, memoryId: row.id });
      continue;
    }
    unchanged += 1;
  }

  const stale = rows.filter((row) => {
    const key = pathKey(row.externalId);
    return key ? !seen.has(key) : true;
  });

  const refused = refuseDelete(entries.length, rows.length, stale.length, { minCoverage, truncated, smallVault });

  return {
    upsert,
    remove: refused ? [] : stale.map((r) => r.externalId),
    unchanged,
    refused,
    dropped,
    rehashed,
  };
}

function refuseDelete(
  found: number,
  known: number,
  stale: number,
  options: Required<PlanOptions>,
): DeleteRefusal | null {
  if (!stale) return null;

  if (options.truncated) {
    return {
      reason: "The scan reported it did not finish, so it cannot be trusted to say which notes are gone. Nothing was deleted.",
      would: stale,
    };
  }

  if (!found) {
    // The single most dangerous input there is: a vault that read as empty.
    // Almost always a wrong path or an unreadable folder, essentially never
    // every note being deleted at once.
    return {
      reason:
        known > 0
          ? `The scan found no notes at all while the index holds ${known}. That is far more likely a wrong vault path than ${known} deletions, so nothing was deleted.`
          : "The scan found no notes.",
      would: stale,
    };
  }

  // Below a handful of notes the ratio says nothing — deleting one of three
  // notes is a 33% drop and entirely normal.
  if (known < options.smallVault) return null;

  const coverage = found / known;
  if (coverage < options.minCoverage) {
    return {
      reason:
        `The scan found ${found} notes where the index holds ${known} — under ` +
        `${Math.round(options.minCoverage * 100)}% of what is known. Nothing was deleted; ` +
        `re-run the sweep, and if the vault really did shrink this much it will go through next time.`,
      would: stale,
    };
  }

  return null;
}

/**
 * Split the upsert list into chunks the route can finish inside its limit.
 *
 * The browser holds the manifest, so it does the chunking and keeps its own
 * progress — which means the route stays under `maxDuration` by construction
 * rather than by hoping a vault stays small. A sweep interrupted halfway has
 * simply written fewer rows; the next one picks up the rest, because the hash
 * gate makes every chunk idempotent.
 */
export function chunk<T>(items: T[], size = 25): T[][] {
  if (size < 1) return items.length ? [items] : [];
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

/**
 * A one-line, honest summary of a plan, for the sweep's own status line.
 *
 * A refusal is appended last and unconditionally — including to a plan that
 * otherwise has nothing to do, which is precisely the case where a silent
 * "nothing to do" would hide the fact that deletes were declined.
 */
export function describePlan(plan: SweepPlan): string {
  const parts: string[] = [];
  if (plan.upsert.length) parts.push(`${plan.upsert.length} to read`);
  if (plan.remove.length) parts.push(`${plan.remove.length} to remove`);

  let line: string;
  if (!parts.length) {
    line = "Nothing to do — the index already matches the vault.";
  } else {
    if (plan.unchanged) parts.push(`${plan.unchanged} unchanged`);
    line = `${parts.join(", ")}.`;
    if (plan.dropped.length) {
      line += ` ${plan.dropped.length} duplicate path${plan.dropped.length === 1 ? "" : "s"} collapsed.`;
    }
  }

  if (plan.refused) line += ` ${plan.refused.reason}`;
  return line.trim();
}

/** True when a sweep would change nothing at all — the steady state. */
export function isNoop(plan: SweepPlan): boolean {
  return !plan.upsert.length && !plan.remove.length;
}

/**
 * The paths a plan needs bodies for.
 *
 * Separate from the plan so the bridge read and the plan can be tested apart,
 * and so a caller can read them in whatever batch size the transport prefers.
 */
export function pathsToRead(plan: SweepPlan): string[] {
  return plan.upsert.map((e) => normalizePath(e.path));
}
