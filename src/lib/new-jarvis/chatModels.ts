// ---------------------------------------------------------------------------
// Which model the Chat's super agent thinks with.
//
// "Auto" is the hub default (Claude through OpenRouter, with the provider's
// own fallback chain). Every other pick is a model id sent with the request;
// the route only accepts the id's SHAPE, so a model added tomorrow works by
// typing its id, with no code change. OrcaRouter's `orca/…` ids are the
// exception to "OpenRouter id": provider.ts pins them to OrcaRouter.
//
// The picks below are the ones worth one tap. Each line says why you would
// choose it, in terms of what it can take: the agent drives tools, so a model
// that cannot call tools is not offered here, and a photo, clip or recording
// sent to a model that cannot perceive it is re-routed by the provider to one
// that can.
//
// EVERY Claude is offered TWICE — once on the owner's own plan (Claude Code on
// the PC, no per-token cost) and once on the Claude API through OpenRouter
// (works with the PC asleep, keeps going when the plan is rate-limited). One
// vendor, two ways to pay for it, so "my plan or the API" is a tap in the same
// menu rather than a setting somewhere else. The two routes are listed in the
// same order on purpose: the row above and the row below are the same model.
// ---------------------------------------------------------------------------

/**
 * Which way a pick is paid for and which machine runs it.
 *
 *   "subscription" — the owner's Claude plan, through the PC agent. Hidden on a
 *                    surface that runs on the server (ModelPicker's cloudOnly).
 *   "claude-api"   — the same Claude, on the Claude API via OpenRouter.
 *   "other"        — everything that is not Claude.
 */
export type ChatRoute = "subscription" | "claude-api" | "other";

export interface ChatModel {
  /** OpenRouter id. "" = Auto. */
  id: string;
  label: string;
  /** Six words on when to pick it. */
  why: string;
  reads: ("text" | "image" | "audio" | "video")[];
  route: ChatRoute;
}

/**
 * Claude on the person's OWN Claude plan, through the official Claude Code on
 * their PC (the local agent's /brain/claude). Not an OpenRouter id, so it never
 * reaches the cloud route; NewJarvis sends it to the PC instead.
 */
export const CLAUDE_SUBSCRIPTION = "claude-subscription";

export const AUTO_MODEL: ChatModel = {
  id: "",
  label: "Claude · cloud",
  why: "Claude via OpenRouter. Pay per use; works with the PC off.",
  reads: ["text", "image"],
  route: "claude-api",
};

export const SUBSCRIPTION_MODEL: ChatModel = {
  id: CLAUDE_SUBSCRIPTION,
  label: "Claude · my subscription",
  why: "Your own Claude plan, through the local agent. No extra cost.",
  reads: ["text", "image"],
  route: "subscription",
};

/** One Claude on the owner's plan. `model` is the name Claude Code answers to. */
const plan = (model: string, name: string, why: string): ChatModel => ({
  id: `${CLAUDE_SUBSCRIPTION}:${model}`,
  label: `${name} · my subscription`,
  why,
  reads: ["text", "image"],
  route: "subscription",
});

/** The same Claude on the Claude API, through OpenRouter's key. */
const api = (id: string, name: string, why: string): ChatModel => ({
  id: `anthropic/${id}`,
  label: `${name} · API`,
  why,
  reads: ["text", "image"],
  route: "claude-api",
});

/** The owner's own plan: no per-token cost, needs the PC agent running. */
export const SUBSCRIPTION_MODELS: ChatModel[] = [
  SUBSCRIPTION_MODEL,
  plan("claude-opus-5-5", "Opus 5.5", "Strongest Claude, on your subscription."),
  plan("claude-opus-5", "Opus 5", "The previous Opus, on your subscription."),
  plan("claude-sonnet-5-5", "Sonnet 5.5", "Faster than Opus, lighter on your plan's limits."),
  plan("claude-sonnet-5", "Sonnet 5", "The previous Sonnet, on your subscription."),
  plan("claude-haiku-5-5", "Haiku 5.5", "The quickest Claude — barely touches your limits."),
  plan("claude-fable-5-2", "Fable 5.2", "Claude's writing model, on your subscription."),
];

