// ---------------------------------------------------------------------------
// Decision models — fast, typed judgments instead of written answers.
//
// Every other AI call in the hub asks a chat model to WRITE something. A lot of
// what Jarvis does is not writing, it is deciding: which path should this
// message take, does this action need a yes, is this request something a
// mainstream model will refuse. A chat model answers those slowly and in
// prose that then has to be parsed. A decision model answers them in one
// parallel pass, with a probability, and cannot answer outside the options it
// was given.
//
// They all speak one format on OpenRouter, the Decisions API
// (POST /api/alpha/decisions): a `state` object, and named `questions` that
// are each a `choice`, a `noul` (yes/no, answered as a probability of yes) or
// a `score` on an ordered scale. So swapping Jev for Span is changing `model`.
//
// Two rules for using them in Jarvis:
//
//   1. A DECISION MODEL ROUTES, IT NEVER ACTS. Its answer picks a path or
//      raises a flag; anything with an effect still goes through the same
//      confirm step it always did.
//
//   2. LOW CONFIDENCE FALLS BACK. These models can be wrong and they say how
//      sure they are. Below the threshold the caller takes the safe path
//      (usually: let the big model decide), never the guessed one.
//
// This file is pure — the catalogue, the request builder, the answer reader —
// so the Toolbox can show the same table the code runs on, and the tests need
// no network. The server call is in decide.ts.
// ---------------------------------------------------------------------------

export type DecisionModelId = "typesafe/jev-1.14" | "typesafe/jev-1.13" | "respan/span-01-lite:free" | "respan/span-02";

/** The Jev release Jarvis uses. One place to move it when TypeSafe ships the next one. */
export const JEV: DecisionModelId = "typesafe/jev-1.14";

export interface DecisionModel {
  id: DecisionModelId;
  label: string;
  maker: string;
  /** What it is best at, in the owner's words. */
  goodFor: string;
  /** Where it is the wrong tool. */
  notFor: string;
  /** Which question types it answers. Span-01 only scores behaviours, so yes/no only. */
  types: QuestionType[];
  /** Reads pictures as well as text. */
  images: boolean;
  /** Typical end-to-end time, as published or measured. */
  latency: string;
  /** Price as listed on OpenRouter, in plain words. */
  price: string;
  /** ISO date it became available. */
  released: string;
}

/**
 * The decision models worth knowing about, as of October 2026.
 *
 * Jev is the fast one: 70–500 ms published, priced on input only. Span-01
 * Lite is free but slower (1.48 s P50 on OpenRouter) and only says how likely
 * a plain-language behaviour is present — exactly right for "is this request
 * explicit?", useless for "which of these five paths?". Span-02 (16 Oct 2026)
 * is its paid, open-weight successor and the only one here that looks at
 * pictures; no latency figure is published for it yet, so none is claimed.
 */
export const DECISION_MODELS: DecisionModel[] = [
  {
    id: "typesafe/jev-1.14",
    label: "Jev 1.14",
    maker: "TypeSafe",
    goodFor: "Instant routing and triage: pick a path, score urgency, yes/no checks, all in one call.",
    notFor: "Anything that has to be written. It returns choices and probabilities, never text.",
    types: ["choice", "noul", "score"],
    images: false,
    latency: "70–500 ms",
    price: "$0.042 per million input tokens, output free",
    released: "2026-10-14",
  },
  {
    id: "typesafe/jev-1.13",
    label: "Jev 1.13",
    maker: "TypeSafe",
    goodFor: "Instant routing and triage: pick a path, score urgency, yes/no checks, all in one call.",
    notFor: "Anything that has to be written. It returns choices and probabilities, never text.",
    types: ["choice", "noul", "score"],
    images: false,
    latency: "70–500 ms",
    price: "$0.042 per million input tokens, output free",
    released: "2026-09-15",
  },
  {
    id: "respan/span-01-lite:free",
    label: "Span-01 Lite",
    maker: "Respan",
    goodFor: "Free yes/no flags on a conversation: is this behaviour present? Good for content checks and monitoring.",
    notFor: "Picking between several paths, or anything where a second and a half is too slow.",
    types: ["noul"],
    images: false,
    latency: "about 1.5 s",
    price: "Free",
    released: "2026-09-26",
  },
  {
    id: "respan/span-02",
    label: "Span-02",
    maker: "Respan",
    goodFor: "Choices, yes/no and scores over text AND images — sorting photos, checking screenshots.",
    notFor: "Free use; it is billed per decision.",
    types: ["choice", "noul", "score"],
    images: true,
    latency: "not published yet",
    price: "$0.01 per million input tokens, output free",
    released: "2026-10-16",
  },
];

export function decisionModel(id: string): DecisionModel | undefined {
  return DECISION_MODELS.find((m) => m.id === id);
}

// --- questions -------------------------------------------------------------

export type QuestionType = "choice" | "noul" | "score";

export interface ChoiceQuestion {
  type: "choice";
  instructions: string;
  /** Option name → what it means. */
  criteria: Record<string, string>;
}

