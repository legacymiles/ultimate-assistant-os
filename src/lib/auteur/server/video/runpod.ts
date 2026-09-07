// ---------------------------------------------------------------------------
// The user's own H3, running on their RunPod Serverless endpoint.
//
// Why serverless and not a pod: a pod bills for every second it is running,
// whether or not anyone is making a film. A serverless endpoint with its
// minimum worker count at zero bills only while a job is actually executing,
// which is the whole point of this backend.
//
// The trade that comes with it is the cold start. With no worker warm, the
// first job of a session waits for a container to come up and for tens of
// gigabytes of weights to load, and that time is billed like any other. The
// worker reports it as a progress note so the studio can say "warming up"
// rather than looking hung.
//
// The job's output shape is defined by our own handler (see runpod/h3-worker),
// so this file and that handler are two halves of one contract:
//
//   input:  { prompt, duration, resolution, aspect_ratio, references[], first_frame? }
//   output: { video_base64 } | { video_url } | { error }
// ---------------------------------------------------------------------------

import "server-only";

import type { RenderRequest, StartResult, TaskView, VideoBackend } from "./types";

const BASE = process.env.RUNPOD_API_BASE || "https://api.runpod.ai/v2";

export function runpodBackend(key: string, endpointId: string): VideoBackend {
  const root = `${BASE}/${encodeURIComponent(endpointId)}`;
  const auth = { Authorization: `Bearer ${key}`, "Content-Type": "application/json" };

  return {
    id: "runpod",
    label: "MiniMax H3 (your RunPod endpoint)",

    async start(req: RenderRequest): Promise<StartResult> {
      const res = await fetch(`${root}/run`, {
        method: "POST",
        headers: auth,
        body: JSON.stringify({
          input: {
            prompt: req.prompt.slice(0, 7000),
            duration: req.durationSec,
            resolution: req.resolution,
            aspect_ratio: req.aspectRatio,
            // The worker resolves labels the same way the prompt names them.
            references: req.references.map((r) => ({ label: r.label, kind: r.kind, data_url: r.dataUrl })),
            ...(req.firstFrame && !req.references.length ? { first_frame: req.firstFrame } : {}),
          },
        }),
        signal: AbortSignal.timeout(120_000),
      });
      const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
      if (!res.ok) throw new Error(`RunPod ${res.status}: ${describeError(data)}`);
      const id = String(data.id ?? "");
      if (!id) throw new Error(`RunPod returned no job id: ${describeError(data)}`);
      return { mode: "async", taskId: id };
    },

    poll: (jobId) => query(root, auth, jobId),

    async fetchVideo(jobId: string): Promise<Response> {
      const task = await query(root, auth, jobId);
      if (task.status !== "done") throw new Error("job is not finished");

      // The worker hands back bytes directly when the clip is small enough to
      // fit in a job result, and a URL when it uploaded to object storage.
      if (task.videoBase64) {
        const bytes = Buffer.from(task.videoBase64, "base64");
        return new Response(bytes, {
          headers: { "Content-Type": "video/mp4", "Cache-Control": "private, max-age=0" },
        });
      }
      if (task.url) {
        const upstream = await fetch(task.url, { signal: AbortSignal.timeout(180_000) });
        if (!upstream.ok || !upstream.body) throw new Error(`download ${upstream.status}`);
        return new Response(upstream.body, {
          headers: {
            "Content-Type": upstream.headers.get("content-type") || "video/mp4",
            "Cache-Control": "private, max-age=0",
          },
        });
      }
      throw new Error("job finished without a video");
    },
  };
}

async function query(root: string, auth: HeadersInit, jobId: string): Promise<TaskView> {
  const res = await fetch(`${root}/status/${encodeURIComponent(jobId)}`, {
    headers: auth,
    signal: AbortSignal.timeout(30_000),
  });
  const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) throw new Error(`RunPod ${res.status}: ${describeError(data)}`);

  const status = String(data.status ?? "").toUpperCase();
  const output = data.output as Record<string, unknown> | undefined;
  // A generator handler streams progress; the newest note is the useful one.
  const note = readNote(data);

  switch (status) {
    case "IN_QUEUE":
      return { status: "queued", note: note ?? "Waiting for a worker" };
    case "IN_PROGRESS":
      return { status: "generating", note: note ?? "Rendering" };
    case "COMPLETED": {
      if (output?.error) return { status: "error", error: String(output.error) };
      const b64 = output?.video_base64 ?? output?.videoBase64;
      const url = output?.video_url ?? output?.videoUrl ?? output?.url;
      if (typeof b64 === "string" && b64) return { status: "done", videoBase64: b64 };
      if (typeof url === "string" && url) return { status: "done", url };
      return { status: "error", error: "Worker returned no video" };
    }
    case "FAILED":
      return { status: "error", error: readError(data) ?? "Job failed" };
    case "CANCELLED":
      return { status: "error", error: "Job cancelled" };
    case "TIMED_OUT":
      return { status: "error", error: "Job timed out on the worker" };
    default:
      return { status: "generating", note };
  }
}

/** Progress text a generator handler emitted, if any. */
function readNote(data: Record<string, unknown>): string | undefined {
  const stream = data.stream;
  if (Array.isArray(stream) && stream.length) {
    const last = stream[stream.length - 1] as Record<string, unknown> | undefined;
    const out = last?.output;
    if (typeof out === "string") return out;
    if (out && typeof out === "object") {
      const note = (out as Record<string, unknown>).note;
      if (typeof note === "string") return note;
    }
  }
  const out = data.output as Record<string, unknown> | undefined;
  if (out && typeof out.note === "string") return out.note;
  return undefined;
}

function readError(data: Record<string, unknown>): string | undefined {
  if (typeof data.error === "string") return data.error.slice(0, 400);
  const out = data.output as Record<string, unknown> | undefined;
  if (out && typeof out.error === "string") return out.error.slice(0, 400);
  return undefined;
}

function describeError(data: Record<string, unknown>): string {
  if (typeof data.error === "string") return data.error.slice(0, 300);
  return JSON.stringify(data).slice(0, 300);
}

/** Is the endpoint reachable, and is anything warm right now? */
export async function runpodHealth(key: string, endpointId: string): Promise<Record<string, unknown> | null> {
  try {
    const res = await fetch(`${BASE}/${encodeURIComponent(endpointId)}/health`, {
      headers: { Authorization: `Bearer ${key}` },
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) return null;
    return (await res.json()) as Record<string, unknown>;
  } catch {
    return null;
  }
}
