// ---------------------------------------------------------------------------
// The circuit breaker, and the status the dashboard reads.
//
// Why a breaker and not just a try/catch chain: when the laptop is asleep, its
// SearXNG is not "down" in a way that fails fast — a connect to an address
// nothing answers at sits there until the timeout. Eight seconds, on every
// single search, before the VPS is even tried. The breaker is what turns that
// into eight seconds once, then straight to the VPS for the next minute.
//
// State lives in module memory, deliberately. It is per-instance and resets on
// a cold start, which is correct: the breaker is a latency optimisation, and a
// fresh instance SHOULD re-probe rather than inherit someone else's verdict.
// Putting it in Supabase would make a laptop that came back online stay
// written off until a row expired.
// ---------------------------------------------------------------------------

import {
  SEARCH_LIMITS,
  allEndpoints,
  duckduckgoConfigured,
  searxngEndpoints,
  tavilyConfigured,
} from "./config";
import type { ProviderEndpoint, ProviderId } from "./config";
import { providerById } from "./providers";
import type { ProviderStatus, SearchKind } from "./types";

interface BreakerState {
  failures: number;
  openUntil: number;
  lastError: string | null;
  lastOkAt: number | null;
  lastLatencyMs: number | null;
}

const breakers = new Map<string, BreakerState>();

function keyOf(endpoint: ProviderEndpoint): string {
  return `${endpoint.provider}:${endpoint.url ?? "default"}`;
}

function stateOf(endpoint: ProviderEndpoint): BreakerState {
  const key = keyOf(endpoint);
  const existing = breakers.get(key);
  if (existing) return existing;
  const fresh: BreakerState = {
    failures: 0,
    openUntil: 0,
    lastError: null,
    lastOkAt: null,
    lastLatencyMs: null,
  };
  breakers.set(key, fresh);
  return fresh;
}

/** True when this endpoint is being skipped right now. */
export function isOpen(endpoint: ProviderEndpoint): boolean {
  return stateOf(endpoint).openUntil > Date.now();
}

export function recordSuccess(endpoint: ProviderEndpoint, latencyMs: number): void {
  const state = stateOf(endpoint);
  state.failures = 0;
  state.openUntil = 0;
  state.lastError = null;
  state.lastOkAt = Date.now();
  state.lastLatencyMs = latencyMs;
}

export function recordFailure(endpoint: ProviderEndpoint, error: string): void {
  const state = stateOf(endpoint);
  state.failures += 1;
  state.lastError = error;
  if (state.failures >= SEARCH_LIMITS.breakerThreshold) {
    state.openUntil = Date.now() + SEARCH_LIMITS.breakerCooldownMs;
  }
}

/**
 * Let one probe through a tripped breaker.
 *
 * Without this, a breaker that trips at the same moment the laptop wakes stays
 * tripped for the full cooldown with nothing ever testing it. Half-open is the
 * standard answer: once the cooldown passes, the next request tries it for
 * real, and either closes the breaker or re-opens it for another cooldown.
 */
export function halfOpen(endpoint: ProviderEndpoint): void {
  const state = stateOf(endpoint);
  state.openUntil = 0;
  state.failures = Math.max(0, SEARCH_LIMITS.breakerThreshold - 1);
}

/** Only for tests, which must not inherit another test's breaker. */
export function resetBreakers(): void {
  breakers.clear();
}

export function breakerSnapshot(endpoint: ProviderEndpoint): {
  failures: number;
  openUntil: string | null;
  lastError: string | null;
  lastOkAt: string | null;
  lastLatencyMs: number | null;
} {
  const state = stateOf(endpoint);
  return {
    failures: state.failures,
    openUntil: state.openUntil > Date.now() ? new Date(state.openUntil).toISOString() : null,
    lastError: state.lastError,
    lastOkAt: state.lastOkAt ? new Date(state.lastOkAt).toISOString() : null,
    lastLatencyMs: state.lastLatencyMs,
  };
}

