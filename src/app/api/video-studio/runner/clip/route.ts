import { NextResponse } from "next/server";
import {
  appendChunk,
  assembleUpload,
  clipUploadTarget,
  finishJob,
  putClip,
  registerClip,
  MAX_VIDEO_BYTES,
} from "@/lib/video-studio/server/store";
import { assemble } from "@/lib/video-studio/server/run";
import { runnerUid, bad, notFound, unauthorized } from "@/lib/video-studio/server/http";

// POST /api/video-studio/runner/clip
//
// Several shapes, because a rendered video is far bigger than a request body
// can be (4.5 MB on a deployed function; 10 MB through middleware locally):
//
//   multipart { projectId, which, file }
//       — bytes straight in, for clips under 8 MB
//   JSON { op: "sign", projectId, which }
//       — a signed Storage upload link { key, url }, or 204 on a local hub
//   JSON { op: "done", projectId, which, key, jobId? }
//       — record a file uploaded through that link
//   application/octet-stream ?projectId=&upload=<hex>&index=<n>
//       — one ≤ 8 MB chunk of a large file on a local hub
//   JSON { op: "assemble", projectId, which, upload, bytes, jobId? }
//       — finish that chunked upload
//
// `which` is "final" or a 1-based scene number.

export const runtime = "nodejs";
export const maxDuration = 300;

function whichOf(value: unknown): "final" | number | null {
  if (value === "final" || value === undefined || value === null) return "final";
  const n = Number(value);
  return Number.isInteger(n) && n >= 1 ? n : null;
}

export async function POST(req: Request) {
  const uid = await runnerUid(req);
  if (!uid) return unauthorized();

  const type = req.headers.get("content-type") ?? "";

  if (type.includes("application/octet-stream")) {
    const q = new URL(req.url).searchParams;
    const size = await appendChunk(
      uid,
      q.get("projectId") ?? "",
      q.get("upload") ?? "",
      Number(q.get("index")),
      Buffer.from(await req.arrayBuffer()),
    );
    return size === null
      ? bad("Chunk refused (bad id, order or size)")
      : NextResponse.json({ ok: true, bytes: size });
  }

  if (type.includes("multipart/form-data")) {
    const form = await req.formData();
    const projectId = String(form.get("projectId") ?? "");
    const which = whichOf(form.get("which"));
    const file = form.get("file");
    if (!projectId || which === null || !(file instanceof Blob)) return bad("projectId, which and file are required");
    const bytes = Buffer.from(await file.arrayBuffer());
    if (bytes.length > MAX_VIDEO_BYTES) return bad("Clip is too large.");
    const project = await putClip(uid, projectId, which, bytes, String(form.get("renderedBy") ?? "the runner"));
    if (!project) return notFound();
    const jobId = String(form.get("jobId") ?? "");
    if (jobId) await finishJob(uid, jobId, "done");
    return NextResponse.json({ project: await maybeAssemble(uid, project.id, which) });
  }

  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  const projectId = typeof body?.projectId === "string" ? body.projectId : "";
  const which = whichOf(body?.which);
  if (!projectId || which === null) return bad("projectId and which are required");

  if (body?.op === "sign") {
    const target = await clipUploadTarget(uid, projectId, which);
    // No Storage configured: the runner falls back to chunked upload.
    return target ? NextResponse.json(target) : new NextResponse(null, { status: 204 });
  }

  if (body?.op === "done") {
    const key = typeof body.key === "string" ? body.key : "";
    const project = await registerClip(uid, projectId, which, key, String(body.renderedBy ?? "the runner"));
    if (!project) return bad("That key does not belong to this project.");
    if (typeof body.jobId === "string" && body.jobId) await finishJob(uid, body.jobId, "done");
    return NextResponse.json({ project: await maybeAssemble(uid, project.id, which) });
  }

  if (body?.op === "assemble") {
    const upload = typeof body.upload === "string" ? body.upload : "";
    const bytes = Number(body.bytes);
    const project = await assembleUpload(uid, projectId, which, upload, bytes, String(body.renderedBy ?? "the runner"));
    if (!project) return bad("Could not assemble that upload.");
    if (typeof body.jobId === "string" && body.jobId) await finishJob(uid, body.jobId, "done");
    return NextResponse.json({ project: await maybeAssemble(uid, project.id, which) });
  }

  return bad("Unknown op.");
}

/**
 * A scene clip landing may have completed the set. Joining them here means the
 * runner does not have to know whether the server rendered some of the scenes
 * itself — which it does in AI Director mode.
 */
async function maybeAssemble(uid: string, projectId: string, which: "final" | number) {
  if (which === "final") return null;
  const { getProject } = await import("@/lib/video-studio/server/store");
  const project = await getProject(uid, projectId);
  if (!project) return null;
  const complete = project.scenes.length > 0 && project.scenes.every((s) => s.state === "done");
  return complete && !project.videoKey ? await assemble(uid, projectId) : project;
}
