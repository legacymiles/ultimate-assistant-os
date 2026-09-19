import "server-only";
import path from "node:path";
import { readDoc, writeDoc } from "@/lib/server/docStore";

// ---------------------------------------------------------------------------
// The owner's AI switchboard, chosen on the hub's front page.
//
// One server document, so the choice follows the owner across devices and
// every serverless instance agrees on it. Instances cache it for a few seconds;
// a switch takes effect on the next AI call after that.
//
// It also keeps the last error (and last success) each provider produced, so
// the status panel can say "OpenRouter: out of credit" instead of every app
// failing in its own words.
// ---------------------------------------------------------------------------

export type ProviderId = "openrouter" | "vercel-gateway";
/** "auto" = OpenRouter when it has a key, else the Vercel gateway. */
export type ProviderChoice = "auto" | ProviderId;
/** What drives Game Creator builds on the PC: the Claude plan (CLI login) or OpenRouter. */
export type BuilderRoute = "plan" | "openrouter";

export interface ProviderEvent {
  at: string;
  status?: number;
  message: string;
}

export interface AiSettings {
  choice: ProviderChoice;
  /** On a failed call (no credit, bad key, rate limit, outage), retry on the other provider. */
  fallback: boolean;
  builder: BuilderRoute;
  /** Claude plan failed (limit, credit, login) → retry that build through OpenRouter. */
  builderFallback: boolean;
  lastError: Partial<Record<ProviderId, ProviderEvent>>;
  lastOk: Partial<Record<ProviderId, string>>;
}

export const DEFAULT_SETTINGS: AiSettings = {
  choice: "auto",
  fallback: true,
  builder: "plan",
  builderFallback: true,
  lastError: {},
  lastOk: {},
};

const DOC = "ai-settings";
const TTL_MS = 10_000;

function dataDir(): string {
  return process.env.AI_SETTINGS_DATA_DIR || path.resolve(".data");
}

let cached: AiSettings = DEFAULT_SETTINGS;
let loadedAt = 0;
let loading: Promise<AiSettings> | null = null;

function normalise(raw: Partial<AiSettings> | null): AiSettings {
  const r = raw ?? {};
  return {
    choice: r.choice === "openrouter" || r.choice === "vercel-gateway" ? r.choice : "auto",
    fallback: r.fallback !== false,
    builder: r.builder === "openrouter" ? "openrouter" : "plan",
    builderFallback: r.builderFallback !== false,
    lastError: r.lastError ?? {},
    lastOk: r.lastOk ?? {},
  };
}

/** The last-loaded settings. Synchronous, for code that cannot await. */
export function cachedSettings(): AiSettings {
  return cached;
}

export async function loadSettings(force = false): Promise<AiSettings> {
  if (!force && Date.now() - loadedAt < TTL_MS) return cached;
  loading ??= readDoc<AiSettings>(DOC, dataDir())
    .then((doc) => {
      cached = normalise(doc);
      loadedAt = Date.now();
      return cached;
    })
    .catch(() => cached)
    .finally(() => {
      loading = null;
    });
  return loading;
}

let chain: Promise<unknown> = Promise.resolve();

async function mutate(fn: (s: AiSettings) => void): Promise<AiSettings | null> {
  const run = chain.then(async () => {
    // Read the stored copy directly: going through loadSettings would replace
    // `cached` mid-write and drop in-memory health not yet saved.
    const s = normalise(await readDoc<AiSettings>(DOC, dataDir()).catch(() => cached));
    const next = { ...s, lastError: { ...s.lastError }, lastOk: { ...s.lastOk } };
    fn(next);
    const saved = await writeDoc(DOC, dataDir(), next);
    cached = next;
    loadedAt = Date.now();
    return saved ? next : null;
  });
  chain = run.catch(() => undefined);
  return run;
}

export function saveSettings(patch: Partial<Pick<AiSettings, "choice" | "fallback" | "builder" | "builderFallback">>) {
  return mutate((s) => {
    Object.assign(s, normalise({ ...s, ...patch }), { lastError: s.lastError, lastOk: s.lastOk });
  });
}

// Health writes are throttled per provider: a burst of failing calls should
// cost one document write, not one each.
const lastWrite: Partial<Record<string, number>> = {};
function throttled(key: string): boolean {
  const now = Date.now();
  if (now - (lastWrite[key] ?? 0) < 30_000) return true;
  lastWrite[key] = now;
  return false;
}

export function recordError(provider: ProviderId, event: Omit<ProviderEvent, "at">): void {
  cached = { ...cached, lastError: { ...cached.lastError, [provider]: { ...event, at: new Date().toISOString() } } };
  if (throttled(`err:${provider}`)) return;
  void mutate((s) => {
    s.lastError[provider] = { ...event, message: event.message.slice(0, 300), at: new Date().toISOString() };
  }).catch(() => {});
}

export function recordOk(provider: ProviderId): void {
  const had = cached.lastError[provider];
  const lastError = { ...cached.lastError };
  delete lastError[provider];
  cached = { ...cached, lastError, lastOk: { ...cached.lastOk, [provider]: new Date().toISOString() } };
  // A success after an error clears the error right away; otherwise throttle.
  if (!had && throttled(`ok:${provider}`)) return;
  void mutate((s) => {
    s.lastOk[provider] = new Date().toISOString();
    delete s.lastError[provider];
  }).catch(() => {});
}
