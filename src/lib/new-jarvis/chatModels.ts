// ---------------------------------------------------------------------------
// Which model the Chat's super agent thinks with.
//
// "Auto" is the hub default (Claude through OpenRouter, with the provider's
// own fallback chain). Every other pick is an OpenRouter model id sent with the
// request; the route only accepts the id's SHAPE, so a model added to
// OpenRouter tomorrow works by typing its id, with no code change.
//
// The picks below are the ones worth one tap. Each line says why you would
// choose it, in terms of what it can take: the agent drives tools, so a model
// that cannot call tools is not offered here, and a photo, clip or recording
// sent to a model that cannot perceive it is re-routed by the provider to one
// that can.
// ---------------------------------------------------------------------------

export interface ChatModel {
  /** OpenRouter id. "" = Auto. */
  id: string;
  label: string;
  /** Six words on when to pick it. */
  why: string;
  reads: ("text" | "image" | "audio" | "video")[];
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
};

export const SUBSCRIPTION_MODEL: ChatModel = {
  id: CLAUDE_SUBSCRIPTION,
  label: "Claude · my subscription",
  why: "Your own Claude plan through Claude Code on your PC. No extra cost.",
  reads: ["text", "image"],
};

export const CHAT_MODELS: ChatModel[] = [
  SUBSCRIPTION_MODEL,
  AUTO_MODEL,
  { id: "deepseek/deepseek-v4.1-flash", label: "DeepSeek V4.1 Flash", why: "Very cheap, fast, sees pictures.", reads: ["text", "image"] },
  { id: "xiaomi/mimo-v2.6-flash", label: "MiMo V2.6 Flash", why: "Hears audio and watches video.", reads: ["text", "image", "audio", "video"] },
  { id: "google/gemini-3.8-flash", label: "Gemini 3.8 Flash", why: "Long files, video, quick.", reads: ["text", "image", "audio", "video"] },
  { id: "openai/gpt-6-luna-pro", label: "GPT-6 Luna Pro", why: "The hardest questions.", reads: ["text", "image"] },
];

/** "vendor/model" or "vendor/model:variant" — the shape every OpenRouter id has. */
export function isModelId(v: unknown): v is string {
  return typeof v === "string" && v.length <= 120 && /^[a-z0-9][\w.-]*\/[\w.:-]+$/i.test(v);
}

export const isSubscription = (id: string) => id === CLAUDE_SUBSCRIPTION;

export function modelLabel(id: string): string {
  return CHAT_MODELS.find((m) => m.id === id)?.label ?? (id ? id.split("/").pop()! : AUTO_MODEL.label);
}

export const CHAT_MODEL_KEY = "nj.chat-model:v1";
