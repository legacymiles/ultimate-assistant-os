import { NextResponse } from "next/server";
import type { AspectRatio } from "@/lib/auteur/types";

export const runtime = "nodejs";
// A gateway render is synchronous and can take a few minutes; allow the max.
export const maxDuration = 300;

// ---------------------------------------------------------------------------
// POST /api/auteur/generate — the one place the studio talks to MiniMax H3.
//
// Three backends, chosen by which key exists, in this order:
//
//   1. MINIMAX_API_KEY  — MiniMax's own v2 API. Async: `create` returns a task
//      id, `status` polls it, `download` proxies the finished bytes. This is
//      the full-featured path (768P/2K, up to 9 image + 3 video + 3 audio
//      references, native audio).
//   2. AI_GATEWAY_API_KEY — the same model through the Vercel AI Gateway via
//      the AI SDK. Synchronous inside this request; the clip comes back
//      inline as base64. Image references only.
//   3. neither — a placeholder take after a short wait, so the whole studio
//      (board, retakes, timeline) is usable and demoable with no account.
//
// Reference order matters: the prompt names <Subject 1>, <Video 1>, <Audio 1>
// in the order the client sends them, and this route preserves that order.
// ---------------------------------------------------------------------------

const MINIMAX_BASE = process.env.MINIMAX_API_BASE || "https://api.minimax.io";

interface RefIn {
  label: string;
  kind: "image" | "video" | "audio";
  dataUrl: string;
}

interface CreateBody {
  action: "create";
  prompt: string;
  durationSec: number;
  aspectRatio: AspectRatio;
  resolution?: "768P" | "2K";
  references?: RefIn[];
  /** Data URL of a first-frame image (keyframe mode; excludes references). */
  firstFrame?: string;
}

interface StatusBody {
  action: "status";
  taskId: string;
}

interface DownloadBody {
  action: "download";
  taskId: string;
}

type Body = CreateBody | StatusBody | DownloadBody;

export async function POST(req: Request) {
  let body: Body;
  try {
    body = await req.json();
  } catch {
    return bad("Invalid request body");
  }

  const minimaxKey = process.env.MINIMAX_API_KEY || "";
  const gatewayKey = process.env.AI_GATEWAY_API_KEY || "";

  switch (body.action) {
    case "create": {
      const prompt = (body.prompt ?? "").trim();
      if (!prompt) return bad("prompt required");
      const duration = clampDuration(body.durationSec);
      const refs = (body.references ?? []).filter((r) => r && typeof r.dataUrl === "string" && r.dataUrl.startsWith("data:"));

      if (minimaxKey) {
        try {
          const taskId = await minimaxCreate(minimaxKey, { ...body, prompt, durationSec: duration, references: refs });
          return NextResponse.json({ engine: "minimax", mode: "async", taskId });
        } catch (err) {
          console.error("MiniMax create failed:", err);
          return NextResponse.json({ engine: "minimax", error: message(err) }, { status: 502 });
        }
      }

      if (gatewayKey) {
        try {
          const base64 = await gatewayRender({ ...body, prompt, durationSec: duration, references: refs });
          return NextResponse.json({ engine: "minimax", mode: "inline", videoBase64: base64 });
        } catch (err) {
          console.error("Gateway render failed:", err);
          return NextResponse.json({ engine: "minimax", error: message(err) }, { status: 502 });
        }
      }

      // Placeholder: long enough that the "rendering" state is visible.
      await sleep(1400);
      return NextResponse.json({ engine: "placeholder", mode: "done" });
    }

    case "status": {
      if (!minimaxKey) return bad("no async backend configured");
      if (!body.taskId) return bad("taskId required");
      try {
        const task = await minimaxQuery(minimaxKey, body.taskId);
        return NextResponse.json(task);
      } catch (err) {
        return NextResponse.json({ status: "error", error: message(err) });
      }
    }

    case "download": {
      if (!minimaxKey) return bad("no async backend configured");
      if (!body.taskId) return bad("taskId required");
      try {
        // Re-query rather than trusting a client-supplied URL, so this route
        // can never be used as an open proxy.
        const task = await minimaxQuery(minimaxKey, body.taskId);
        if (task.status !== "done" || !task.url) return bad("task is not finished");
        const upstream = await fetch(task.url, { signal: AbortSignal.timeout(120_000) });
        if (!upstream.ok || !upstream.body) throw new Error(`download ${upstream.status}`);
        return new Response(upstream.body, {
          headers: {
            "Content-Type": upstream.headers.get("content-type") || "video/mp4",
            "Cache-Control": "private, max-age=0",
          },
        });
      } catch (err) {
        return NextResponse.json({ error: message(err) }, { status: 502 });
      }
    }

    default:
      return bad("unknown action");
  }
}

