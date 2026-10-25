import { NextResponse } from "next/server";
import { RequestError, addRequests, attachVideo, completeRequest, videoKey } from "@/lib/new-jarvis/requests";
import { updateRequests } from "@/lib/new-jarvis/server/requestsStore";
import { browserUid } from "@/lib/new-jarvis/server/requestsAuth";
import { putVideo, videoUploadLink } from "@/lib/new-jarvis/server/requestVideo";

// ---------------------------------------------------------------------------
// A film the owner rendered IN THE BROWSER (3D Animation Flow › Render › Make
// it here), filed with their films so it plays on every device.
//
// It becomes an In Queue request in flow:film-3d that is finished the moment
// it is filed — the same record a PC render leaves, so the Watch stage and the
// films list treat both alike, and "ask for changes" can send it to the PC.
//
//   JSON { op: "start", text }      → { id, url? } — PUT the MP4 to url (deployed),
//                                      or { id, local: true } → post the file here
//   multipart { id, file }          → stores the bytes (local hub)
//   JSON { op: "done", id, result } → records the video and finishes the request
// ---------------------------------------------------------------------------

export const runtime = "nodejs";
export const maxDuration = 120;

const FOLDER = "flow:film-3d";

export async function POST(req: Request) {
  const uid = await browserUid();
  if (!uid) return NextResponse.json({ error: "Sign in to keep your films on every device." }, { status: 401 });
  const type = req.headers.get("content-type") ?? "";
  try {
    if (type.includes("multipart/form-data")) {
      const form = await req.formData();
      const id = String(form.get("id") ?? "");
      const file = form.get("file");
      if (!id || !(file instanceof Blob)) return NextResponse.json({ error: "id and file are required." }, { status: 400 });
      const key = await putVideo(uid, id, Buffer.from(await file.arrayBuffer()));
      if (!key) return NextResponse.json({ error: "The video couldn't be stored (too big, or no storage)." }, { status: 500 });
      return NextResponse.json({ ok: true });
    }
    const body = (await req.json().catch(() => null)) as { op?: string; id?: string; text?: string; result?: string } | null;
    if (body?.op === "start") {
      const text = typeof body.text === "string" ? body.text : "";
      let id = "";
      await updateRequests(uid, (d) => {
        const r = addRequests(d, { folder: FOLDER, text, from: "studio" });
        id = r.added[0]?.id ?? "";
        return r.doc;
      });
      if (!id) return NextResponse.json({ error: "That exact film is already being filed." }, { status: 409 });
      const link = await videoUploadLink(uid, id);
      return NextResponse.json(link ? { id, url: link.url } : { id, local: true });
    }
    const id = typeof body?.id === "string" ? body.id : "";
    if (body?.op === "done" && id) {
      const doc = await updateRequests(uid, (d) =>
        completeRequest(attachVideo(d, id, videoKey(uid, id), "this browser"), id, "this browser", typeof body.result === "string" ? body.result : undefined),
      );
      return NextResponse.json({ ok: true, doc });
    }
    return NextResponse.json({ error: "Unknown op." }, { status: 400 });
  } catch (e) {
    if (e instanceof RequestError) return NextResponse.json({ error: e.message }, { status: 400 });
    return NextResponse.json({ error: e instanceof Error ? e.message : "Couldn't file the film." }, { status: 500 });
  }
}
