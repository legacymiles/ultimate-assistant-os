import "server-only";

import { recordCall } from "./spend";
import { buildDecisionBody, readDecisionResponse, type DecisionRequest, type DecisionResult } from "./decisions";

// ---------------------------------------------------------------------------
// One call to a decision model (Jev, Span) through OpenRouter's Decisions API.
//
// Never throws, and returns null for every kind of failure: no key, a slow
// answer, a bad status, malformed JSON. Every caller treats null exactly like
// a low-confidence answer and takes its safe path — a decision model is a
// shortcut, so losing it must cost speed, never correctness.
//
// OpenRouter only: the Vercel gateway has no Decisions endpoint.
// ---------------------------------------------------------------------------

const URL = "https://openrouter.ai/api/alpha/decisions";

/** Past this the shortcut is no longer a shortcut. Span-01 Lite runs ~1.5 s. */
const DEFAULT_TIMEOUT_MS = 4_000;

export function decisionsConfigured(): boolean {
  return Boolean(process.env.OPENROUTER_API_KEY);
}

export async function decide(
  req: DecisionRequest,
  opts: { timeoutMs?: number; app?: string } = {},
): Promise<DecisionResult | null> {
  const key = process.env.OPENROUTER_API_KEY;
  if (!key) return null;
  const body = buildDecisionBody(req);
  if (!Object.keys(body.questions).length) return null;

  const started = Date.now();
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), opts.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  try {
    const res = await fetch(URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
        "HTTP-Referer": process.env.OPENROUTER_SITE_URL || "https://ultimate-assistant-os.vercel.app",
        "X-Title": "Ultimate Assistant OS",
      },
      body: JSON.stringify(body),
      signal: ctl.signal,
    });
    if (!res.ok) {
      recordCall({ model: req.model, provider: "openrouter", usage: null, app: opts.app, failed: true });
      return null;
    }
    const result = readDecisionResponse(await res.json(), Date.now() - started);
    recordCall({
      model: result.model || req.model,
      provider: "openrouter",
      usage: { prompt_tokens: result.inputTokens, completion_tokens: 0, cost: result.cost },
      app: opts.app,
    });
    return result;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}
