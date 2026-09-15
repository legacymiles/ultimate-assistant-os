import { NextResponse } from "next/server";
import { builderUid, notFound, unauthorized } from "@/lib/studio3d/http";
import {
  MAX_STILL_BYTES,
  MAX_VIDEO_BYTES,
  appendChunk,
  assembleUpload,
  mediaUploadTarget,
  putMedia,
  registerUploaded,
  type MediaKind,
} from "@/lib/studio3d/store";

// POST /api/studio3d/builder/media
//
// Several shapes, because a finished render is far bigger than a request body
// can be (4.5 MB on a deployed function; 10 MB through middleware locally):
//   multipart { projectId, kind: still|video, file, name, caption?, sceneId? }
//        — bytes straight in (files under 8 MB)
//   JSON { op: "sign", projectId, kind, contentType }
//        — a signed Storage upload link { key, url }, or 204 on a local hub
//   JSON { op: "done", projectId, kind, key, bytes, contentType, name, caption?, sceneId? }
//        — record a file uploaded through that link
//   application/octet-stream ?projectId=&upload=<hex id>&index=<n>
//        — one ≤ 8 MB chunk of a large file on a local hub
//   JSON { op: "assemble", projectId, kind, upload, bytes, contentType, name, caption?, sceneId? }
//        — finish that chunked upload

export const runtime = "nodejs";
export const maxDuration = 300;

const STILL_TYPES = /^image\/(png|jpeg|webp)$/;
const VIDEO_TYPES = /^video\/(mp4|webm|quicktime)$/;

function checkType(kind: MediaKind, type: string): boolean {
  return kind === "video" ? VIDEO_TYPES.test(type) : STILL_TYPES.test(type);
}

const clip = (v: unknown, max: number) => (typeof v === "string" && v.trim() ? v.trim().slice(0, max) : undefined);

export async function POST(req: Request) {
  const uid = await builderUid(req);
  if (!uid) return unauthorized();

  const type = req.headers.get("content-type") ?? "";

  if (type.includes("application/octet-stream")) {
    const q = new URL(req.url).searchParams;
    const size = await appendChunk(uid, q.get("projectId") ?? "", q.get("upload") ?? "", Number(q.get("index")), Buffer.from(await req.arrayBuffer()));
    return size === null ? NextResponse.json({ error: "Chunk refused (bad id, order or size)" }, { status: 400 }) : NextResponse.json({ ok: true, bytes: size });
  }

  if (type.includes("application/json")) {
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const projectId = clip(body.projectId, 100);
    const kind: MediaKind = body.kind === "video" ? "video" : "still";
    const contentType = clip(body.contentType, 60) ?? (kind === "video" ? "video/mp4" : "image/png");
    if (!projectId) return NextResponse.json({ error: "projectId is required" }, { status: 400 });
    if (!checkType(kind, contentType)) return NextResponse.json({ error: `Unsupported ${kind} type ${contentType}` }, { status: 415 });

    if (body.op === "sign") {
      const target = await mediaUploadTarget(uid, projectId, kind, contentType);
      return target ? NextResponse.json(target) : new NextResponse(null, { status: 204 });
    }
    if (body.op === "done") {
      const key = clip(body.key, 300);
      const bytes = typeof body.bytes === "number" ? body.bytes : 0;
      if (!key) return NextResponse.json({ error: "key is required" }, { status: 400 });
      const project = await registerUploaded(uid, projectId, kind, key, bytes, {
        contentType,
        file: clip(body.name, 120),
        caption: clip(body.caption, 200),
        sceneId: clip(body.sceneId, 60),
      });
      return project ? NextResponse.json({ ok: true }) : notFound();
    }
    if (body.op === "assemble") {
      const upload = clip(body.upload, 64) ?? "";
      const bytes = typeof body.bytes === "number" ? body.bytes : -1;
      const project = await assembleUpload(uid, projectId, kind, upload, bytes, {
        contentType,
        file: clip(body.name, 120),
        caption: clip(body.caption, 200),
        sceneId: clip(body.sceneId, 60),
      });
      return project
        ? NextResponse.json({ ok: true, stills: project.stills.length, video: Boolean(project.video) })
        : NextResponse.json({ error: "Could not assemble the upload (missing chunks or size mismatch)" }, { status: 400 });
    }
    return NextResponse.json({ error: "Unknown op" }, { status: 400 });
  }

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json({ error: "Expected multipart form-data or JSON" }, { status: 400 });
  }
  const projectId = String(form.get("projectId") ?? "");
  const kind: MediaKind = form.get("kind") === "video" ? "video" : "still";
  const file = form.get("file");
  if (!projectId || !(file instanceof File)) return NextResponse.json({ error: "projectId and file are required" }, { status: 400 });
  const max = kind === "video" ? MAX_VIDEO_BYTES : MAX_STILL_BYTES;
  if (file.size > max) return NextResponse.json({ error: `${kind} is too large` }, { status: 413 });
  const fileType = file.type || (kind === "video" ? "video/mp4" : "image/png");
  if (!checkType(kind, fileType)) return NextResponse.json({ error: `Unsupported ${kind} type ${fileType}` }, { status: 415 });

  const project = await putMedia(uid, projectId, kind, Buffer.from(await file.arrayBuffer()), {
    contentType: fileType,
    file: clip(form.get("name"), 120) ?? clip(file.name, 120),
    caption: clip(form.get("caption"), 200),
    sceneId: clip(form.get("sceneId"), 60),
  });
  if (!project) return notFound();
  return NextResponse.json({ ok: true, stills: project.stills.length, video: Boolean(project.video) });
}
