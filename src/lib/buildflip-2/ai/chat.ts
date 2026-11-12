import { DEFAULT_MODEL, aiConfigured as hubAiConfigured, aiEndpoint, aiFetch, describeFailure } from "@/lib/ai/provider";
import { log } from "../log";

/**
 * The planning model, two jobs:
 *  1. reason over the user's idea (vision + text) to produce a build spec
 *  2. search the live web for current prices and completed sales, with the
 *     URL citations that let every number show its source
 *
 * Moved into the hub: this used to be BuildFlip's own OpenRouter client with
 * its own key, model names and retry ladder. All of that now belongs to
 * `src/lib/ai/provider.ts` — one door for every AI call on this hub. `aiFetch`
 * picks the provider, picks the model (and the retries behind it when the first
 * refuses), and records what the call cost in the hub's spend ledger under this
 * app's name. So what is left here is the shape of the request and the reading
 * of the answer.
 *
 * Nothing here throws on a missing key: the caller drops to the bundled demo
 * catalog and says so on the plan (R4).
 */

export interface Citation {
  url: string;
  title?: string;
}

export interface ChatImage {
  /** data: URL or https URL. */
  url: string;
}

export interface ChatOptions {
  system: string;
  user: string;
  images?: ChatImage[];
  /** Turn on live web search with N results. Costs money per call. */
  webSearchResults?: number;
  maxTokens?: number;
  temperature?: number;
  timeoutMs?: number;
  signal?: AbortSignal;
}

export interface ChatResult {
  text: string;
  citations: Citation[];
  /**
   * Always 0 now. The hub's ledger (src/lib/ai/spend.ts) does the accounting
   * from the provider's own usage block, so a second figure measured here would
   * be a duplicate — and `aiFetch` does not hand the body's usage back. Kept on
   * the type because the generator reports a per-plan cost and 0 reads honestly
   * as "counted somewhere else", where a guess would not.
   */
  costUsd: number;
  model: string;
}

export class AiUnavailableError extends Error {
  constructor(message = "The planning model isn't reachable right now.") {
    super(message);
    this.name = "AiUnavailableError";
  }
}

export function aiConfigured() {
  return hubAiConfigured();
}

/**
 * One request, through the hub's provider.
 *
 * The web-search plugin is OpenRouter's, not a standard chat-completions field,
 * so it is only attached when OpenRouter is the endpoint in use — the same rule
 * the hub's own web search follows (src/app/api/new-jarvis/web/route.ts). If
 * OpenRouter then fails for a reason `aiFetch` retries elsewhere, the gateway
 * rejects the unknown field and this call fails; the caller falls back to the
 * demo catalog and labels every number that came from it, which is the honest
 * answer rather than silently pricing a build off nothing.
 */
export async function chat(opts: ChatOptions): Promise<ChatResult> {
  if (!aiConfigured()) throw new AiUnavailableError("No AI key is configured.");

  const content: unknown[] = [{ type: "text", text: opts.user }];
  for (const img of opts.images ?? []) {
    content.push({ type: "image_url", image_url: { url: img.url } });
  }

  const body: Record<string, unknown> = {
    // The sentinel, not a destination: provider.ts sends this to whichever
    // model the owner picked on the hub's front page, or lets its router choose.
    model: DEFAULT_MODEL,
    task: { app: "buildflip-2", difficulty: "hard" },
    messages: [
      { role: "system", content: opts.system },
      { role: "user", content: opts.images?.length ? content : opts.user },
    ],
    max_tokens: opts.maxTokens ?? 8000,
    temperature: opts.temperature ?? 0.2,
  };
  if (opts.webSearchResults && aiEndpoint()?.provider === "openrouter") {
    body.plugins = [{ id: "web", max_results: opts.webSearchResults }];
  }

  const timeoutMs = opts.timeoutMs ?? 90_000;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const onAbort = () => controller.abort();
  opts.signal?.addEventListener("abort", onAbort);

  try {
    const res = await aiFetch({ body: JSON.stringify(body), signal: controller.signal });

    if (!res.ok) {
      const detail = await describeFailure(res);
      await log({ level: "warn", event: "ai_http_error", message: `${res.status}`, meta: { detail } });
      throw new AiUnavailableError(
        res.status === 429
          ? "The pricing search is rate-limited right now. Give it a minute and try again."
          : res.status === 402
            ? "The AI account is out of credit, so live prices are unavailable."
            : `The planning model answered with ${res.status}. Try again in a moment.`,
      );
    }

    const json = (await res.json()) as {
      choices?: {
        message?: {
          content?: string;
          annotations?: { type?: string; url_citation?: { url?: string; title?: string } }[];
        };
      }[];
      model?: string;
      error?: { message?: string };
    };

    if (json.error) throw new AiUnavailableError(json.error.message);

    const message = json.choices?.[0]?.message;
    const citations: Citation[] = [];
    const seen = new Set<string>();
    for (const a of message?.annotations ?? []) {
      const url = a.url_citation?.url;
      if (!url || seen.has(url)) continue;
      seen.add(url);
      citations.push({ url, title: a.url_citation?.title });
    }

    return {
      text: message?.content ?? "",
      citations,
      costUsd: 0,
      model: json.model ?? "",
    };
  } finally {
    clearTimeout(timer);
    opts.signal?.removeEventListener("abort", onAbort);
  }
}

/**
 * Pull the first JSON object or array out of a model response, tolerating
 * ```json fences and leading prose.
 */
export function extractJson<T>(text: string): T {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const candidate = (fenced?.[1] ?? text).trim();

  const tryParse = (s: string): T | null => {
    try {
      return JSON.parse(s) as T;
    } catch {
      return null;
    }
  };

  const direct = tryParse(candidate);
  if (direct !== null) return direct;

  for (const [open, close] of [
    ["{", "}"],
    ["[", "]"],
  ] as const) {
    const start = candidate.indexOf(open);
    const end = candidate.lastIndexOf(close);
    if (start !== -1 && end > start) {
      const slice = tryParse(candidate.slice(start, end + 1));
      if (slice !== null) return slice;
    }
  }
  throw new Error("The model's answer wasn't readable. Trying again usually fixes it.");
}