/**
 * What to tell the owner about a provider that is not switched on. One row per
 * provider, so the dashboard lists what COULD be in the chain rather than only
 * what is — a missing fallback should be visible, not invisible.
 */
const NOT_CONFIGURED: { provider: ProviderId; label: string; priority: number; envVar: string; detail: string; kinds: SearchKind[] }[] = [
  {
    provider: "searxng",
    label: "SearXNG",
    priority: 20,
    envVar: "SEARXNG_URL",
    kinds: ["web", "news", "research"],
    detail:
      "No instance configured. Set SEARXNG_URL to your VPS instance, and SEARXNG_LOCAL_URL if you also run one here.",
  },
  {
    provider: "duckduckgo",
    label: "DuckDuckGo",
    priority: 50,
    envVar: "SEARCH_ENABLE_DUCKDUCKGO",
    kinds: ["web", "research"],
    detail: "Turned off by SEARCH_ENABLE_DUCKDUCKGO=false. Remove that to use it as a keyless fallback.",
  },
  {
    provider: "tavily",
    label: "Tavily",
    priority: 100,
    envVar: "TAVILY_API_KEY",
    kinds: ["web", "news", "research"],
    detail:
      "No key. Set TAVILY_API_KEY to have a fallback for when every self-hosted instance is unreachable, and the better engine for deep research.",
  },
];

/**
 * Status of every provider instance, for the dashboard.
 *
 * `probe` costs real calls — one search per SearXNG instance, and one paid
 * credit for Tavily — so the dashboard polls with `probe: false` and only
 * probes when a person presses Check now. With `probe: false` the state is
 * whatever the last real search learned, which is the honest answer and free.
 *
 * `probeTavily` is separate because Tavily's probe is the only one that costs
 * money. Tavily is always LISTED either way: leaving it out of the list when
 * it isn't being probed would make a configured fallback look like a missing
 * one, which is the opposite of what this page is for.
 */
