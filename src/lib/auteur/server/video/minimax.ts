// ---------------------------------------------------------------------------
// MiniMax's own v2 video API — the hosted H3.
//
// Async by design: create a task, poll it, then fetch a time-limited URL.
// H3's two input modes are mutually exclusive, so a first frame and a set of
// references can never both be sent.
// ---------------------------------------------------------------------------

import "server-only";

import type { RenderReference, RenderRequest, StartResult, TaskView, VideoBackend } from "./types";

const BASE = process.env.MINIMAX_API_BASE || "https://api.minimax.io";

const ROLE: Record<RenderReference["kind"], { type: string; key: string; role: string }> = {
  image: { type: "image_url", key: "image_url", role: "reference_image" },
  video: { type: "video_url", key: "video_url", role: "reference_video" },
  audio: { type: "audio_url", key: "audio_url", role: "reference_audio" },
};

export function minimaxBackend(key: string): VideoBackend {
  return {
    id: "minimax",
    label: "MiniMax H3 (hosted)",

    async start(req: RenderRequest): Promise<StartResult> {
      const content: Record<string, unknown>[] = [{ type: "text", text: req.prompt.slice(0, 7000) }];

      if (req.firstFrame && req.references.length === 0) {
        content.push({ type: "image_url", role: "first_frame", image_url: { url: req.firstFrame } });
      } else {
        // H3 takes at most 9 images, 3 videos, 3 audio clips, 12 files in all.
        let img = 0;
        let vid = 0;
        let aud = 0;
        for (const r of req.references) {
          if (content.length > 12) break;
          if (r.kind === "image" && img++ >= 9) continue;
          if (r.kind === "video" && vid++ >= 3) continue;
          if (r.kind === "audio" && aud++ >= 3) continue;
          const spec = ROLE[r.kind];
          if (!spec) continue;
          content.push({ type: spec.type, role: spec.role, [spec.key]: { url: r.dataUrl } });
        }
      }

      const res = await fetch(`${BASE}/v2/video_generation`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
        body: JSON.stringify({
          model: process.env.MINIMAX_VIDEO_MODEL || "MiniMax-H3",
          resolution: req.resolution === "2K" ? "2K" : "768P",
          duration: req.durationSec,
          // Text-to-video must name a ratio; image-driven modes follow the image.
          ratio: req.firstFrame ? "adaptive" : req.aspectRatio || "16:9",
          content,
        }),
        signal: AbortSignal.timeout(60_000),
      });
      const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
      if (!res.ok) throw new Error(`MiniMax ${res.status}: ${describeError(data)}`);
      const taskId = String(data.task_id ?? (data.task as Record<string, unknown> | undefined)?.id ?? "");
      if (!taskId) throw new Error(`MiniMax returned no task id: ${describeError(data)}`);
      return { mode: "async", taskId };
    },

    poll: (taskId) => query(key, taskId),

    async fetchVideo(taskId: string): Promise<Response> {
      // Re-query rather than trusting a client-supplied URL, so this can never
      // be used as an open proxy.
      const task = await query(key, taskId);
      if (task.status !== "done" || !task.url) throw new Error("task is not finished");
      const upstream = await fetch(task.url, { signal: AbortSignal.timeout(180_000) });
      if (!upstream.ok || !upstream.body) throw new Error(`download ${upstream.status}`);
      return new Response(upstream.body, {
        headers: {
          "Content-Type": upstream.headers.get("content-type") || "video/mp4",
          "Cache-Control": "private, max-age=0",
        },
      });
    },
  };
}

async function query(key: string, taskId: string): Promise<TaskView> {
  const res = await fetch(`${BASE}/v2/query/video_generation/${encodeURIComponent(taskId)}`, {
    headers: { Authorization: `Bearer ${key}` },
    signal: AbortSignal.timeout(30_000),
  });
  const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) throw new Error(`MiniMax ${res.status}: ${describeError(data)}`);
  const task = (data.task ?? data) as Record<string, unknown>;
  const status = String(task.status ?? "").toLowerCase();
  const content = task.content as Record<string, unknown> | undefined;
  const err = task.error as Record<string, unknown> | undefined;
  switch (status) {
    case "queued":
    case "preparing":
    case "queueing":
      return { status: "queued" };
    case "running":
    case "processing":
      return { status: "generating" };
    case "succeeded":
    case "success":
      return { status: "done", url: content?.url ? String(content.url) : undefined };
    case "failed":
    case "fail":
    case "cancelled":
    case "expired":
      return { status: "error", error: err?.message ? String(err.message) : `task ${status}` };
    default:
      return { status: "generating" };
  }
}

function describeError(data: Record<string, unknown>): string {
  const base = data.base_resp as Record<string, unknown> | undefined;
  if (base?.status_msg) return `${base.status_msg} (${base.status_code})`;
  const err = data.error as Record<string, unknown> | undefined;
  if (err?.message) return String(err.message);
  return JSON.stringify(data).slice(0, 300);
}
