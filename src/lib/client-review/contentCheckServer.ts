import "server-only";

import { decide, decisionsConfigured } from "@/lib/ai/decide";
import { batchVerdict, decideRoute, routingQuestions, type RouteDecision } from "./contentCheck";

// ---------------------------------------------------------------------------
// The decision-model half of contentCheck.ts: Span-01 Lite (free) and Jev
// asked in parallel about each request. No key, a timeout or a failure just
// means the word list decides — this can slow a send down by a few seconds at
// most, never stop one that should go.
// ---------------------------------------------------------------------------

/** Requests checked at once, so a 40-request send is not 80 calls in one burst. */
const BATCH = 8;

export async function checkRequests(texts: string[], projectName: string): Promise<RouteDecision[]> {
  const useModels = decisionsConfigured();
  const out: RouteDecision[] = new Array(texts.length);
  for (let i = 0; i < texts.length; i += BATCH) {
    await Promise.all(
      texts.slice(i, i + BATCH).map(async (text, j) => {
        const q = routingQuestions(text, projectName);
        const [span, jev] = useModels
          ? await Promise.all([
              decide({ model: "respan/span-01-lite:free", ...q }, { app: "client-review", timeoutMs: 3_500 }),
              decide({ model: "typesafe/jev-1.13", ...q }, { app: "client-review", timeoutMs: 2_500 }),
            ])
          : [null, null];
        out[i + j] = decideRoute(text, span, jev);
      }),
    );
  }
  return out;
}

export async function checkBatch(texts: string[], projectName: string): Promise<RouteDecision> {
  return batchVerdict(await checkRequests(texts, projectName));
}
