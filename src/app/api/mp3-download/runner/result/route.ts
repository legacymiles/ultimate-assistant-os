import { NextResponse } from "next/server";
import {
  jobUploadTarget,
  putJobFile,
  registerJobFile,
  MAX_INLINE_BYTES,
} from "@/lib/mp3-download/server/bridge";
import { bad, runnerUid, unauthorized } from "@/lib/mp3-download/server/auth";

// POST /api/mp3-download/runner/result
//
// Three shapes, because a finished file is far bigger than a request body can
// be (4.5 MB on a deployed function):
//
//   multipart { jobId, file }            — bytes inline, for files under 8 MB
//   JSON { op: "sign", jobId }           — a one-time Storage upload link,
//                                          or 204 on a hub with no Storage
//   JSON { op: "done", jobId, key, bytes } — record a file sent through it
//
// Token-authenticated; session-exempt in middleware by exact path.

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function POST(request: Request) {
  const uid = await runnerUid(request);
  if (!uid) return unauthorized();

  const type = request.headers.get("content-type") ?? "";

  if (type.includes("multipart/form-data")) {
    const form = await request.formData();
    const jobId = String(form.get("jobId") ?? "");
    const file = form.get("file");
    if (!jobId || !(file instanceof Blob)) return bad("jobId and file are required.");

    const bytes = Buffer.from(await file.arrayBuffer());
    if (bytes.length > MAX_INLINE_BYTES) {
      return bad("Too large to send inline — ask for a signed link instead.");
    }
    const saved = await putJobFile(
      uid,
      jobId,
      bytes,
      file.type || "application/octet-stream",
    );
    return saved ? NextResponse.json({ ok: true }) : bad("No such job, or storage refused it.");
  }

  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  const jobId = typeof body?.jobId === "string" ? body.jobId : "";
  if (!jobId) return bad("jobId is required.");

  if (body?.op === "sign") {
    const target = await jobUploadTarget(uid, jobId);
    // No Storage on this hub: the runner falls back to sending bytes inline.
    return target ? NextResponse.json(target) : new NextResponse(null, { status: 204 });
  }

  if (body?.op === "done") {
    const key = typeof body.key === "string" ? body.key : "";
    const bytes = Number(body.bytes) || 0;
    const ok = await registerJobFile(uid, jobId, key, bytes);
    return ok ? NextResponse.json({ ok: true }) : bad("That key does not belong to this job.");
  }

  return bad("Unknown op.");
}
