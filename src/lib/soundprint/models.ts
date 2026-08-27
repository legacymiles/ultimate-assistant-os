// ---------------------------------------------------------------------------
// Soundprint — the "ears" roster, across two providers.
//
//   openrouter — has a genuinely free tier. Create a key at
//                https://openrouter.ai/keys (no card needed for :free models)
//                and set OPENROUTER_API_KEY.
//   gateway    — Vercel AI Gateway, paid, best quality. AI_GATEWAY_API_KEY.
//
// Every id below was verified against the live provider model lists.
//
// A note on how the listening works, because it matters: no language model on
// either provider accepts raw `audio` input — the only audio-input models are
// transcribers, which return words, not musical style. So Soundprint measures
// the audio itself, in your browser, with the Web Audio API. Those hard numbers
// go to the model, which supplies interpretation and genre expertise.
// ---------------------------------------------------------------------------

export type Provider = "openrouter" | "gateway";

export interface EarModel {
  id: string;
  provider: Provider;
  label: string;
  vendor: string;
  blurb: string;
  tier: "free" | "flagship" | "balanced" | "fast";
}

export const MODELS: EarModel[] = [
  // --- Free (OpenRouter :free tier) ---------------------------------------
  {
    id: "nvidia/nemotron-3-ultra-550b-a55b:free",
    provider: "openrouter",
    label: "Nemotron 3 Ultra 550B",
    vendor: "NVIDIA",
    blurb: "Free and genuinely huge — 550B params. The best free option by a distance.",
    tier: "free",
  },
  {
    id: "nvidia/nemotron-3-super-120b-a12b:free",
    provider: "openrouter",
    label: "Nemotron 3 Super 120B",
    vendor: "NVIDIA",
    blurb: "Free, 120B, noticeably quicker than Ultra. Great everyday pick.",
    tier: "free",
  },
  {
    id: "google/gemma-4-31b-it:free",
    provider: "openrouter",
    label: "Gemma 4 31B",
    vendor: "Google",
    blurb: "Free Google model with solid musical vocabulary and clean formatting.",
    tier: "free",
  },
  {
    id: "inclusionai/ling-3.0-flash:free",
    provider: "openrouter",
    label: "Ling 3.0 Flash",
    vendor: "InclusionAI",
    blurb: "Free and fast. Good breadth across Asian and electronic scenes.",
    tier: "free",
  },
  {
    id: "openai/gpt-oss-20b:free",
    provider: "openrouter",
    label: "GPT-OSS 20B",
    vendor: "OpenAI",
    blurb: "Free and lightweight. Fine for well-known references.",
    tier: "free",
  },
  {
    id: "openrouter/free",
    provider: "openrouter",
    label: "Auto (any free model)",
    vendor: "OpenRouter",
    blurb: "Routes to whichever free model is available. Handy if one is rate-limited.",
    tier: "free",
  },

  // --- Paid, via the Vercel AI Gateway -------------------------------------
  {
    id: "google/gemini-3-pro-preview",
    provider: "gateway",
    label: "Gemini 3 Pro",
    vendor: "Google",
    blurb: "Deepest musical reasoning. Best at subgenre blends and vocal tone.",
    tier: "flagship",
  },
  {
    id: "anthropic/claude-opus-4.8",
    provider: "gateway",
    label: "Claude Opus 4.8",
    vendor: "Anthropic",
    blurb: "Strongest at prose — writes the most natural, singable lyrics.",
    tier: "flagship",
  },
  {
    id: "alibaba/qwen3.7-plus",
    provider: "gateway",
    label: "Qwen 3.7 Plus",
    vendor: "Alibaba",
    blurb: "Excellent breadth across world and electronic genres. Great all-rounder.",
    tier: "flagship",
  },
  {
    id: "alibaba/qwen3.7-max",
    provider: "gateway",
    label: "Qwen 3.7 Max",
    vendor: "Alibaba",
    blurb: "Qwen's biggest. Deep recall on obscure scenes and regional styles.",
    tier: "flagship",
  },
  {
    id: "openai/gpt-5.5",
    provider: "gateway",
    label: "GPT-5.5",
    vendor: "OpenAI",
    blurb: "Reliable, well-structured breakdowns. Very consistent formatting.",
    tier: "flagship",
  },
  {
    id: "google/gemini-2.5-pro",
    provider: "gateway",
    label: "Gemini 2.5 Pro",
    vendor: "Google",
    blurb: "Proven and steady. A safe default for style breakdowns.",
    tier: "balanced",
  },
  {
    id: "anthropic/claude-sonnet-5",
    provider: "gateway",
    label: "Claude Sonnet 5",
    vendor: "Anthropic",
    blurb: "Fast with strong lyric instincts. Best quality-per-second pick.",
    tier: "balanced",
  },
  {
    id: "xai/grok-4.5",
    provider: "gateway",
    label: "Grok 4.5",
    vendor: "xAI",
    blurb: "Loose and opinionated — good when you want bolder style choices.",
    tier: "balanced",
  },
  {
    id: "deepseek/deepseek-v4-pro",
    provider: "gateway",
    label: "DeepSeek V4 Pro",
    vendor: "DeepSeek",
    blurb: "Analytical and precise. Strong on production and mix vocabulary.",
    tier: "balanced",
  },
  {
    id: "moonshotai/kimi-k3",
    provider: "gateway",
    label: "Kimi K3",
    vendor: "Moonshot",
    blurb: "Wide cultural range, especially across Asian pop and hip-hop.",
    tier: "balanced",
  },
  {
    id: "google/gemini-3.5-flash",
    provider: "gateway",
    label: "Gemini 3.5 Flash",
    vendor: "Google",
    blurb: "Very fast and cheap. Ideal when iterating on lots of songs.",
    tier: "fast",
  },
  {
    id: "alibaba/qwen3.5-flash",
    provider: "gateway",
    label: "Qwen 3.5 Flash",
    vendor: "Alibaba",
    blurb: "Qwen speed tier — quick drafts you can refine.",
    tier: "fast",
  },
];

/** Free by default, so the app works as soon as a free key is in place. */
export const DEFAULT_MODEL_ID = "nvidia/nemotron-3-ultra-550b-a55b:free";

export const TIER_LABELS: Record<EarModel["tier"], string> = {
  free: "Free",
  flagship: "Flagship (paid)",
  balanced: "Balanced (paid)",
  fast: "Fast & cheap (paid)",
};

export const TIER_ORDER: EarModel["tier"][] = ["free", "flagship", "balanced", "fast"];

export function getModel(id: string): EarModel {
  return MODELS.find((m) => m.id === id) ?? MODELS[0];
}

export function isKnownModel(id: string): boolean {
  return MODELS.some((m) => m.id === id);
}

/** Which providers actually have a key configured — surfaced in the picker. */
export interface ProviderStatus {
  openrouter: boolean;
  gateway: boolean;
}
