// ---------------------------------------------------------------------------
// STD Safe — where the server-side files live.
//
// The store file and the uploaded lab reports. Same shape as Recall's, with its
// own env var: these two apps should be movable to different volumes, and a
// shared variable would drag one along with the other.
// ---------------------------------------------------------------------------

import { promises as fs } from "node:fs";
import path from "node:path";

export function dataDir(): string {
  return process.env.STDSAFE_DATA_DIR || process.cwd();
}

export function dataFile(name: string): string {
  return path.join(dataDir(), name);
}

/** Where uploaded lab reports go. One directory per user. */
export function reportDir(userId: string): string {
  return path.join(dataDir(), "std-safe-reports", userId);
}

/**
 * Create a directory if it is missing. Returns false when it cannot be made,
 * which is the genuinely read-only case — worth distinguishing from ENOENT on a
 * volume that simply has not been created yet.
 */
export async function ensureDir(dir: string): Promise<boolean> {
  try {
    await fs.mkdir(dir, { recursive: true });
    return true;
  } catch {
    return false;
  }
}

export async function ensureDataDir(): Promise<boolean> {
  return ensureDir(dataDir());
}
