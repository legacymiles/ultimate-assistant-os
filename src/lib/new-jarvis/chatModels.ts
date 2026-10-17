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

export const AUTO_MODEL: ChatModel = {
  id: "",
  label: "Auto · Claude",
  why: "Best all-rounder. Default.",
  reads: ["text", "image"],
};

export const CHAT_MODELS: ChatModel[] = [
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

export function modelLabel(id: string): string {
  return CHAT_MODELS.find((m) => m.id === id)?.label ?? (id ? id.split("/").pop()! : AUTO_MODEL.label);
}

export const CHAT_MODEL_KEY = "nj.chat-model:v1";
