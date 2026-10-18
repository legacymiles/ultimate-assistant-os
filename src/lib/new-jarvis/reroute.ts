// ---------------------------------------------------------------------------
// When Claude won't, DeepSeek does — for legal explicit content only.
//
// Jarvis's brain is Claude by default, and Claude turns down sexually explicit
// work. The owner builds and runs adult sites as well as ordinary ones, so a
// refusal on that kind of job is a dead end rather than a safeguard. Same rule
// Client Review uses (src/lib/client-review/routing.ts): when the default
// Claude brain refuses, the same turn goes to the uncensored models — DeepSeek
// first, Grok behind it — instead of stopping.
//
// What it never does:
//   - override a model the owner picked by hand (a non-Claude pick is theirs);
//   - reroute anything the content check blocks — sexual content involving
//     minors, or non-consent. Those stay refused, by every model.
//   - reroute a failure that is NOT a content refusal (no credit, outage):
//     another model would not fix it, and quietly sending the owner's words
//     elsewhere would surprise them.
// ---------------------------------------------------------------------------

import { decideRoute } from "@/lib/client-review/contentCheck";
import { modelList, UNCENSORED_MODELS_DEFAULT } from "@/lib/client-review/routing";

export { isPolicyFailure, looksLikeRefusal } from "@/lib/client-review/routing";

/** The models a refused turn goes to, in order. JARVIS_UNCENSORED_MODELS overrides. */
export function uncensoredChain(env: { jarvis?: string; clientReview?: string } = {}): string[] {
  return modelList(env.jarvis || env.clientReview, UNCENSORED_MODELS_DEFAULT);
}

/**
 * May this turn be rerouted at all? Only when:
 *   - the brain is the hub default or a Claude model (a hand-picked non-Claude
 *     model is the owner's call),
 *   - the job is explicit adult content — in what they asked for or on the page
 *     Jarvis is working on. A refusal for any OTHER reason stays a refusal;
 *     this is for "Claude won't write adult content", not a way around every no.
 *   - and it is not on the blocked side of the line (minors, non-consent).
 */
export function mayReroute(model: string, defaultModel: string, ...texts: string[]): boolean {
  const claude = model === defaultModel || model.startsWith("anthropic/");
  if (!claude) return false;
  const text = texts.filter(Boolean).join("\n").slice(0, 12_000);
  return decideRoute(text, null, null).route === "uncensored";
}
