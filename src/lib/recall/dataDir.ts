import { promises as fs } from "node:fs";
import path from "node:path";

// ---------------------------------------------------------------------------
// Where Recall's server-side files live — the app-password hash and the family
// Lists board.
//
// They sit next to the project by default, which is right for local dev. Set
// RECALL_DATA_DIR to move them onto a mounted volume instead: on a host whose
// code directory is read-only or rebuilt on each deploy, that is the difference
// between a board that persists and one that resets.
// ---------------------------------------------------------------------------

export function dataDir(): string {
  return process.env.RECALL_DATA_DIR || process.cwd();
}

export function dataFile(name: string): string {
  return path.join(dataDir(), name);
}

/**
 * Create the data directory if it is missing.
 *
 * Must run before every write and before every write-probe. A RECALL_DATA_DIR
 * pointing at a volume that does not exist yet is the normal case, not an edge
 * case — and without this the ENOENT is indistinguishable from a read-only
 * filesystem, so the board silently refuses every submission while claiming the
 * host is at fault.
 *
 * Returns false when the directory cannot be made, which IS the read-only case.
 */
export async function ensureDataDir(): Promise<boolean> {
  try {
    await fs.mkdir(dataDir(), { recursive: true });
    return true;
  } catch {
    return false;
  }
}
