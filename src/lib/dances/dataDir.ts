import { promises as fs } from "node:fs";
import path from "node:path";

// ---------------------------------------------------------------------------
// Where Dance of the Day's file lives.
//
// `.dances-daily.json` sits next to the project by default, which is right for
// local dev. Set DANCES_DATA_DIR to move it onto a mounted volume instead: on
// a host whose code directory is read-only or rebuilt on each deploy, that is
// the difference between a daily history that accumulates and one that resets
// every night.
//
// Same shape as Recall's dataDir, deliberately — two apps in this hub solving
// the identical problem should not solve it two different ways.
// ---------------------------------------------------------------------------

export function dataDir(): string {
  return process.env.DANCES_DATA_DIR || process.cwd();
}

export function dailyFilePath(): string {
  return path.join(dataDir(), ".dances-daily.json");
}

/**
 * Create the data directory if it is missing. Returns false when it cannot be
 * made, which IS the read-only case — the caller degrades to "picks are not
 * being saved" rather than failing the request.
 */
export async function ensureDataDir(): Promise<boolean> {
  try {
    await fs.mkdir(dataDir(), { recursive: true });
    return true;
  } catch {
    return false;
  }
}
