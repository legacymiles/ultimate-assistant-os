// ---------------------------------------------------------------------------
// MiniMax H3 reference generation, through the Vercel AI Gateway.
//
// Why H3: its reference mode takes up to 3 videos and 9 images and transfers
// the performance of a reference video onto the identity in the images — the
// video is motion, the images are who. It is also the cheapest option on the
// gateway that does this ($0.04/s output at 768p + $0.065/s of reference
// video, gateway model card 2026-09-13).
//
// Async on purpose: startVideo returns as soon as the gateway accepts the job,
// and each status check is one short request, so a render that takes several
// minutes never has to fit inside one function invocation. The gateway caps
// the persisted start request at 300 KiB, which is why both references go as
// signed links rather than bytes.
//
// The one failure this file refuses to hide: if the gateway reports it
// ignored the video reference, the start is treated as an error. A render
// without the dance would be "a character dancing" — exactly what must not be
// passed off as the result.
// ---------------------------------------------------------------------------

import "server-only";

import { experimental_getVideoStatus as getVideoStatus, experimental_startVideo as startVideo } from "ai";

import type { ProviderInfo } from "../../types";
import type { JobStatus, MotionJob, MotionProvider, StartedJob } from "./types";

type VideoEntry = { type?: string; url?: string; data?: string | Uint8Array };

/** The gateway refuses every video job below this balance (observed 2026-09-13). */
const VIDEO_MIN_BALANCE_USD = 10;

/**
 * A warning worth showing before anyone presses Generate, or undefined.
 * Best effort: a slow or failed balance check says nothing rather than blocking.
 */
export async function gatewayBalanceNotice(): Promise<string | undefined> {
  const key = process.env.AI_GATEWAY_API_KEY;
  if (!key) return undefined;
  try {
    const res = await fetch("https://ai-gateway.vercel.sh/v1/credits", {
      headers: { authorization: `Bearer ${key}` },
      signal: AbortSignal.timeout(4000),
    });
    if (!res.ok) return undefined;
    const balance = Number((await res.json()).balance);
    if (Number.isFinite(balance) && balance < VIDEO_MIN_BALANCE_USD) {
      return `AI Gateway balance is $${balance.toFixed(2)}; video generation needs at least $${VIDEO_MIN_BALANCE_USD}. Top up at vercel.com → AI Gateway.`;
    }
  } catch {
    // Unknown balance is not a reason to warn.
  }
  return undefined;
}

function describeWarning(w: unknown): string {
  if (!w || typeof w !== "object") return String(w);
  const o = w as Record<string, unknown>;
  return [o.feature, o.message, o.details].filter(Boolean).map(String).join(": ") || JSON.stringify(o);
}

export function gatewayProvider(): MotionProvider {
  const model = process.env.DANCE_STUDIO_GATEWAY_MODEL || "minimax/minimax-h3";
  const info: ProviderInfo = {
    id: "gateway",
    label: "MiniMax H3 · AI Gateway",
    model,
    ready: true,
    resolutions: ["768p", "2k"],
    maxCharacterImages: 9,
    pricing: { outputPerSec: { "768p": 0.04, "2k": 0.065 }, referenceVideoPerSec: 0.065, perImage: 0.02 },
  };

  return {
    info,

    async start(job: MotionJob): Promise<StartedJob> {
      const res = await startVideo({
        model,
        prompt: job.prompt,
        duration: job.settings.durationSec,
        aspectRatio: job.settings.aspectRatio,
        inputReferences: [
          // Order is meaning: the first video is "Video 1", the images are "Image 1…N".
          { data: job.referenceVideoUrl, mediaType: "video/mp4" },
          ...job.characterImageUrls.map((url) => ({ data: url, mediaType: "image/jpeg" })),
        ],
        providerOptions: { minimax: { resolution: job.settings.resolution === "2k" ? "2K" : "768P" } },
      });

      const warnings = res.warnings.map(describeWarning);
      const droppedVideo = warnings.find((w) => /video|reference/i.test(w) && /ignor|unsupported|not supported|dropp/i.test(w));
      if (droppedVideo) {
        throw new Error(`The gateway would not use the dance video as a reference (${droppedVideo}), so nothing was generated.`);
      }
      return { operation: res.operation, warnings };
    },

    async status(operation: unknown): Promise<JobStatus> {
      const s = (await getVideoStatus(model, { operation: operation as never })) as unknown as {
        status: string;
        videos?: VideoEntry[];
        message?: string;
        error?: unknown;
      };
      if (s.status === "pending") return { state: "pending" };
      if (s.status !== "completed") {
        const detail = s.message ?? (typeof s.error === "string" ? s.error : s.error ? JSON.stringify(s.error) : "");
        return { state: "error", message: detail || "MiniMax H3 reported that the render failed." };
      }
      const video = s.videos?.[0];
      if (!video) return { state: "error", message: "The render finished but returned no video." };
      return {
        state: "completed",
        fetchVideo: async () => {
          if (video.url) {
            const r = await fetch(video.url, { signal: AbortSignal.timeout(110_000) });
            if (!r.ok) throw new Error(`Downloading the finished video failed (${r.status}).`);
            return Buffer.from(await r.arrayBuffer());
          }
          if (typeof video.data === "string") return Buffer.from(video.data, "base64");
          if (video.data) return Buffer.from(video.data);
          throw new Error("The finished video had neither a link nor bytes.");
        },
      };
    },
  };
}
