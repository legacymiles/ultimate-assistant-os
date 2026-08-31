// ---------------------------------------------------------------------------
// Recall — first run.
// Deliberately empty. You build your own folder structure; nothing is invented
// for you and nothing has to be deleted before you start.
// ---------------------------------------------------------------------------

import type { RecallData } from "./types";

export function buildSeed(): RecallData {
  return { folders: [], items: [] };
}
