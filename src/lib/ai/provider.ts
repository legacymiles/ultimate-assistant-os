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
// million for Opus 5. The owner can pick either one on the hub's front page
// (the AI panel, src/lib/ai/settings.ts); `aiFetch` also retries on the other
// provider when the chosen one is out of credit, rate-limited or down.
//
// The MODEL is the owner's pick too: every call that asks for the hub's general
// model (DEFAULT_MODEL) is sent to the model chosen on the front page, then to
// their fallback models if it fails — so no app depends on any one vendor.
//
// Returning null (rather than throwing) is deliberate: every caller already has
// an offline path, and a missing key must degrade visibly rather than 500.
// ---------------------------------------------------------------------------

import { canRead, mediaIn } from "./models";
import { cachedSettings, loadSettings, recordError, recordOk, type ProviderId } from "./settings";

export interface AiEndpoint {
  url: string;
  key: string;
  /** Which provider answered, for logging and the degraded-mode notice. */
  provider: ProviderId;
}

/** The default model, when a route does not name its own. */
export const DEFAULT_MODEL = "anthropic/claude-opus-5";

/** The gateway's URL, also the honest default when nothing is configured. */
const GATEWAY_URL = "https://ai-gateway.vercel.sh/v1/chat/completions";

/** One provider's endpoint, or null when its key is not set. */
export function endpointFor(provider: ProviderId): AiEndpoint | null {
  if (provider === "openrouter") {
    const key = process.env.OPENROUTER_API_KEY;
    return key ? { url: "https://openrouter.ai/api/v1/chat/completions", key, provider } : null;
  }
  // VERCEL_OIDC_TOKEN authenticates to the gateway only — it is meaningless to
  // OpenRouter, which is why it is read here and not above.
  const key = process.env.AI_GATEWAY_API_KEY || process.env.VERCEL_OIDC_TOKEN;
  return key ? { url: GATEWAY_URL, key, provider } : null;
}

/**
 * The endpoint to use: the one the owner picked on the hub's front page when it
 * has a key, else OpenRouter, else the gateway. A pick without a key falls back
 * rather than failing, so a half-configured deploy still answers.
 */
export function aiEndpoint(): AiEndpoint | null {
  const { choice } = cachedSettings();
  if (choice !== "auto") {
    const picked = endpointFor(choice);
    if (picked) return picked;
  }
  return endpointFor("openrouter") ?? endpointFor("vercel-gateway");
}

/** The other provider, when fallback is on and it has a key. */
function fallbackFor(primary: AiEndpoint): AiEndpoint | null {
  if (!cachedSettings().fallback) return null;
  return endpointFor(primary.provider === "openrouter" ? "vercel-gateway" : "openrouter");
}

/** Worth retrying elsewhere: bad key, no credit, rate limit, outage. Not a bad request. */
function retryable(status: number): boolean {
  return status === 401 || status === 402 || status === 403 || status === 429 || status >= 500;
}

async function describe(res: Response): Promise<string> {
  const text = await res
    .clone()
    .text()
    .catch(() => "");
  let message = text;
  try {
    const body = JSON.parse(text) as { error?: { message?: string } | string; message?: string };
    message = (typeof body.error === "string" ? body.error : body.error?.message) ?? body.message ?? text;
  } catch {}
  return `${res.status} ${message.replace(/\s+/g, " ").slice(0, 240)}`.trim();
}

/**
 * POST a chat-completions request to the chosen provider, and when it fails
 * for a reason another provider would not share (no credit, bad key, rate
 * limit, outage), send the same request to the other one. Both speak the same
 * shape and model ids, so the body goes through unchanged.
 *
 * Pass what you would pass to fetch, minus the URL; the Authorization header is
 * set here. Returns the last Response either way, so callers keep their own
 * `res.ok` handling. With no provider configured it returns a 503 whose body
 * says so, rather than throwing.
 */
export async function aiFetch(init: RequestInit = {}): Promise<Response> {
  await loadSettings();
  const primary = aiEndpoint();
  if (!primary) {
    return Response.json(
      { error: { message: "No AI provider is configured. Set OPENROUTER_API_KEY or AI_GATEWAY_API_KEY." } },
      { status: 503 },
    );
  }

  const attempt = async (ep: AiEndpoint, body: BodyInit | null | undefined): Promise<Response | Error> => {
    const headers = new Headers(init.headers);
    headers.set("Authorization", `Bearer ${ep.key}`);
    if (!headers.has("Content-Type")) headers.set("Content-Type", "application/json");
    if (ep.provider === "openrouter" && !headers.has("HTTP-Referer")) {
      headers.set("HTTP-Referer", process.env.OPENROUTER_SITE_URL || "https://ultimate-assistant-os.vercel.app");
      headers.set("X-Title", "Ultimate Assistant OS");
    }
    try {
      const res = await fetch(ep.url, { ...init, body, method: init.method ?? "POST", headers });
      if (res.ok) recordOk(ep.provider);
      else if (retryable(res.status)) recordError(ep.provider, { status: res.status, message: await describe(res) });
      return res;
    } catch (err) {
      // A caller's own abort is not the provider's fault.
      if ((err as Error).name === "AbortError") throw err;
      recordError(ep.provider, { message: `Network error: ${(err as Error).message}` });
      return err as Error;
    }
  };

  /** One model: the chosen provider, then the other one when the failure is the provider's. */
  const viaProviders = async (body: BodyInit | null | undefined): Promise<Response | Error> => {
    const first = await attempt(primary, body);
    if (first instanceof Response && (first.ok || !retryable(first.status))) return first;
    const second = fallbackFor(primary);
    if (second) {
      const again = await attempt(second, body);
      if (again instanceof Response) return again;
    }
    return first;
  };

  const chain = await modelChain(init.body);
  if (!chain) {
    const res = await viaProviders(init.body);
    if (res instanceof Error) throw res;
    return res;
  }

  // The owner's model, then their fallback models: a model that is down, out
  // of capacity or can't take this request hands it to the next one.
  let last: Response | Error = new Error("No model answered.");
  for (const model of chain.models) {
    const res = await viaProviders(JSON.stringify({ ...chain.body, model }));
    if (res instanceof Response && (res.ok || res.status === 413)) return res;
    last = res;
  }
  if (last instanceof Error) throw last;
  return last;
}

/**
 * The models to try for a request, or null to send it untouched. Calls asking
 * for the hub's general model (DEFAULT_MODEL, AI_MODEL, or any Claude model an
 * app hard-coded) follow the owner's pick; a route that names a specialist —
 * an image painter, an audio listener, a web-search model — keeps it. Models that can't read the request's images or audio
 * are skipped.
 */
async function modelChain(raw: BodyInit | null | undefined): Promise<{ body: Record<string, unknown>; models: string[] } | null> {
  if (typeof raw !== "string") return null;
  let body: Record<string, unknown>;
  try {
    body = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return null;
  }
  const asked = typeof body.model === "string" ? body.model : "";
  const general = asked === DEFAULT_MODEL || asked === process.env.AI_MODEL || asked.startsWith("anthropic/");
  if (!general) return null;
  const { model, fallbackModels } = cachedSettings();
  const wanted = [...new Set([model ?? asked, ...fallbackModels])];
  const need = mediaIn(body);
  const readable: string[] = [];
  for (const m of wanted) if (await canRead(m, need).catch(() => true)) readable.push(m);
  return { body, models: (readable.length ? readable : wanted).slice(0, 3) };
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