/** The same lineup on the Claude API, so a rate-limited plan is one tap away. */
export const CLAUDE_API_MODELS: ChatModel[] = [
  AUTO_MODEL,
  api("claude-opus-5.5", "Opus 5.5", "Strongest Claude via OpenRouter, per token."),
  api("claude-opus-5", "Opus 5", "Opus 5 via OpenRouter, per token."),
  api("claude-sonnet-5.5", "Sonnet 5.5", "Much cheaper than Opus, still strong."),
  api("claude-sonnet-5", "Sonnet 5", "The previous Sonnet, per token."),
  api("claude-haiku-5.5", "Haiku 5.5", "Pennies per answer, and fast."),
  api("claude-fable-5.2", "Fable 5.2", "Claude's writing model, per token."),
];

/** Everything that is not Claude. */
export const OTHER_MODELS: ChatModel[] = [
  {
    id: "orca/orcacyber-flash-1.0",
    label: "DeepSeek 4.1 Flash Abliterated",
    why: "Uncensored, never declines. On OrcaRouter.",
    reads: ["text", "image"],
    route: "other",
  },
  {
    id: "orca/orcacyber-k3.1-pro",
    label: "Kimi K3.1 Pro Abliterated",
    why: "Uncensored, strongest, watches clips.",
    reads: ["text", "image", "video"],
    route: "other",
  },
  { id: "deepseek/deepseek-v4.1-flash", label: "DeepSeek V4.1 Flash", why: "Very cheap, fast, sees pictures.", reads: ["text", "image"], route: "other" },
  { id: "xiaomi/mimo-v2.6-flash", label: "MiMo V2.6 Flash", why: "Hears audio and watches video.", reads: ["text", "image", "audio", "video"], route: "other" },
  { id: "google/gemini-3.8-flash", label: "Gemini 3.8 Flash", why: "Long files, video, quick.", reads: ["text", "image", "audio", "video"], route: "other" },
  { id: "openai/gpt-6-luna-pro", label: "GPT-6 Luna Pro", why: "The hardest questions.", reads: ["text", "image"], route: "other" },
];

export const CHAT_MODELS: ChatModel[] = [...SUBSCRIPTION_MODELS, ...CLAUDE_API_MODELS, ...OTHER_MODELS];

export const ROUTE_TITLE: Record<ChatRoute, string> = {
  subscription: "Your Claude plan · on your PC",
  "claude-api": "Claude API · OpenRouter",
  other: "Other models · OpenRouter",
};

export const ROUTE_NOTE: Partial<Record<ChatRoute, string>> = {
  subscription: "Runs in Claude Code on your PC, so there is nothing to pay. Needs the PC helper running.",
  "claude-api": "The same models on the hub's key, paid per token. Works with the PC off.",
};

/**
 * The menu's groups, in reading order.
 *
 * `cloudOnly` is for a surface the SERVER runs (the 24/7 Queue plans without
 * the PC): it drops the plan group rather than offering a brain that cannot
 * answer there.
 */
export function groupedChatModels(cloudOnly = false): { route: ChatRoute; title: string; note?: string; items: ChatModel[] }[] {
  const routes: ChatRoute[] = cloudOnly ? ["claude-api", "other"] : ["subscription", "claude-api", "other"];
  return routes.map((route) => ({
    route,
    title: ROUTE_TITLE[route],
    note: ROUTE_NOTE[route],
    items: CHAT_MODELS.filter((m) => m.route === route),
  }));
}

/** "vendor/model" or "vendor/model:variant" — the shape every OpenRouter id has. */
export function isModelId(v: unknown): v is string {
  return typeof v === "string" && v.length <= 120 && /^[a-z0-9][\w.-]*\/[\w.:-]+$/i.test(v);
}

export const isSubscription = (id: string) => id === CLAUDE_SUBSCRIPTION || id.startsWith(`${CLAUDE_SUBSCRIPTION}:`);

/** The model the plan is asked for ("claude-opus-5-5"), or "" for Claude Code's default. */
export function subscriptionModel(id: string): string {
  return id.startsWith(`${CLAUDE_SUBSCRIPTION}:`) ? id.slice(CLAUDE_SUBSCRIPTION.length + 1) : "";
}

export function modelLabel(id: string): string {
  return CHAT_MODELS.find((m) => m.id === id)?.label ?? (id ? id.split("/").pop()! : AUTO_MODEL.label);
}

export const CHAT_MODEL_KEY = "nj.chat-model:v1";
