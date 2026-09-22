import "server-only";
import {
  activeBackend,
  backendForTask,
  tagTask,
  type RenderRequest,
} from "@/lib/auteur/server/video";
import type { AspectRatio as AuteurAspect } from "@/lib/auteur/types";
import type { Capability } from "../../types";
import { ffmpegAvailable, hasEnv, requirement, rollUp } from "../../server/detect";
import type { MethodServer, ScenePoll, SceneContext, SceneStart } from "../../server/types";

// ---------------------------------------------------------------------------
// H3 is the one method that renders inside the web request.
//
// It reuses the hub's existing video backends (src/lib/auteur/server/video):
// the owner's own H3 on RunPod first, then MiniMax's hosted API, then the
// Vercel AI Gateway, then an animatic placeholder. Nothing is reimplemented
// here — this file is the seam between the studio's scene loop and that stack.
// ---------------------------------------------------------------------------

const runpod = () => hasEnv("RUNPOD_API_KEY") && hasEnv("RUNPOD_ENDPOINT_ID");

async function detect(): Promise<Capability> {
  const anyBackend = runpod() || hasEnv("MINIMAX_API_KEY") || hasEnv("AI_GATEWAY_API_KEY");
  const backend = activeBackend();
  const ffmpeg = await ffmpegAvailable();
  const capability = rollUp(
    [
      requirement(
        "backend",
        "A video model",
        "api-key",
        "RUNPOD_API_KEY + RUNPOD_ENDPOINT_ID, MINIMAX_API_KEY, or AI_GATEWAY_API_KEY",
        anyBackend,
        "Set one of these in .env.local. Without one the studio renders an animatic placeholder.",
      ),
      requirement(
        "runpod",
        "Your own H3 on RunPod",
        "gpu",
        "RUNPOD_API_KEY + RUNPOD_ENDPOINT_ID",
        runpod(),
        "Optional — the cheapest route once the pod is warm.",
        true,
      ),
      requirement(
        "ai",
        "Prompt optimisation",
        "api-key",
        "OPENROUTER_API_KEY",
        hasEnv("OPENROUTER_API_KEY", "AI_GATEWAY_API_KEY"),
        "Optional — without it the studio falls back to a structural shot prompt.",
        true,
      ),
      requirement(
        "ffmpeg",
        "ffmpeg (on the server)",
        "install",
        "ffmpeg",
        ffmpeg,
        "Optional — needed to chain each shot off the last one's final frame and to join the scenes into one file. Without it the scenes stay separate.",
        true,
      ),
    ],
    `Renders on the server through ${backend.label}.`,
  );
  // The placeholder always "works", and saying so plainly is the point: it is
  // a marked dependency, not a finished video.
  if (capability.state !== "ready") {
    capability.summary = `${capability.summary} Renders an animatic placeholder until then.`;
  }
  return capability;
}

/** H3 takes 16:9, 9:16 or 1:1. Anything else is delivered in the nearest one. */
function toAuteurAspect(aspect: string): AuteurAspect {
  if (aspect === "9:16") return "9:16";
  if (aspect === "1:1") return "1:1";
  // 4:5 is closer to portrait than to square; 21:9 renders wide and is cropped
  // at assembly. Both are stated on the card rather than silently changed.
  if (aspect === "4:5") return "9:16";
  return "16:9";
}

async function startScene(ctx: SceneContext): Promise<SceneStart> {
  const backend = activeBackend();
  const scene = ctx.scene;
  const request: RenderRequest = {
    prompt: ctx.directive || scene.description,
    // H3 generates roughly 6–15s per shot; a longer scene is clamped and the
    // plan screen already warns about it.
    durationSec: Math.min(15, Math.max(3, Math.round(scene.endSec - scene.startSec))),
    aspectRatio: toAuteurAspect(ctx.project.brief.aspectRatio),
    resolution: "768P",
    references: [],
    firstFrame: ctx.previousFrame,
  };

  const result = await backend.start(request);
  if (result.mode === "async") {
    return { kind: "task", taskId: tagTask(backend, result.taskId), note: `${backend.label} is generating` };
  }
  if (result.mode === "inline") {
    return { kind: "clip", clip: Buffer.from(result.videoBase64, "base64"), note: backend.label };
  }
  // The placeholder has nothing to hand back. Surfacing that as a failure is
  // the honest answer — a missing key must not look like a finished render.
  throw new Error(
    "No video model is configured, so there is nothing to render. Set RUNPOD_API_KEY + RUNPOD_ENDPOINT_ID, MINIMAX_API_KEY or AI_GATEWAY_API_KEY.",
  );
}

async function pollScene(taskId: string): Promise<ScenePoll> {
  const routed = backendForTask(taskId);
  if (!routed?.backend.poll) return { state: "failed", error: "Unknown render task." };

  const view = await routed.backend.poll(routed.id);
  if (view.status === "error") return { state: "failed", error: view.error || "The model reported an error." };
  if (view.status !== "done") return { state: "running", note: view.note };

  if (view.videoBase64) return { state: "done", clip: Buffer.from(view.videoBase64, "base64") };
  if (routed.backend.fetchVideo) {
    const res = await routed.backend.fetchVideo(routed.id);
    if (!res.ok) return { state: "failed", error: `Could not download the clip (${res.status}).` };
    return { state: "done", clip: Buffer.from(await res.arrayBuffer()) };
  }
  if (view.url) {
    const res = await fetch(view.url);
    if (!res.ok) return { state: "failed", error: `Could not download the clip (${res.status}).` };
    return { state: "done", clip: Buffer.from(await res.arrayBuffer()) };
  }
  return { state: "failed", error: "The model finished but returned no video." };
}

export const server: MethodServer = { id: "h3", detect, startScene, pollScene };
