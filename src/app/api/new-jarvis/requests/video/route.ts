import { NextResponse } from "next/server";
import { mcpContext } from "@/lib/jarvis/server/mcpAuth";
import { attachVideo, RequestError, videoKey } from "@/lib/new-jarvis/requests";
import { updateRequests } from "@/lib/new-jarvis/server/requestsStore";
import { putVideo, videoUploadLink } from "@/lib/new-jarvis/server/requestVideo";

// ---------------------------------------------------------------------------
// A PC agent sends a finished video back for a queue request.
// Authorization: Bearer <JARVIS_MCP_TOKEN> — the connector's token. Token-exempt
// in middleware by exact path; checked here.
//
//   JSON { op: "sign", id }          → { url, key } — PUT the MP4 there
//                                      (headers Content-Type: video/mp4, x-upsert: true),
//                                      or { local: true } on a hub without Storage
//   JSON { op: "done", id }          → records the upload on the request
//   multipart { id, file }           → the bytes straight in (local hub)
//
// The connector's queue_video_link tool hands an agent the exact commands.
// ---------------------------------------------------------------------------

export const runtime = "nodejs";
export const maxDuration = 300;

export async function POST(req: Request) {
  const ctx = mcpContext(req);
  if (!ctx.available) return NextResponse.json({ error: ctx.reason }, { status: ctx.status });
  const uid = ctx.userId;
  const by = req.headers.get("x-agent") || "claude-code";
  const type = req.headers.get("content-type") ?? "";

  try {
    if (type.includes("multipart/form-data")) {
      const form = await req.formData();
      const id = String(form.get("id") ?? "");
      const file = form.get("file");
      if (!id || !(file instanceof Blob)) return NextResponse.json({ error: "id and file are required." }, { status: 400 });
      const key = await putVideo(uid, id, Buffer.from(await file.arrayBuffer()));
      if (!key) return NextResponse.json({ error: "The video couldn't be stored (too big, or no storage)." }, { status: 500 });
      await updateRequests(uid, (d) => attachVideo(d, id, key, by));
      return NextResponse.json({ ok: true, key });
    }

    const body = (await req.json().catch(() => null)) as { op?: string; id?: string } | null;
    const id = typeof body?.id === "string" ? body.id : "";
    if (!id) return NextResponse.json({ error: "id is required." }, { status: 400 });

    if (body?.op === "sign") {
      const link = await videoUploadLink(uid, id);
      return NextResponse.json(link ?? { local: true });
    }
    if (body?.op === "done") {
      await updateRequests(uid, (d) => attachVideo(d, id, videoKey(uid, id), by));
      return NextResponse.json({ ok: true });
    }
    return NextResponse.json({ error: "Unknown op." }, { status: 400 });
  } catch (e) {
    if (e instanceof RequestError) return NextResponse.json({ error: e.message }, { status: 404 });
    return NextResponse.json({ error: e instanceof Error ? e.message : "Upload failed." }, { status: 500 });
  }
}
