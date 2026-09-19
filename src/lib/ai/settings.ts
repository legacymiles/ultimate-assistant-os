import "server-only";
import path from "node:path";
import { readDoc, writeDoc } from "@/lib/server/docStore";
import { DEFAULT_FALLBACKS } from "./models";

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
  /**
   * The LLM every app uses for its general AI calls, or null for each app's
   * own default. Apps that need a specialist (an image painter, a model that
   * listens to audio) keep theirs.
   */
  model: string | null;
  /** Tried in order when the chosen model fails (down, unsupported request, can't read the images). */
  fallbackModels: string[];
  builder: BuilderRoute;
  /** Claude plan failed (limit, credit, login) → retry that build through OpenRouter. */
  builderFallback: boolean;
  lastError: Partial<Record<ProviderId, ProviderEvent>>;
  lastOk: Partial<Record<ProviderId, string>>;
}

export const DEFAULT_SETTINGS: AiSettings = {
  choice: "auto",
  fallback: true,
  model: null,
  fallbackModels: DEFAULT_FALLBACKS,
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

/**
 * "vendor/model[:variant]" or null. OpenRouter's rolling aliases start with
 * "~" ("~openai/gpt-sol-latest") — those are valid picks too.
 */
export function modelId(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const id = v.trim();
  return id.length <= 160 && /^~?[\w.-]+\/[\w.:+~@-]+$/.test(id) ? id : null;
}

function normalise(raw: Partial<AiSettings> | null): AiSettings {
  const r = raw ?? {};
  return {
    choice: r.choice === "openrouter" || r.choice === "vercel-gateway" ? r.choice : "auto",
    fallback: r.fallback !== false,
    model: modelId(r.model),
    fallbackModels: Array.isArray(r.fallbackModels)
      ? r.fallbackModels.map(modelId).filter((m): m is string => Boolean(m)).slice(0, 3)
      : DEFAULT_FALLBACKS,
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

// The owner's choices and the providers' health live in SEPARATE documents.
// Health is written by every serverless instance whenever a call succeeds or
// fails; if it shared the choices document, one instance's stale copy could
// overwrite a model the owner had just picked.
const HEALTH_DOC = "ai-health";
type Health = Pick<AiSettings, "lastError" | "lastOk">;
type Choices = Omit<AiSettings, "lastError" | "lastOk">;

export async function loadSettings(force = false): Promise<AiSettings> {
  if (!force && Date.now() - loadedAt < TTL_MS) return cached;
  loading ??= Promise.all([readDoc<AiSettings>(DOC, dataDir()), readDoc<Health>(HEALTH_DOC, dataDir()).catch(() => null)])
    .then(([doc, health]) => {
      // A read error comes back as null: keep what we had rather than reset to defaults.
      if (doc === null && loadedAt > 0) return cached;
      cached = normalise({ ...doc, ...(health ?? {}) });
      loadedAt = Date.now();
      return cached;
    })
    .catch(() => cached)
    .finally(() => {
      loading = null;
    });
  return loading;
}

function choicesOf(s: AiSettings): Choices {
  const { lastError: _e, lastOk: _o, ...choices } = s;
  void _e;
  void _o;
  return choices;
}

let chain: Promise<unknown> = Promise.resolve();

export function saveSettings(patch: Partial<Pick<AiSettings, "choice" | "fallback" | "model" | "fallbackModels" | "builder" | "builderFallback">>) {
  const run = chain.then(async (): Promise<AiSettings | null> => {
    const stored = await readDoc<AiSettings>(DOC, dataDir()).catch(() => null);
    // Never build a save on top of defaults because one read failed.
    const base = stored ?? (loadedAt > 0 ? cached : null);
    const next = normalise({ ...(base ?? {}), ...patch, lastError: cached.lastError, lastOk: cached.lastOk });
    const saved = await writeDoc(DOC, dataDir(), choicesOf(next));
    if (!saved) return null;
    cached = next;
    loadedAt = Date.now();
    return next;
  });
  chain = run.catch(() => undefined);
  return run;
}

async function mutateHealth(fn: (h: Health) => void): Promise<void> {
  const run = chain.then(async () => {
    const stored = await readDoc<Health>(HEALTH_DOC, dataDir()).catch(() => null);
    const h: Health = { lastError: { ...(stored?.lastError ?? {}) }, lastOk: { ...(stored?.lastOk ?? {}) } };
    fn(h);
    await writeDoc(HEALTH_DOC, dataDir(), h);
  });
  chain = run.catch(() => undefined);
  return run;
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
  void mutateHealth((h) => {
    h.lastError[provider] = { ...event, message: event.message.slice(0, 300), at: new Date().toISOString() };
  }).catch(() => {});
}

export function recordOk(provider: ProviderId): void {
  const had = cached.lastError[provider];
  const lastError = { ...cached.lastError };
  delete lastError[provider];
  cached = { ...cached, lastError, lastOk: { ...cached.lastOk, [provider]: new Date().toISOString() } };
  // A success after an error clears the error right away; otherwise throttle.
  if (!had && throttled(`ok:${provider}`)) return;
  void mutateHealth((h) => {
    h.lastOk[provider] = new Date().toISOString();
    delete h.lastError[provider];
  }).catch(() => {});
}
