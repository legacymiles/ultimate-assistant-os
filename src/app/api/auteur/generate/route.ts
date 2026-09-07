import { NextResponse } from "next/server";
import {
  activeBackend,
  backendForTask,
  backendSummary,
  tagTask,
  type RenderReference,
} from "@/lib/auteur/server/video";
import type { AspectRatio } from "@/lib/auteur/types";

export const runtime = "nodejs";
// A gateway render finishes inside this request; allow the platform maximum.
export const maxDuration = 300;

// ---------------------------------------------------------------------------
// POST /api/auteur/generate — the studio's one door to a video model.
//
// Actions:
//   create   → start a render; returns a task id, inline bytes, or "done"
//   status   → poll a task
//   download → stream the finished clip back to the browser
//   backend  → which backend is configured (shown in the studio's status line)
//
// Which model actually runs is decided in lib/auteur/server/video: the user's
// own H3 on RunPod, MiniMax's hosted API, the Vercel AI Gateway, or an
// animatic placeholder when nothing is configured.
// ---------------------------------------------------------------------------

interface CreateBody {
  action: "create";
  prompt?: string;
  durationSec?: number;
  aspectRatio?: AspectRatio;
  resolution?: "768P" | "2K";
  references?: RenderReference[];
  firstFrame?: string;
}

type Body =
  | CreateBody
  | { action: "status"; taskId?: string }
  | { action: "download"; taskId?: string }
  | { action: "backend" };

export async function POST(req: Request) {
  let body: Body;
  try {
    body = await req.json();
  } catch {
    return bad("Invalid request body");
  }

  switch (body.action) {
    case "backend":
      return NextResponse.json(backendSummary());

    case "create": {
      const prompt = (body.prompt ?? "").trim();
      if (!prompt) return bad("prompt required");
      const backend = activeBackend();
      const references = (body.references ?? []).filter(
        (r) => r && typeof r.dataUrl === "string" && r.dataUrl.startsWith("data:"),
      );

      try {
        const result = await backend.start({
          prompt,
          durationSec: clampDuration(body.durationSec),
          aspectRatio: body.aspectRatio ?? "16:9",
          resolution: body.resolution === "2K" ? "2K" : "768P",
          references,
          firstFrame: typeof body.firstFrame === "string" ? body.firstFrame : undefined,
        });

        if (result.mode === "async") {
          return NextResponse.json({
            engine: engineName(backend.id),
            mode: "async",
            taskId: tagTask(backend, result.taskId),
          });
        }
        if (result.mode === "inline") {
          return NextResponse.json({ engine: engineName(backend.id), mode: "inline", videoBase64: result.videoBase64 });
        }
        return NextResponse.json({ engine: "placeholder", mode: "done" });
      } catch (err) {
        console.error(`Auteur render failed on ${backend.id}:`, err);
        return NextResponse.json({ engine: engineName(backend.id), error: message(err) }, { status: 502 });
      }
    }

    case "status": {
      const routed = body.taskId ? backendForTask(body.taskId) : null;
      if (!routed?.backend.poll) return bad("unknown or unpollable task");
      try {
        return NextResponse.json(await routed.backend.poll(routed.id));
      } catch (err) {
        return NextResponse.json({ status: "error", error: message(err) });
      }
    }

    case "download": {
      const routed = body.taskId ? backendForTask(body.taskId) : null;
      if (!routed?.backend.fetchVideo) return bad("unknown or undownloadable task");
      try {
        return await routed.backend.fetchVideo(routed.id);
      } catch (err) {
        return NextResponse.json({ error: message(err) }, { status: 502 });
      }
    }

    default:
      return bad("unknown action");
  }
}

/**
 * The studio only distinguishes "a real model rendered this" from "this is an
 * animatic", so every real backend reports as one engine.
 */
function engineName(id: string): "minimax" | "placeholder" {
  return id === "placeholder" ? "placeholder" : "minimax";
}

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