export interface NoulQuestion {
  type: "noul";
  instructions: string;
  criteria: { true: string; false: string };
}

export interface ScoreQuestion {
  type: "score";
  instructions: string;
  /** Lowest first. */
  criteria: string[];
}

export type Question = ChoiceQuestion | NoulQuestion | ScoreQuestion;

export interface DecisionRequest {
  model: DecisionModelId;
  state: Record<string, unknown>;
  questions: Record<string, Question>;
}

/** Longest a single state value may be. Decisions are about a message, not a book. */
const STATE_CHARS = 8_000;

/**
 * The body for one call, trimmed and checked.
 *
 * A question the chosen model cannot answer is dropped rather than sent, so a
 * Span-01 call never 400s on a `choice` — the caller just gets no answer for
 * it, and treats that like low confidence.
 */
export function buildDecisionBody(req: DecisionRequest): DecisionRequest {
  const model = decisionModel(req.model);
  const state: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(req.state)) {
    state[k] = typeof v === "string" ? v.slice(0, STATE_CHARS) : v;
  }
  const questions: Record<string, Question> = {};
  for (const [name, q] of Object.entries(req.questions)) {
    if (model && !model.types.includes(q.type)) continue;
    questions[name] = q;
  }
  return { model: req.model, state, questions };
}

// --- answers ---------------------------------------------------------------

export interface ChoiceAnswer {
  type: "choice";
  choice: string;
  confidence: number;
  probabilities: Record<string, number>;
}

export interface NoulAnswer {
  type: "noul";
  /** Probability of yes, 0..1. */
  yes: number;
}

export interface ScoreAnswer {
  type: "score";
  /** Probability-weighted position, 0 = first criterion. */
  score: number;
  confidence: number;
}

export type Answer = ChoiceAnswer | NoulAnswer | ScoreAnswer;

export interface DecisionResult {
  answers: Record<string, Answer>;
  /** The dated snapshot that answered. */
  model: string;
  cost: number;
  inputTokens: number;
  ms: number;
}

const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
const unit = (v: number) => Math.min(1, Math.max(0, v));

/**
 * Read a Decisions API response. Untrusted JSON: anything malformed is left
 * out, never guessed, so a caller asking for an answer that is not there
 * takes its fallback path.
 */
export function readDecisionResponse(raw: unknown, ms = 0): DecisionResult {
  const r = (raw ?? {}) as Record<string, unknown>;
  const answers: Record<string, Answer> = {};
  const rawAnswers = (r.answers ?? {}) as Record<string, Record<string, unknown>>;
  for (const [name, a] of Object.entries(rawAnswers)) {
    if (!a || typeof a !== "object") continue;
    if (a.type === "noul") {
      const yes = num(a.noul);
      if (yes !== null) answers[name] = { type: "noul", yes: unit(yes) };
    } else if (a.type === "choice") {
      const choice = typeof a.choice === "string" ? a.choice : "";
      const confidence = num(a.confidence);
      if (!choice || confidence === null) continue;
      const probabilities: Record<string, number> = {};
      for (const [k, p] of Object.entries((a.probabilities ?? {}) as Record<string, unknown>)) {
        const n = num(p);
        if (n !== null) probabilities[k] = unit(n);
      }
      answers[name] = { type: "choice", choice, confidence: unit(confidence), probabilities };
    } else if (a.type === "score") {
      const score = num(a.score);
      const confidence = num(a.confidence);
      if (score === null) continue;
      answers[name] = { type: "score", score: Math.max(0, score), confidence: unit(confidence ?? 0) };
    }
  }
  const usage = (r.usage ?? {}) as Record<string, unknown>;
  return {
    answers,
    model: typeof r.model === "string" ? r.model : "",
    cost: Math.max(0, num(usage.cost) ?? 0),
    inputTokens: Math.max(0, num(usage.input_tokens) ?? 0),
    ms,
  };
}

// --- reading answers safely ---------------------------------------------------

/** Below this a choice is treated as "not sure" and the caller takes its safe path. */
export const CHOICE_CONFIDENCE = 0.6;

/**
 * The picked option, or null when it is missing or not confident enough.
 * Null always means "use your fallback", never "the answer was the first option".
 */
export function confidentChoice(
  result: DecisionResult | null,
  name: string,
  min = CHOICE_CONFIDENCE,
): string | null {
  const a = result?.answers[name];
  if (!a || a.type !== "choice") return null;
  return a.confidence >= min ? a.choice : null;
}

/**
 * Yes, no, or unsure. The middle band is deliberately wide: a flag that fires
 * at 51% is a coin with a label on it.
 */
export function yesNo(result: DecisionResult | null, name: string, yesAt = 0.7, noAt = 0.3): "yes" | "no" | "unsure" {
  const a = result?.answers[name];
  if (!a || a.type !== "noul") return "unsure";
  if (a.yes >= yesAt) return "yes";
  if (a.yes <= noAt) return "no";
  return "unsure";
}
