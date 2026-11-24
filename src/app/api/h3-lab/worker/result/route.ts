import { NextResponse } from "next/server";
import type { ResultRequest } from "@/lib/h3-lab/api";
import { applyResult, log } from "@/lib/h3-lab/state";
import { mutateLab, saveFrames, saveWorker } from "@/lib/h3-lab/server/store";
import { bad, readJson, unauthorized, workerUid } from "@/lib/h3-lab/server/http";

// POST /api/h3-lab/worker/result — a finished (or failed) render: where the
// clip is, what ffmpeg measured, and the judging frames. Measured scores and
// measured continuity issues are computed here at once; the vision judge runs
// later as an agent step.

export const runtime = "nodejs";

const FRAME = /^data:image\/jpeg;base64,[A-Za-z0-9+/=]+$/;

export async function POST(req: Request) {
  const uid = await workerUid(req);
  if (!uid) return unauthorized();
  const body = await readJson<ResultRequest>(req);
  if (!body?.generationId) return bad("generationId is required.");
  const frames = (body.frames ?? []).filter((f) => typeof f === "string" && FRAME.test(f) && f.length < 400_000).slice(0, 12);
  if (frames.length) await saveFrames(uid, body.generationId, frames);
  await saveWorker(uid, {
    current: null,
    wangp: "ready",
    wangpDetail: body.ok ? "Last render finished." : `Last render failed: ${String(body.error ?? "").slice(0, 200)}`,
  });
  const now = new Date().toISOString();
  await mutateLab(uid, (s) => {
    const g = applyResult(
      s,
      body.generationId,
      {
        ok: Boolean(body.ok),
        error: body.error,
        renderSeconds: body.renderSeconds,
        clipKey: body.clipKey ?? null,
        localPath: body.localPath ?? null,
        bytes: body.bytes,
        metrics: body.metrics,
        frameCount: frames.length,
      },
      now,
    );
    if (!g) return;
    if (body.ok) {
      log(s, "worker", "render", `Rendered ${g.genre} (${g.arm}) in ${body.renderSeconds ? `${(body.renderSeconds / 60).toFixed(1)} min` : "an unrecorded time"}.`, { type: "generation", id: g.id }, now);
      if (body.metrics) {
        const issues = (g.issues ?? []).length;
        log(s, "worker", "measure", `Measured it: ${body.metrics.cuts.length} cut(s), lowest SSIM ${body.metrics.ssimMin.toFixed(2)}, camera reads as ${body.metrics.measuredMove}; ${issues} measured issue${issues === 1 ? "" : "s"}.`, { type: "generation", id: g.id }, now);
      }
    } else {
      log(s, "worker", "error", `A render failed: ${String(body.error ?? "unknown error").slice(0, 300)}`, { type: "generation", id: g.id }, now);
    }
  });
  return NextResponse.json({ ok: true });
}
