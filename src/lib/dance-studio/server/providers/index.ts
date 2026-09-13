// ---------------------------------------------------------------------------
// Which provider renders a dance.
//
// A MiniMax key that is present is treated as a key you meant to use; else
// the AI Gateway. DANCE_STUDIO_PROVIDER pins one ("minimax" | "gateway").
// Each Generation records its provider id, so a render is always checked on
// the provider that started it even if configuration changes meanwhile.
// ---------------------------------------------------------------------------

import "server-only";

import type { ProviderInfo } from "../../types";
import { gatewayProvider } from "./gateway";
import { minimaxProvider } from "./minimax";
import type { MotionProvider } from "./types";

export type { MotionProvider } from "./types";

function available(): MotionProvider[] {
  const out: MotionProvider[] = [];
  if (process.env.MINIMAX_API_KEY) out.push(minimaxProvider(process.env.MINIMAX_API_KEY));
  if (process.env.AI_GATEWAY_API_KEY) out.push(gatewayProvider());
  return out;
}

export function activeProvider(): MotionProvider | null {
  const list = available();
  const pinned = (process.env.DANCE_STUDIO_PROVIDER || "").trim().toLowerCase();
  return (pinned && list.find((p) => p.info.id === pinned)) || list[0] || null;
}

export function providerById(id: string): MotionProvider | null {
  return available().find((p) => p.info.id === id) ?? null;
}

export function providerInfo(): ProviderInfo {
  const p = activeProvider();
  if (p) return p.info;
  return {
    id: "none",
    label: "No video provider",
    model: "",
    ready: false,
    reason:
      "Set AI_GATEWAY_API_KEY (MiniMax H3 through the Vercel AI Gateway) or MINIMAX_API_KEY (MiniMax's own API) to generate dances.",
    resolutions: ["768p"],
    maxCharacterImages: 1,
  };
}
