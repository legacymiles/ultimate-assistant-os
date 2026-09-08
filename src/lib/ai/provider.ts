// ---------------------------------------------------------------------------
// Which AI endpoint this hub talks to.
//
// Both providers speak the SAME OpenAI-compatible /chat/completions shape and
// accept the SAME model strings ("anthropic/claude-opus-5"), so switching
// between them is a base URL and a key — never a change to the request body.
// That is the only reason one function can stand in for both.
//
// OpenRouter is preferred over the Vercel AI Gateway because the gateway's free
// tier serves NO Anthropic model even with a card on file; it needs purchased
// credits before it will answer at all. OpenRouter bills the same $5/$25 per
// million for Opus 5. If the gateway is ever topped up, delete nothing — just
// unset OPENROUTER_API_KEY and the gateway takes over.
//
// Returning null (rather than throwing) is deliberate: every caller already has
// an offline path, and a missing key must degrade visibly rather than 500.
// ---------------------------------------------------------------------------

export interface AiEndpoint {
  url: string;
  key: string;
  /** Which provider answered, for logging and the degraded-mode notice. */
  provider: "openrouter" | "vercel-gateway";
}

/** The default model, when a route does not name its own. */
export const DEFAULT_MODEL = "anthropic/claude-opus-5";

/** The gateway's URL, also the honest default when nothing is configured. */
const GATEWAY_URL = "https://ai-gateway.vercel.sh/v1/chat/completions";

export function aiEndpoint(): AiEndpoint | null {
  const openrouter = process.env.OPENROUTER_API_KEY;
  if (openrouter)
    return {
      url: "https://openrouter.ai/api/v1/chat/completions",
      key: openrouter,
      provider: "openrouter",
    };

  // VERCEL_OIDC_TOKEN authenticates to the gateway only — it is meaningless to
  // OpenRouter, which is why it is checked here and not above.
  const gateway = process.env.AI_GATEWAY_API_KEY || process.env.VERCEL_OIDC_TOKEN;
  if (gateway) return { url: GATEWAY_URL, key: gateway, provider: "vercel-gateway" };

  return null;
}

/**
 * The chat-completions URL to POST to.
 *
 * Safe at module scope: `process.env` is populated before any module in a Next
 * server runtime evaluates, so `const GATEWAY = aiUrl()` reads the same value a
 * call-time read would.
 */
export function aiUrl(): string {
  return aiEndpoint()?.url ?? GATEWAY_URL;
}

/**
 * The bearer key, or "" when nothing is configured.
 *
 * Empty string rather than null so existing `if (apiKey)` guards keep working
 * unchanged — every caller already has an offline path behind that check.
 */
export function aiKey(): string {
  return aiEndpoint()?.key ?? "";
}

/** True when any provider is configured. */
export function aiConfigured(): boolean {
  return aiEndpoint() !== null;
}
