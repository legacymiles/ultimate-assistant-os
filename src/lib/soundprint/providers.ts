// ---------------------------------------------------------------------------
// Soundprint — provider wiring. Server-only (reads env).
//
//   openrouter — has a real free tier, and is the only one of the two that
//                serves a music-generation model (Lyria 3). Free key, no card:
//                https://openrouter.ai/keys
//   gateway    — Vercel AI Gateway. Paid, best text quality.
// ---------------------------------------------------------------------------

import type { Provider } from "./models";

export interface ProviderConfig {
  url: string;
  key: string | undefined;
  headers: Record<string, string>;
  envVar: string;
  label: string;
}

export function providerConfig(provider: Provider): ProviderConfig {
  if (provider === "openrouter") {
    return {
      url: "https://openrouter.ai/api/v1/chat/completions",
      key: process.env.OPENROUTER_API_KEY,
      // OpenRouter uses these for attribution; both are optional.
      headers: {
        "HTTP-Referer": process.env.OPENROUTER_SITE_URL ?? "http://localhost:3000",
        "X-Title": "Soundprint",
      },
      envVar: "OPENROUTER_API_KEY",
      label: "OpenRouter",
    };
  }
  return {
    url: "https://ai-gateway.vercel.sh/v1/chat/completions",
    key: process.env.AI_GATEWAY_API_KEY,
    headers: {},
    envVar: "AI_GATEWAY_API_KEY",
    label: "Vercel AI Gateway",
  };
}

export function providerStatus() {
  return {
    openrouter: !!process.env.OPENROUTER_API_KEY,
    gateway: !!process.env.AI_GATEWAY_API_KEY,
  };
}
