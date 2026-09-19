import "server-only";
import { aiEndpoint, endpointFor } from "./provider";
import { loadSettings, type AiSettings, type ProviderEvent, type ProviderId } from "./settings";
import { builderInfo, listGames } from "@/lib/game-creator/store";

// ---------------------------------------------------------------------------
// One answer to "is anything wrong with my AI or my keys?" for the hub's
// front page: which provider is in use, how much credit each has left, the
// last error each produced, whether the Game Creator builder's Claude plan is
// failing, and which optional keys are missing (and what that turns off).
// ---------------------------------------------------------------------------

export type Level = "ok" | "warn" | "error";

export interface ProviderStatus {
  id: ProviderId;
  label: string;
  configured: boolean;
  active: boolean;
  /** Dollars left, when the provider reports it. */
  remaining: number | null;
  lastError?: ProviderEvent;
  lastOk?: string;
  level: Level;
  message: string;
}

export interface KeyStatus {
  name: string;
  set: boolean;
  usedBy: string;
}

export interface AiStatus {
  settings: Pick<AiSettings, "choice" | "fallback" | "builder" | "builderFallback">;
  providers: ProviderStatus[];
  builder: { linked: boolean; online: boolean; lastSeen: string | null; openrouter: boolean; level: Level; message: string };
  keys: KeyStatus[];
  /** Plain-English problems, worst first. Empty = all good. */
  problems: { level: Level; text: string }[];
}

const LOW_CREDIT = 2;

const KEYS: KeyStatus[] = [
  { name: "OPENROUTER_API_KEY", set: false, usedBy: "AI in most apps; other LLMs in Game Creator" },
  { name: "AI_GATEWAY_API_KEY", set: false, usedBy: "AI fallback; video in Seedance, Dance Studio, Auteur" },
  { name: "SUPABASE_SERVICE_ROLE_KEY", set: false, usedBy: "Server storage: Game Creator, STD Safe, Recall lists, this panel" },
  { name: "FISH_API_KEY", set: false, usedBy: "Voice Studio cloning" },
  { name: "RUNPOD_API_KEY", set: false, usedBy: "Music Creator GPU" },
  { name: "MINIMAX_API_KEY", set: false, usedBy: "MiniMax H3 video (Dance Studio, Auteur, Smart Shot)" },
  { name: "WINDY_WEBCAMS_API_KEY", set: false, usedBy: "God's Eye extra webcams" },
  { name: "TICKETMASTER_API_KEY", set: false, usedBy: "Friends Night Out events" },
];

// Credit lookups are slow-ish and rate-limited; one per minute per instance is plenty.
const creditCache: Partial<Record<ProviderId, { at: number; value: number | null }>> = {};

async function remaining(id: ProviderId, key: string): Promise<number | null> {
  const hit = creditCache[id];
  if (hit && Date.now() - hit.at < 60_000) return hit.value;
  let value: number | null = null;
  try {
    const url = id === "openrouter" ? "https://openrouter.ai/api/v1/credits" : "https://ai-gateway.vercel.sh/v1/credits";
    const res = await fetch(url, { headers: { Authorization: `Bearer ${key}` }, signal: AbortSignal.timeout(6000) });
    if (res.ok) {
      const body = (await res.json()) as { data?: { total_credits?: number; total_usage?: number }; balance?: string | number };
      if (id === "openrouter" && body.data) value = Number(body.data.total_credits ?? 0) - Number(body.data.total_usage ?? 0);
      if (id === "vercel-gateway" && body.balance !== undefined) value = Number(body.balance);
      if (value !== null && !Number.isFinite(value)) value = null;
    }
  } catch {}
  creditCache[id] = { at: Date.now(), value };
  return value;
}

const LABEL: Record<ProviderId, string> = { openrouter: "OpenRouter", "vercel-gateway": "Vercel AI Gateway" };

// What a failing Claude Code CLI says when the plan (not the build) is the problem.
const PLAN_PROBLEM =
  /credit balance is too low|usage limit|limit reached|hit your limit|rate.?limit|not logged in|\/login|invalid api key|authentication_error|oauth token|overloaded/i;

