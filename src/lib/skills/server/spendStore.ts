import "server-only";

// ---------------------------------------------------------------------------
// Skill spend — one server document ("skill-spend"), next to the AI spend
// ledger (ai-spend) and kept the same way: global to this deployment, because
// the metering happens inside provider.ts where there is no signed-in user,
// only a call. Writes are batched like the ledger's, so a burst of calls costs
// one document write, and every write is best-effort: metering must never
// break the call it measures.
// ---------------------------------------------------------------------------

import path from "node:path";
import { readDoc, writeDoc } from "@/lib/server/docStore";
import { addJev, addSpend, normalizeSpend, SPEND_DOC, type SpendDoc, type SpendEvent } from "../spend";

function dataDir(): string {
  return process.env.AI_SETTINGS_DATA_DIR || path.resolve(".data");
}

let chain: Promise<unknown> = Promise.resolve();
let pending: SpendEvent[] = [];
let pendingJev: { used: boolean; cost: number; ms: number }[] = [];
let flushAt = 0;
const FLUSH_MS = 15_000;

export async function readSpend(): Promise<SpendDoc> {
  const doc = normalizeSpend(await readDoc<SpendDoc>(SPEND_DOC, dataDir()).catch(() => null));
  // Include what is counted but not yet written, so a reload right after a run shows it.
  if (pending.length) addSpend(doc, pending);
  for (const j of pendingJev) addJev(doc, j);
  return doc;
}

/** Read, change, write — for the owner's caps and pins. Throws when nothing was kept. */
export async function updateSpend(change: (doc: SpendDoc) => SpendDoc): Promise<SpendDoc> {
  await flush();
  let out: SpendDoc = normalizeSpend(null);
  const run = chain.then(async () => {
    const cur = normalizeSpend(await readDoc<SpendDoc>(SPEND_DOC, dataDir()).catch(() => null));
    out = change(cur);
    if (!(await writeDoc(SPEND_DOC, dataDir(), out))) throw new Error("Skill spend could not be saved on this host. On a deployed site it needs SUPABASE_SERVICE_ROLE_KEY.");
  });
  chain = run.catch(() => undefined);
  await run;
  return out;
}

/** Write everything counted so far. */
export async function flush(): Promise<void> {
  if (!pending.length && !pendingJev.length) return;
  const events = pending;
  const jev = pendingJev;
  pending = [];
  pendingJev = [];
  flushAt = Date.now();
  const run = chain.then(async () => {
    const doc = normalizeSpend(await readDoc<SpendDoc>(SPEND_DOC, dataDir()).catch(() => null));
    addSpend(doc, events);
    for (const j of jev) addJev(doc, j);
    if (!(await writeDoc(SPEND_DOC, dataDir(), doc))) {
      // Keep the rows for the next flush rather than lose them.
      pending = [...events, ...pending];
      pendingJev = [...jev, ...pendingJev];
    }
  });
  chain = run.catch(() => undefined);
  return run.catch(() => undefined);
}

/** Count metered runs. Never throws, never blocks. */
export function noteSpend(events: SpendEvent[]): void {
  if (!events.length) return;
  pending.push(...events);
  const urgent = events.some((e) => e.cost >= 0.25);
  if (urgent || Date.now() - flushAt > FLUSH_MS) void flush();
}

/** Count one Jev routing decision. Never throws, never blocks. */
export function noteJev(d: { used: boolean; cost: number; ms: number }): void {
  pendingJev.push(d);
  if (Date.now() - flushAt > FLUSH_MS) void flush();
}

/** Count runs that arrived over HTTP (Claude Code's hook) and write them now. */
export async function recordSpendNow(events: SpendEvent[]): Promise<number> {
  let added = 0;
  await updateSpend((doc) => {
    added = addSpend(doc, events);
    return doc;
  });
  return added;
}
