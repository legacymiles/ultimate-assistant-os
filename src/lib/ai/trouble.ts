// ---------------------------------------------------------------------------
// Why the AI did not answer, in words that name the fix.
//
// Routing made this necessary. A call now walks up to four models across two
// providers, so "the model failed" is no longer a fact about one thing — the
// free model may have hit its daily cap, the paid one may be out of credit, and
// the owner sees a single sentence that mentions neither. Worse, the old error
// was the LAST attempt's raw provider JSON truncated at 200 characters, which
// routinely cut off mid-token and told nobody anything.
//
// So every attempt is collected and diagnosed together. Three rules:
//
// 1. NAME THE BLOCKER, NOT THE SYMPTOM. "Out of credit" sends the owner to the
//    top-up page; "the request failed" sends them to a log file.
//
// 2. SAY WHAT STILL WORKS. Out of credit with a free rung on the ladder is a
//    different situation from out of credit with nothing free left, and the
//    difference decides whether they stop what they are doing.
//
// 3. KEEP THE TRAIL. The one-line verdict is for reading; the per-model trail is
//    for believing it, and for the case the verdict gets wrong.
// ---------------------------------------------------------------------------

import type { ProviderId } from "./settings";

export interface Attempt {
  model: string;
  provider: ProviderId;
  /** Absent when the request never got an answer at all. */
  status?: number;
  /** The provider's own words, already trimmed. */
  message: string;
}

export type TroubleKind =
  | "no-credit"
  | "credit-or-key"
  | "rate-limit"
  | "missing-model"
  | "too-big"
  | "bad-request"
  | "provider-down"
  | "network"
  | "unknown";

export interface Diagnosis {
  kind: TroubleKind;
  /** One sentence naming what stopped it. */
  headline: string;
  /** What to do, or "" when there is nothing the owner can do. */
  fix: string;
  /** One line per model tried. */
  trail: string[];
  /** Everything above as the single string an error field carries. */
  text: string;
}

/** "qwen3.8-27b free" out of "qwen/qwen3.8-27b:free". */
export function shortModel(id: string): string {
  if (!id) return "the model";
  const tail = id.includes("/") ? id.slice(id.indexOf("/") + 1) : id;
  return tail.replace(/:free$/, " free");
}

/**
 * A refusal that is really "that model is not a thing", whatever status it came
 * under.
 *
 * Measured against the live API, not assumed: OpenRouter answers 400 — not 404 —
 * for an unknown model id, with "… is not a valid model ID". Classified on the
 * status alone that lands in "bad request", whose advice is to go read the server
 * log, when the provider has already said precisely what is wrong and the actual
 * fix is to re-check the router's table.
 */
const NOT_A_MODEL = /not a valid model|no endpoints found|model not found|unknown model|no such model/i;

export function kindOf(attempt: Attempt): TroubleKind {
  const { status } = attempt;
  if (status === undefined) return "network";
  if (NOT_A_MODEL.test(attempt.message)) return "missing-model";
  if (status === 402) return "no-credit";
  // Measured, not assumed: OpenRouter answers 401 for an exhausted balance as
  // well as for a bad key, so a message that only mentions the key sends the
  // owner to check a key that is perfectly fine.
  if (status === 401 || status === 403) return "credit-or-key";
  if (status === 429) return "rate-limit";
  if (status === 404) return "missing-model";
  if (status === 413) return "too-big";
  if (status === 400 || status === 422) return "bad-request";
  if (status >= 500) return "provider-down";
  return "unknown";
}

/** Is this model free? Read off the id, which is how OpenRouter marks it. */
function isFree(model: string): boolean {
  return model.endsWith(":free");
}

const HEADLINE: Record<TroubleKind, string> = {
  "no-credit": "OpenRouter is out of credit.",
  "credit-or-key": "OpenRouter turned the request away — usually an empty balance, sometimes the key.",
  "rate-limit": "The model is rate-limiting this key.",
  "missing-model": "The model no longer exists at that name.",
  "too-big": "The request was too big for the model to accept.",
  "bad-request": "The request itself was rejected, so retrying it unchanged will not help.",
  "provider-down": "The AI provider is having trouble.",
  network: "The AI provider could not be reached at all.",
  unknown: "The AI provider refused the request.",
};

const FIX: Record<TroubleKind, string> = {
  "no-credit": "Top up at openrouter.ai/credits.",
  "credit-or-key": "Check the OpenRouter credit first, then OPENROUTER_API_KEY in .env.local.",
  "rate-limit": "Wait a moment and try again.",
  "missing-model": "Run npm run check:router to see what moved, then fix src/lib/ai/router.ts.",
  "too-big": "Send less — fewer pictures, or a shorter conversation.",
  "bad-request": "The details are in the server log.",
  "provider-down": "Try again in a minute.",
  network: "Check the connection, then try again.",
  unknown: "",
};

/**
 * The kind that best explains a set of failures.
 *
 * Not simply the first or the commonest: a rate limit on the free rung while the
 * paid rung is out of credit is really a credit problem, because the free one
 * would have worked if the paid one had not been the fallback. Ordering the
 * kinds by how actionable they are puts the sentence worth acting on first.
 */
const PRIORITY: TroubleKind[] = [
  "no-credit",
  "credit-or-key",
  "missing-model",
  "bad-request",
  "too-big",
  "rate-limit",
  "provider-down",
  "network",
  "unknown",
];

export function diagnose(attempts: Attempt[]): Diagnosis {
  if (attempts.length === 0) {
    return {
      kind: "unknown",
      headline: HEADLINE.unknown,
      fix: "",
      trail: [],
      text: HEADLINE.unknown,
    };
  }

  const kinds = attempts.map(kindOf);
  const kind = PRIORITY.find((k) => kinds.includes(k)) ?? "unknown";

  const trail = attempts.map((a) => {
    // describe() already prefixes the status, so stripping it here stops
    // "402 402 Insufficient credits".
    const why = a.status === undefined ? a.message : `${a.status} ${a.message.replace(/^\d{3}\s*/, "")}`;
    return `${shortModel(a.model)} — ${why.trim().slice(0, 160)}`;
  });

  let headline = HEADLINE[kind];
  if (attempts.length > 1) {
    headline = `All ${attempts.length} models the router tried refused. ${headline}`;
  }

  // Rule 2: what still works changes what the owner does next.
  let fix = FIX[kind];
  const freeFailed = attempts.some((a) => isFree(a.model));
  if ((kind === "no-credit" || kind === "credit-or-key") && !freeFailed) {
    fix = `${fix} The free models are unaffected — this call needed a paid one.`;
  }
  if (kind === "rate-limit" && attempts.every((a) => isFree(a.model))) {
    fix = "Only the free models were tried, and free models have a daily cap on OpenRouter. Wait for the reset, or add credit so the paid rungs can take over.";
  }

  const text = [headline, fix].filter(Boolean).join(" ") + (trail.length ? ` (${trail.join("; ")})` : "");
  return { kind, headline, fix, trail, text };
}

/**
 * The body aiFetch puts on a failed response.
 *
 * Shaped like a provider error so every existing `body.error.message` reader
 * keeps working and simply gets a better sentence; `attempts` is additive, for
 * anything that wants to show the trail itself.
 */
export interface TroubleBody {
  error: { message: string; kind: TroubleKind; attempts: Attempt[] };
}

export function troubleBody(attempts: Attempt[]): TroubleBody {
  const d = diagnose(attempts);
  return { error: { message: d.text, kind: d.kind, attempts } };
}