// ----- MiniMax v2 ----------------------------------------------------------

const ROLE: Record<RefIn["kind"], { type: string; key: string; role: string }> = {
  image: { type: "image_url", key: "image_url", role: "reference_image" },
  video: { type: "video_url", key: "video_url", role: "reference_video" },
  audio: { type: "audio_url", key: "audio_url", role: "reference_audio" },
};

async function minimaxCreate(key: string, b: CreateBody): Promise<string> {
  const content: Record<string, unknown>[] = [{ type: "text", text: b.prompt.slice(0, 7000) }];
  const refs = b.references ?? [];

  if (b.firstFrame && refs.length === 0) {
    // Keyframe mode and reference mode are mutually exclusive on H3.
    content.push({ type: "image_url", role: "first_frame", image_url: { url: b.firstFrame } });
  } else {
    let img = 0;
    let vid = 0;
    let aud = 0;
    for (const r of refs) {
      if (content.length > 12) break;
      if (r.kind === "image" && img++ >= 9) continue;
      if (r.kind === "video" && vid++ >= 3) continue;
      if (r.kind === "audio" && aud++ >= 3) continue;
      const spec = ROLE[r.kind];
      if (!spec) continue;
      content.push({ type: spec.type, role: spec.role, [spec.key]: { url: r.dataUrl } });
    }
  }

  const payload = {
    model: process.env.MINIMAX_VIDEO_MODEL || "MiniMax-H3",
    resolution: b.resolution === "2K" ? "2K" : "768P",
    duration: b.durationSec,
    // Text-to-video must state a ratio; image-driven modes follow the image.
    ratio: b.firstFrame ? "adaptive" : b.aspectRatio || "16:9",
    content,
  };

  const res = await fetch(`${MINIMAX_BASE}/v2/video_generation`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(60_000),
  });
  const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) throw new Error(`MiniMax ${res.status}: ${describeError(data)}`);
  const taskId = String(data.task_id ?? (data.task as Record<string, unknown> | undefined)?.id ?? "");
  if (!taskId) throw new Error(`MiniMax returned no task id: ${describeError(data)}`);
  return taskId;
}

interface TaskView {
  status: "queued" | "generating" | "done" | "error";
  url?: string;
  error?: string;
}

async function minimaxQuery(key: string, taskId: string): Promise<TaskView> {
  const res = await fetch(`${MINIMAX_BASE}/v2/query/video_generation/${encodeURIComponent(taskId)}`, {
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

// ----- Vercel AI Gateway ---------------------------------------------------

async function gatewayRender(b: CreateBody): Promise<string> {
  const { experimental_generateVideo: generateVideo } = await import("ai");
  const model = process.env.AUTEUR_GATEWAY_VIDEO_MODEL || "minimax/minimax-h3";
  const images = (b.references ?? []).filter((r) => r.kind === "image").slice(0, 9);

  const input: Record<string, unknown> = {
    model,
    duration: b.durationSec,
    aspectRatio: b.aspectRatio || "16:9",
    providerOptions: { minimax: { pollTimeoutMs: 280_000 } },
  };
  if (b.firstFrame && !images.length) {
    input.prompt = { image: b.firstFrame, text: b.prompt };
  } else {
    input.prompt = b.prompt;
    if (images.length) input.inputReferences = images.map((r) => r.dataUrl);
  }

  const result = await generateVideo(input as never);
  const first = (result as { videos?: { base64?: string; uint8Array?: Uint8Array }[] }).videos?.[0];
  if (first?.base64) return first.base64;
  if (first?.uint8Array) return Buffer.from(first.uint8Array).toString("base64");
  throw new Error("No video returned");
}

// ----- utils ---------------------------------------------------------------

function clampDuration(d: number | undefined): number {
  if (typeof d !== "number" || !Number.isFinite(d)) return 6;
  return Math.min(15, Math.max(4, Math.round(d)));
}

function bad(msg: string) {
  return NextResponse.json({ error: msg }, { status: 400 });
}

function message(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
