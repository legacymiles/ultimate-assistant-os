import "server-only";

import { batchVerdict, decideRoute, type RouteDecision } from "./contentCheck";

// ---------------------------------------------------------------------------
// Checking a batch of client edit requests — word list only.
//
// No decision model here, by the owner's call (18 Oct 2026): every send waits
// for the owner to approve it anyway, so the speed a model like Jev buys is
// worth nothing on this path. decideRoute still accepts model answers, so
// adding one back is passing them in here; nothing else changes.
//
// The word list is what enforces the blocked line, and it runs everywhere,
// with or without a key.
// ---------------------------------------------------------------------------

export async function checkRequests(texts: string[]): Promise<RouteDecision[]> {
  return texts.map((text) => decideRoute(text, null, null));
}

export async function checkBatch(texts: string[], _projectName?: string): Promise<RouteDecision> {
  return batchVerdict(await checkRequests(texts));
}
