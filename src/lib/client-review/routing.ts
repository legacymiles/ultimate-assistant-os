// ---------------------------------------------------------------------------
// Which model writes a build brief.
//
// Some client sites are adult or otherwise explicit, and a model with a strict
// content policy will turn the brief down. Rather than the owner rewriting the
// client's words to get past it, the brief goes down one of two lanes:
//
//   standard    — Claude.
//   uncensored  — a model with a looser content policy (DeepSeek by default,
//                 Grok behind it), set per deploy in the env.
//
// A project's lane is the owner's call: "standard" or "uncensored" always, or
// "auto" — Claude first, and when Claude refuses (a policy status, or a reply
// that is a refusal rather than a brief) the same request goes down the
// uncensored lane without the owner having to press anything.
// ---------------------------------------------------------------------------

import type { ContentLane } from "./types";

export const STANDARD_MODEL_DEFAULT = "anthropic/claude-sonnet-5";
export const UNCENSORED_MODELS_DEFAULT = ["deepseek/deepseek-v4-pro-0813", "x-ai/grok-4.6"];

/** "a, b , c" → ["a","b","c"], or the fallback when the env is blank. */
export function modelList(raw: string | undefined, fallback: string[]): string[] {
  const list = (raw ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  return list.length ? list : fallback;
}

export interface LanePlan {
  lane: "standard" | "uncensored";
  models: string[];
}

/** In order: the lanes to try for a project's setting. */
export function lanePlan(
  lane: ContentLane,
  env: { standard?: string; uncensored?: string } = {},
): LanePlan[] {
  const standard: LanePlan = { lane: "standard", models: modelList(env.standard, [STANDARD_MODEL_DEFAULT]) };
  const uncensored: LanePlan = { lane: "uncensored", models: modelList(env.uncensored, UNCENSORED_MODELS_DEFAULT) };
  if (lane === "standard") return [standard];
  if (lane === "uncensored") return [uncensored];
  return [standard, uncensored];
}

/**
 * Phrases a model uses when it is declining rather than doing the job.
 *
 * Only checked against the OPENING of a reply: a real brief that later says
 * "the client can't decide between blue and green" is not a refusal.
 */
const REFUSAL_OPENERS = [
  /^i('m| am) (sorry|unable|not able|not comfortable)/i,
  /^(sorry|apologies)[,.!]/i,
  /^i (can(no|')t|won't|will not|must decline|need to decline|'m not going to)/i,
  /^unfortunately,? i/i,
  /^i do(n't| not) (feel comfortable|produce|create|write|generate|help)/i,
  /^this request (involves|contains|asks)/i,
  /^as an ai/i,
];

/** Body text a policy layer sends back with a 400/403. */
const POLICY_ERRORS = /(content (policy|filter|moderation)|moderation|flagged|safety system|violat(e|es|ion)|not allowed|prohibited)/i;

export function looksLikeRefusal(reply: string): boolean {
  const head = reply.trim().replace(/^["'*_#>\s]+/, "").slice(0, 200);
  if (!head) return true; // an empty reply did not do the job either
  return REFUSAL_OPENERS.some((re) => re.test(head));
}

/** A failed response that is the MODEL's content policy, not a key or credit problem. */
export function isPolicyFailure(status: number, body: string): boolean {
  if (status === 403 && !/credit|balance|key|auth/i.test(body)) return true;
  return (status === 400 || status === 403 || status === 422) && POLICY_ERRORS.test(body);
}
