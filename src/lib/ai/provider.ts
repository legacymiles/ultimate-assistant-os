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

import { DEFAULT_FALLBACKS, canRead, mediaIn } from "./models";
import { planRoute, readRequest, type RoutePlan, type TaskHint } from "./router";
import { cachedSettings, loadSettings, recordError, recordOk, type ProviderId } from "./settings";
import { recordCall, usageOf, type RawUsage } from "./spend";
import { spendKey, type RouteTier } from "@/lib/skills/spend";
import { routeSkill } from "@/lib/skills/server/routeSkill";
import { troubleBody, type Attempt } from "./trouble";
import { markRefused, skipCooling } from "./cooldown";

export interface AiEndpoint {
  url: string;
  key: string;
  /** Which provider answered, for logging and the degraded-mode notice. */
  provider: ProviderId;
}

/**
 * What a route names when it wants "the hub's general model".
 *
 * It is a SENTINEL, not a destination: `modelChain` below recognises it (along
 * with any other Claude id an app hard-coded) and sends the call to the model
 * the owner picked on the front page instead. Nothing reaches a provider under
 * this id unless the owner picked Opus themselves.
 */
export const DEFAULT_MODEL = "anthropic/claude-opus-5";

/**
 * Where a general call goes when the owner has picked NOTHING.
 *
 * Deliberately not Opus. An unattended default must not be the most expensive
 * model in the catalogue: a picker left untouched, or one read that fails and
 * falls back to the built-in settings, would otherwise spend Opus money on
 * every classify, tag and auto-file call in the hub — which is exactly how $20
 * of OpenRouter credit disappeared into calls nobody chose.
 */
export const UNPICKED_MODEL = DEFAULT_FALLBACKS[0];

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
/** Builds the body for one attempt, which depends on which provider is taking it. */
type BodyFor = (ep: AiEndpoint) => BodyInit | null | undefined;

export async function aiFetch(init: RequestInit = {}): Promise<Response> {
  await loadSettings();
  const primary = aiEndpoint();
  if (!primary) {
    return Response.json(
      { error: { message: "No AI provider is configured. Set OPENROUTER_API_KEY or AI_GATEWAY_API_KEY." } },
      { status: 503 },
    );
  }

  // Which model and provider actually answered, for the ledger. One row per
  // aiFetch, not one per attempt: an app made ONE call, and a 402 retried across
  // three models and two providers is still that one call. Recording each
  // attempt would bury a day's real spending under a wall of failures.
  let usedModel = "";
  let usedProvider: ProviderId = primary.provider;
  // Every refusal, in order, so a failure can say which models were tried and
  // what each one actually said. Without this the caller sees only the LAST
  // attempt, which after routing is rarely the one that explains anything.
  const attempts: Attempt[] = [];

  // The body is built PER ATTEMPT, not once per model, because the two providers
  // do not take the same body: `usage: {include: true}` is OpenRouter's alone.
  // Serialising it up front and reusing it across a fallback sent that flag to
  // the gateway, and then dropped it from the next OpenRouter call — quietly
  // losing the per-call cost that the whole ledger depends on.
  const attempt = async (ep: AiEndpoint, bodyFor: BodyFor): Promise<Response | Error> => {
    usedProvider = ep.provider;
    const body = bodyFor(ep);
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
      else {
        const message = await describe(res);
        attempts.push({ model: usedModel, provider: ep.provider, status: res.status, message });
        // A refusal that is about the MODEL benches it for a while, so the next
        // call does not pay the same failed request to learn the same thing.
        markRefused(usedModel, res.status, message);
        if (retryable(res.status)) recordError(ep.provider, { status: res.status, message });
      }
      return res;
    } catch (err) {
      // A caller's own abort is not the provider's fault.
      if ((err as Error).name === "AbortError") throw err;
      const message = `Network error: ${(err as Error).message}`;
      attempts.push({ model: usedModel, provider: ep.provider, message });
      recordError(ep.provider, { message });
      return err as Error;
    }
  };

  /** One model: the chosen provider, then the other one when the failure is the provider's. */
  const viaProviders = async (bodyFor: BodyFor): Promise<Response | Error> => {
    const first = await attempt(primary, bodyFor);
    if (first instanceof Response && (first.ok || !retryable(first.status))) return first;
    const second = fallbackFor(primary);
    if (second) {
      const again = await attempt(second, bodyFor);
      if (again instanceof Response) return again;
    }
    return first;
  };

  const call = await planCall(init.body);
  if (!call) {
    // A body this module cannot read (a stream, form data) goes through
    // untouched and uncounted: guessing at its model would put a wrong row in
    // the ledger, which is worse than a missing one.
    const res = await viaProviders(() => init.body);
    if (res instanceof Error) throw res;
    return res;
  }

  // The chosen model, then the retries behind it: a model that is down, out of
  // capacity or cannot take this request hands it to the next one.
  let last: Response | Error = new Error("No model answered.");
  for (const model of call.models) {
    usedModel = model;
    const res = await viaProviders((ep) => sendable(call.body, model, ep.provider));
    if (res instanceof Response && (res.ok || res.status === 413)) {
      const skipped = attempts.map((a) => ({ model: a.model, status: a.status, why: a.message }));
      return meter(res, (usage) =>
        recordCall({ model, provider: usedProvider, usage, plan: call.plan, app: call.app, skipped, skill: call.skill, route: call.route }),
      );
    }
    last = res;
  }
  recordCall({
    model: usedModel || "unknown",
    provider: usedProvider,
    usage: null,
    plan: call.plan,
    app: call.app,
    failed: true,
  });
  return failure(last, attempts);
}