export async function providerStatuses(
  options: { probe?: boolean; probeTavily?: boolean } = {},
): Promise<ProviderStatus[]> {
  const { probe = false, probeTavily = false } = options;
  const out: ProviderStatus[] = [];

  const endpoints: ProviderEndpoint[] = allEndpoints();
  const live = new Set(endpoints.map((endpoint) => endpoint.provider));
  const configuredByProvider: Record<ProviderId, boolean> = {
    searxng: searxngEndpoints().length > 0,
    duckduckgo: duckduckgoConfigured(),
    tavily: tavilyConfigured(),
  };

  const probes = await Promise.all(
    endpoints.map(async (endpoint) => {
      const snapshot = breakerSnapshot(endpoint);
      const probeThis = probe && (endpoint.provider !== "tavily" || probeTavily);
      if (!probeThis) return { endpoint, snapshot, probed: false as const };
      const adapter = providerById(endpoint.provider);
      if (!adapter) return { endpoint, snapshot, probed: false as const };
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), SEARCH_LIMITS.providerTimeoutMs);
      const started = Date.now();
      try {
        await adapter.health(endpoint, controller.signal);
        const ms = Date.now() - started;
        recordSuccess(endpoint, ms);
        return { endpoint, snapshot: breakerSnapshot(endpoint), probed: true as const, ok: true, ms };
      } catch (error) {
        const ms = Date.now() - started;
        const message = toMessage(error, endpoint);
        recordFailure(endpoint, message);
        return {
          endpoint,
          snapshot: breakerSnapshot(endpoint),
          probed: true as const,
          ok: false,
          ms,
          message,
        };
      } finally {
        clearTimeout(timer);
      }
    }),
  );

  for (const entry of probes) {
    const { endpoint, snapshot } = entry;
    const adapter = providerById(endpoint.provider);
    let state: ProviderStatus["state"];
    let detail: string | null;

    if (entry.probed) {
      state = entry.ok ? "up" : "down";
      detail = entry.ok ? null : entry.message ?? "The probe failed.";
    } else if (snapshot.openUntil) {
      state = "open";
      detail = `Skipped until ${new Date(snapshot.openUntil).toLocaleTimeString()} after ${snapshot.failures} failures. Last reason: ${snapshot.lastError ?? "unknown"}`;
    } else if (snapshot.lastOkAt) {
      state = "up";
      detail = null;
    } else if (snapshot.lastError) {
      state = "down";
      detail = snapshot.lastError;
    } else {
      // Configured, never used yet. Not a problem, and not a claim that it works.
      state = "up";
      detail = "Configured. Not called yet since this server started — press Check now to probe it.";
    }

    out.push({
      provider: endpoint.provider,
      label: endpoint.label,
      endpoint: endpoint.url,
      location: endpoint.location,
      configured: true,
      state,
      latencyMs: entry.probed ? entry.ms : snapshot.lastLatencyMs,
      detail,
      failures: snapshot.failures,
      openUntil: snapshot.openUntil,
      priority: endpoint.priority,
      kinds: adapter?.kinds ?? (["web", "news", "research"] as SearchKind[]),
      envVar: adapter?.envVar ?? "",
    });
  }

  // Then every provider that is NOT switched on, so the page shows the whole
  // menu rather than only the part already wired.
  for (const missing of NOT_CONFIGURED) {
    if (live.has(missing.provider) || configuredByProvider[missing.provider]) continue;
    out.push({
      provider: missing.provider,
      label: missing.label,
      endpoint: null,
      location: missing.provider === "searxng" ? null : "cloud",
      configured: false,
      state: "unconfigured",
      latencyMs: null,
      detail: missing.detail,
      failures: 0,
      openUntil: null,
      priority: missing.priority,
      kinds: missing.kinds,
      envVar: missing.envVar,
    });
  }

  return out.sort((a, b) => a.priority - b.priority);
}

/**
 * A fetch failure in words an owner can act on.
 *
 * Node's undici errors are the worst offenders here: a sleeping laptop gives
 * you `fetch failed` with the real reason two `cause` levels down, and
 * `ECONNREFUSED` means something completely different from `ETIMEDOUT` when
 * you are trying to work out whether the VPS is up or the port is wrong.
 */
export function toMessage(error: unknown, endpoint?: ProviderEndpoint): string {
  const where = endpoint?.url ?? endpoint?.label ?? "the provider";
  if (error instanceof Error) {
    if (error.name === "AbortError" || error.name === "TimeoutError") {
      return `${where} did not answer within ${Math.round(SEARCH_LIMITS.providerTimeoutMs / 1000)}s.`;
    }
    const cause = (error as { cause?: unknown }).cause;
    const code =
      cause && typeof cause === "object" && "code" in cause
        ? String((cause as { code: unknown }).code)
        : null;
    switch (code) {
      case "ECONNREFUSED":
        return `Nothing is listening at ${where}. Is SearXNG running, and on that port?`;
      case "ENOTFOUND":
      case "EAI_AGAIN":
        return `${where} could not be resolved. Check the hostname.`;
      case "ETIMEDOUT":
      case "UND_ERR_CONNECT_TIMEOUT":
        return `${where} timed out while connecting — usually the machine is off or asleep, or a firewall is dropping the connection.`;
      case "CERT_HAS_EXPIRED":
        return `${where} has an expired TLS certificate.`;
      case "DEPTH_ZERO_SELF_SIGNED_CERT":
      case "SELF_SIGNED_CERT_IN_CHAIN":
        return `${where} is using a self-signed certificate. Use http:// on a private network, or give it a real certificate.`;
      default:
        break;
    }
    return error.message || `${where} failed for an unknown reason.`;
  }
  return `${where} failed: ${String(error)}`;
}
