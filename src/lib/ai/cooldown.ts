// ---------------------------------------------------------------------------
// Remembering which models are refusing, so the ladder stops knocking.
//
// Putting the free rung first assumed a free model answers. Measured on
// 1 Oct 2026, neither of them does:
//
//   qwen/qwen3.8-27b:free        429, every time — "temporarily rate-limited
//                                upstream", a shared pool this key does not own.
//   thinkingmachines/inkling:free  403, every time — "only available on agentic
//                                harnesses". A policy gate, not a blip, and it
//                                applies to inkling-small:free too.
//
// Without this module the cost of free-first is a failed request on EVERY call
// in the hub, paid in latency, before anything answers. With it, a model that
// refuses is skipped for a while and then quietly tried again — so the owner's
// rule ("free whenever it can") still holds the moment the pool frees up,
// instead of being abandoned because it was unavailable one afternoon.
//
// In memory, per instance. A serverless box that has not seen the refusal yet
// pays one attempt to learn it, which is the right trade: the alternative is a
// document write on the hot path of every failed call, and the state is worth
// less than that.
// ---------------------------------------------------------------------------

/** How long a refusal keeps a model out of the chain. */
const GATED_MS = 60 * 60_000; // A policy refusal (403) will not change in minutes.
const LIMITED_MS = 5 * 60_000; // A shared-pool rate limit might.

const until = new Map<string, { at: number; why: string }>();

/** Does this status mean "this MODEL is unavailable", rather than "this account is"? */
export function isModelRefusal(status: number | undefined): boolean {
  // 402 is deliberately absent: an empty balance is the account's problem, and
  // benching every paid model for an hour over it would strand the hub on a free
  // rung that is itself refusing.
  return status === 429 || status === 403;
}

/**
 * Note that a model turned a request away.
 *
 * Only called for a refusal that is about the model. A 500 is the provider
 * having a bad minute and the ordinary retry already covers it.
 */
export function markRefused(model: string, status: number | undefined, message = ""): void {
  if (!model || !isModelRefusal(status)) return;
  const gated = status === 403;
  until.set(model, {
    at: Date.now() + (gated ? GATED_MS : LIMITED_MS),
    why: message.replace(/\s+/g, " ").slice(0, 160) || (gated ? "refused this app" : "rate-limited"),
  });
}

/** When this model is worth trying again, or null when it is fine now. */
export function coolingUntil(model: string): { at: number; why: string } | null {
  const hit = until.get(model);
  if (!hit) return null;
  if (Date.now() >= hit.at) {
    until.delete(model);
    return null;
  }
  return hit;
}

/**
 * The chain minus anything currently refusing — but never empty.
 *
 * The guard matters more than the filter: when every model is cooling down the
 * right move is to try the first one anyway, because a stale note about a shared
 * pool must not be the reason the hub stops answering at all.
 */
export function skipCooling(models: string[]): string[] {
  const open = models.filter((m) => !coolingUntil(m));
  return open.length ? open : models.slice(0, 1);
}

/** Every model currently benched, for the Toolbox to show. */
export function cooling(): { model: string; until: string; why: string }[] {
  const out: { model: string; until: string; why: string }[] = [];
  for (const model of [...until.keys()]) {
    const hit = coolingUntil(model);
    if (hit) out.push({ model, until: new Date(hit.at).toISOString(), why: hit.why });
  }
  return out;
}

/** Tests only: forget everything. */
export function clearCooldowns(): void {
  until.clear();
}