/**
 * The failed response a caller gets: the status that happened, with a body that
 * explains it.
 *
 * The provider's own body is replaced rather than passed along, and that is the
 * point — it is one model's raw JSON, and after routing the useful answer is
 * "all four refused, three for no credit". The original wording survives inside
 * `attempts`, so nothing is lost, and the shape stays `{ error: { message } }`
 * so every existing reader improves without being touched.
 */
function failure(last: Response | Error, attempts: Attempt[]): Response {
  const body = troubleBody(
    attempts.length
      ? attempts
      : [{ model: "", provider: "openrouter" as ProviderId, message: last instanceof Error ? last.message : "No model answered." }],
  );
  // A transport failure has no status of its own; 502 is the honest one for
  // "the thing behind this did not answer".
  const status = last instanceof Response ? last.status : 502;
  return Response.json(body, { status });
}

/**
 * The sentence to show a person when an AI response came back not-ok.
 *
 * Every caller that handles a failed aiFetch should use this rather than dumping
 * the body: it returns the diagnosis when aiFetch wrote one, and falls back to
 * the raw text for a response from somewhere else.
 */
export async function describeFailure(res: Response): Promise<string> {
  const text = await res.text().catch(() => "");
  try {
    const body = JSON.parse(text) as { error?: { message?: string } | string };
    const message = typeof body.error === "string" ? body.error : body.error?.message;
    if (message) return message;
  } catch {}
  return text ? `The AI provider answered ${res.status}: ${text.slice(0, 300)}` : `The AI provider answered ${res.status}.`;
}

/**
 * The body to POST, with the accounting flag this provider understands.
 *
 * `usage: { include: true }` is OpenRouter's, and only OpenRouter's — it is what
 * makes a reply carry the real dollar charge instead of token counts the ledger
 * would have to price itself. It is NOT sent to the gateway: an unknown
 * top-level field forwarded to a strict upstream is a 400, and a spend panel is
 * not worth breaking working calls for. `stream_options` is the standard
 * OpenAI one, so a streamed reply reports its usage on both.
 */
function sendable(body: Record<string, unknown>, model: string, provider: ProviderId): string {
  const out: Record<string, unknown> = { ...body, model };
  if (provider === "openrouter") out.usage = { include: true };
  if (body.stream === true) out.stream_options = { include_usage: true, ...(body.stream_options as object) };
  return JSON.stringify(out);
}

/**
 * Read the usage block out of a reply WITHOUT taking it from the caller.
 *
 * Two shapes, because a streamed reply cannot be cloned and re-read: a normal
 * JSON body is cloned and parsed, while a stream is tee'd — one branch goes to
 * the caller untouched, the other is drained here for the final frame, which is
 * the one carrying usage.
 *
 * Nothing here is awaited. A response must never wait on bookkeeping.
 */
function meter(res: Response, record: (usage: RawUsage | null) => void): Response {
  if (!res.body) {
    record(null);
    return res;
  }
  if (!(res.headers.get("content-type") ?? "").includes("text/event-stream")) {
    res
      .clone()
      .json()
      .then((payload) => record(usageOf(payload)))
      .catch(() => record(null));
    return res;
  }

  const [toCaller, toLedger] = res.body.tee();
  void drain(toLedger, record);
  // content-encoding and content-length describe the ORIGINAL transfer; fetch
  // has already decoded the body, so carrying them onto the new Response invites
  // a second decode downstream and an empty stream.
  const headers = new Headers(res.headers);
  headers.delete("content-encoding");
  headers.delete("content-length");
  return new Response(toCaller, { status: res.status, statusText: res.statusText, headers });
}

