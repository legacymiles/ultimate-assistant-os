// ---------------------------------------------------------------------------
// The same H3, reached through the Vercel AI Gateway.
//
// Synchronous inside one request: the AI SDK polls the provider for us and
// hands back the bytes. Simpler than MiniMax's own API, but it can only pass
// image references, and the whole render has to finish inside the route's
// execution limit.
// ---------------------------------------------------------------------------

import "server-only";

import type { RenderRequest, StartResult, VideoBackend } from "./types";

export function gatewayBackend(): VideoBackend {
  return {
    id: "gateway",
    label: "MiniMax H3 (AI Gateway)",

    async start(req: RenderRequest): Promise<StartResult> {
      // Imported lazily so the other backends never pay to load the AI SDK.
      const { experimental_generateVideo: generateVideo } = await import("ai");
      const model = process.env.AUTEUR_GATEWAY_VIDEO_MODEL || "minimax/minimax-h3";
      const images = req.references.filter((r) => r.kind === "image").slice(0, 9);

      const input: Record<string, unknown> = {
        model,
        duration: req.durationSec,
        aspectRatio: req.aspectRatio || "16:9",
        providerOptions: { minimax: { pollTimeoutMs: 280_000 } },
      };
      if (req.firstFrame && !images.length) {
        input.prompt = { image: req.firstFrame, text: req.prompt };
      } else {
        input.prompt = req.prompt;
        if (images.length) input.inputReferences = images.map((r) => r.dataUrl);
      }

      const result = await generateVideo(input as never);
      const first = (result as { videos?: { base64?: string; uint8Array?: Uint8Array }[] }).videos?.[0];
      if (first?.base64) return { mode: "inline", videoBase64: first.base64 };
      if (first?.uint8Array) return { mode: "inline", videoBase64: Buffer.from(first.uint8Array).toString("base64") };
      throw new Error("No video returned");
    },
  };
}
