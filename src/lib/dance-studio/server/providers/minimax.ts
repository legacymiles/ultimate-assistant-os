// ---------------------------------------------------------------------------
// MiniMax H3 through MiniMax's own v2 API, when MINIMAX_API_KEY is set.
//
// Reuses Auteur's hosted-H3 backend rather than a second copy of the same
// HTTP client: it already speaks content[] with `reference_video` and
// `reference_image` roles, polls tasks, and re-queries before downloading so
// a client can never make it fetch an arbitrary URL.
// ---------------------------------------------------------------------------

import "server-only";

import { minimaxBackend } from "@/lib/auteur/server/video/minimax";

import type { ProviderInfo } from "../../types";
import type { JobStatus, MotionJob, MotionProvider, StartedJob } from "./types";

export function minimaxProvider(key: string): MotionProvider {
  const backend = minimaxBackend(key);
  const info: ProviderInfo = {
    id: "minimax",
    label: "MiniMax H3 · MiniMax API",
    model: process.env.MINIMAX_VIDEO_MODEL || "MiniMax-H3",
    ready: true,
    resolutions: ["768p", "2k"],
    maxCharacterImages: 9,
    pricing: { outputPerSec: { "768p": 0.08, "2k": 0.13 } },
  };

  return {
    info,

    async start(job: MotionJob): Promise<StartedJob> {
      const started = await backend.start({
        prompt: job.prompt,
        durationSec: job.settings.durationSec,
        aspectRatio: job.settings.aspectRatio as never,
        resolution: job.settings.resolution === "2k" ? "2K" : "768P",
        references: [
          { label: "Video 1", kind: "video", dataUrl: job.referenceVideoUrl },
          ...job.characterImageUrls.map((url, i) => ({ label: `Image ${i + 1}`, kind: "image" as const, dataUrl: url })),
        ],
      });
      if (started.mode !== "async") throw new Error("MiniMax did not return a task to track.");
      return { operation: { taskId: started.taskId }, warnings: [] };
    },

    async status(operation: unknown): Promise<JobStatus> {
      const taskId = String((operation as { taskId?: string })?.taskId ?? "");
      if (!taskId) return { state: "error", message: "This generation has no MiniMax task id." };
      const task = await backend.poll!(taskId);
      if (task.status === "queued" || task.status === "generating") return { state: "pending" };
      if (task.status === "error") return { state: "error", message: task.error ?? "MiniMax reported that the render failed." };
      return {
        state: "completed",
        fetchVideo: async () => Buffer.from(await (await backend.fetchVideo!(taskId)).arrayBuffer()),
      };
    },
  };
}