export async function aiStatus(uid: string): Promise<AiStatus> {
  const settings = await loadSettings(true);
  const activeId = aiEndpoint()?.provider ?? null;

  const providers = await Promise.all(
    (["openrouter", "vercel-gateway"] as ProviderId[]).map(async (id): Promise<ProviderStatus> => {
      const ep = endpointFor(id);
      const left = ep ? await remaining(id, ep.key) : null;
      const lastError = settings.lastError[id];
      const base = { id, label: LABEL[id], configured: Boolean(ep), active: id === activeId, remaining: left, lastError, lastOk: settings.lastOk[id] };
      if (!ep) return { ...base, level: "warn", message: `No key set (${id === "openrouter" ? "OPENROUTER_API_KEY" : "AI_GATEWAY_API_KEY"}).` };
      if (lastError) return { ...base, level: "error", message: `Last call failed: ${lastError.message}` };
      if (left !== null && left <= 0) return { ...base, level: "error", message: "Out of credit." };
      if (left !== null && left < LOW_CREDIT) return { ...base, level: "warn", message: `Low credit: $${left.toFixed(2)} left.` };
      return { ...base, level: "ok", message: left !== null ? `$${left.toFixed(2)} credit left.` : "Working." };
    }),
  );

  // Game Creator: the builder on the PC runs Claude Code on the owner's plan.
  const info = await builderInfo(uid);
  const online = Boolean(info.lastSeen && Date.now() - Date.parse(info.lastSeen) < 60_000);
  const b = { linked: info.linked, lastSeen: info.lastSeen, openrouter: info.openrouter, online };
  const games = await listGames(uid);
  const lastDone = games.find((g) => g.status === "ready" || g.status === "failed");
  const running = games.find((g) => !["ready", "failed", "queued"].includes(g.status));
  // A failure from days ago is history, not a live problem.
  const recentFail =
    lastDone?.status === "failed" && Date.now() - Date.parse(lastDone.finishedAt ?? lastDone.updatedAt) < 24 * 3600_000;
  const planText = [recentFail ? lastDone.error : "", ...(running?.log ?? []).slice(-30).map((l) => l.line)].join("\n");
  const planHit = planText.match(PLAN_PROBLEM);
  let builder: AiStatus["builder"];
  if (!info.linked) builder = { ...b, level: "warn", message: "No PC builder connected (Game Creator › Connect your PC)." };
  else if (planHit) {
    const line = planText.split("\n").find((l) => PLAN_PROBLEM.test(l)) ?? planHit[0];
    builder = {
      ...b,
      level: "error",
      message: `Claude Code on your PC reported a plan/login problem: "${line.trim().slice(0, 160)}". ${
        settings.builderFallback && info.openrouter ? "Builds retry through OpenRouter." : "Run `claude /login` on the PC, or switch the builder to OpenRouter."
      }`,
    };
  } else if (!online) builder = { ...b, level: "warn", message: "PC builder is offline. Start it with `npm run builder`." };
  else builder = { ...b, level: "ok", message: settings.builder === "plan" ? "Online, building on your Claude plan." : "Online, building through OpenRouter." };

  const keys = KEYS.map((k) => ({ ...k, set: Boolean(process.env[k.name]) || (k.name === "AI_GATEWAY_API_KEY" && Boolean(process.env.VERCEL_OIDC_TOKEN)) }));

  const problems: AiStatus["problems"] = [];
  if (!activeId) problems.push({ level: "error", text: "No AI provider has a key, so every app runs in offline mode." });
  for (const p of providers) {
    if (!p.configured) continue;
    if (p.level === "error") problems.push({ level: p.active ? "error" : "warn", text: `${p.label}: ${p.message}` });
    else if (p.level === "warn") problems.push({ level: "warn", text: `${p.label}: ${p.message}` });
  }
  const active = providers.find((p) => p.active);
  if (active && active.level === "error") {
    const other = providers.find((p) => !p.active && p.configured);
    problems.push({
      level: "warn",
      text: settings.fallback && other ? `Calls fall back to ${other.label}.` : "Fallback is off or has no second provider, so AI features may fail.",
    });
  }
  if (builder.level === "error") problems.push({ level: "error", text: `Game builder: ${builder.message}` });

  return {
    settings: { choice: settings.choice, fallback: settings.fallback, builder: settings.builder, builderFallback: settings.builderFallback },
    providers,
    builder,
    keys,
    problems: problems.sort((a, b) => (a.level === b.level ? 0 : a.level === "error" ? -1 : 1)),
  };
}