/** Walk an SSE stream for the last usage block on it. */
async function drain(stream: ReadableStream<Uint8Array>, record: (usage: RawUsage | null) => void): Promise<void> {
  let found: RawUsage | null = null;
  try {
    const reader = stream.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let bytes = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      // The last piece may be half a line; keep it for the next chunk.
      buffer = lines.pop() ?? "";
      for (const line of lines) {
        const data = line.trim();
        if (!data.startsWith("data:")) continue;
        const json = data.slice(5).trim();
        if (!json || json === "[DONE]") continue;
        try {
          // Parsed whole rather than regexed: OpenRouter's usage block contains
          // nested objects (cost_details), which a brace-matching pattern splits
          // in the wrong place and then fails to parse.
          const usage = usageOf(JSON.parse(json));
          if (usage) found = usage;
        } catch {}
      }
      // A runaway stream must not be held in memory on the ledger's behalf.
      if (bytes > 32_000_000) break;
    }
  } catch {}
  record(found);
}

interface PlannedCall {
  body: Record<string, unknown>;
  /** In order. The first is the destination; the rest are retries. */
  models: string[];
  /** Set only when the router chose, so the ledger can say which rung it was. */
  plan: RoutePlan | null;
  /** Which app asked, when it declared itself. */
  app?: string;
  /** The skill this call runs for, when it said — metered per skill. */
  skill?: string;
  /** Jev's routing for that skill, when it changed the plan. */
  route?: { tier: RouteTier | null; saved: boolean };
}

/**
 * Where a request goes, or null to send it untouched.
 *
 * Three answers, in order of who gets the last word:
 *
 * 1. A ROUTE THAT NAMED A SPECIALIST keeps it. An image painter, an audio
 *    listener, a web-search model: the model IS the point of that surface, and
 *    swapping it would break the feature to save a fraction of a cent.
 *
 * 2. THE OWNER'S PICK on the hub's front page wins over the router. Picking a
 *    model by hand is how you overrule the routing for everything at once, so
 *    the router must not overrule it back.
 *
 * 3. OTHERWISE THE ROUTER decides, from what the request carries. This is the
 *    case that matters, because every general call in the hub arrives here
 *    asking for DEFAULT_MODEL — the Claude sentinel — and nothing reaches Claude
 *    under it unless the owner picked Claude themselves.
 */
async function planCall(raw: BodyInit | null | undefined): Promise<PlannedCall | null> {
  if (typeof raw !== "string") return null;
  let body: Record<string, unknown>;
  try {
    body = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return null;
  }

  // `task` is this hub's own hint to the router, not a provider's parameter, so
  // it is read and then removed before the body goes anywhere.
  const hint = body.task as TaskHint | undefined;
  const app = typeof hint?.app === "string" ? hint.app : undefined;
  const skill = spendKey(hint?.skill) || undefined;
  if ("task" in body) delete body.task;

  const asked = typeof body.model === "string" ? body.model : "";
  const general = asked === DEFAULT_MODEL || asked === process.env.AI_MODEL || asked.startsWith("anthropic/");
  if (!general) return { body, models: [asked], plan: null, app, skill };

  // A surface that carries its own chain — the Studio's Film setup deck — is the
  // owner choosing per film, which outranks both the router and the front-page
  // pick. Models that cannot read what the request carries are still dropped:
  // naming a text-only model does not let it watch a video.
  if (hint?.models?.length) {
    const declared = [...new Set(hint.models)].slice(0, 6);
    const need = mediaIn(body);
    const readable: string[] = [];
    for (const m of declared) if (await canRead(m, need).catch(() => true)) readable.push(m);
    if (readable.length) return { body, models: skipCooling(readable), plan: null, app, skill };
    // Nothing they picked can read this request; the router finds something that
    // can rather than sending it somewhere it is guaranteed to fail.
  }

  const { model, fallbackModels, router } = cachedSettings();

  // The owner's pick, or the old single-default behaviour when they have turned
  // the router off. `asked` is never the destination in either case: it is the
  // sentinel, or a Claude id an app hard-coded years ago.
  if (model || !router) {
    const wanted = [...new Set([model ?? UNPICKED_MODEL, ...fallbackModels])];
    const need = mediaIn(body);
    const readable: string[] = [];
    for (const m of wanted) if (await canRead(m, need).catch(() => true)) readable.push(m);
    return { body, models: (readable.length ? readable : wanted).slice(0, 3), plan: null, app, skill };
  }

  const req = readRequest(hint ? { ...body, task: hint } : body);
  const plan = planRoute(req);
  // A skill run: the owner's pin, its weekly cap, or Jev picks the tier it needs.
  if (skill) {
    const r = await routeSkill(skill, body, req, plan);
    return { body, models: skipCooling(r.models), plan, app, skill, route: { tier: r.tier, saved: r.saved } };
  }
  // The plan is what the rules say; this is what is actually answering today.
  return { body, models: skipCooling(plan.models), plan, app };
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
