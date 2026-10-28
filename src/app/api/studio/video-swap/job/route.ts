import { NextResponse } from "next/server";
import { RequestError, addRequests, attachInput, inputKey, removeRequest } from "@/lib/new-jarvis/requests";
import { updateRequests } from "@/lib/new-jarvis/server/requestsStore";
import { browserUid } from "@/lib/new-jarvis/server/requestsAuth";
import { hasBlob, inputUploadLink, putInput } from "@/lib/new-jarvis/server/requestVideo";
import { SWAP_FOLDER } from "@/lib/studio/video-swap/plan";

// ---------------------------------------------------------------------------
// Custom Video Swap › Make it — file the job WITH its driving video.
//
// A clip is far bigger than a function body (4.5 MB deployed), so it goes
// straight to Storage through a one-time signed link, the same way a finished
// film comes back:
//
//   JSON { op: "start", text, images } → { id, url } — PUT the clip to url (deployed)
//                                       or { id, local: true } → post it here
//   multipart { id, file }             → stores the clip (local hub)
//   JSON { op: "ready", id }           → checks the clip landed, records it on the
//                                        request (now the PC sees a download link)
//   JSON { op: "cancel", id }          → the upload failed: take the half-job back
//
// Until "ready", the request has no clip and the brief says to wait for it, so
// a PC that picks it up early notes the gap instead of swapping nothing.
// ---------------------------------------------------------------------------

export const runtime = "nodejs";
export const maxDuration = 120;

export async function POST(req: Request) {
  const uid = await browserUid();
  if (!uid) return NextResponse.json({ error: "Sign in so your PC can see the job." }, { status: 401 });
  const type = req.headers.get("content-type") ?? "";
  try {
    if (type.includes("multipart/form-data")) {
      const form = await req.formData();
      const id = String(form.get("id") ?? "");
      const file = form.get("file");
      if (!id || !(file instanceof Blob)) return NextResponse.json({ error: "id and file are required." }, { status: 400 });
      const key = await putInput(uid, id, Buffer.from(await file.arrayBuffer()), file.type || "video/mp4");
      if (!key) return NextResponse.json({ error: "The clip couldn't be stored (over 200 MB, or no storage)." }, { status: 413 });
      return NextResponse.json({ ok: true });
    }

    const body = (await req.json().catch(() => null)) as { op?: string; id?: string; text?: string; images?: unknown } | null;
    if (body?.op === "start") {
      const text = typeof body.text === "string" ? body.text : "";
      const images = Array.isArray(body.images) ? body.images.filter((i): i is string => typeof i === "string") : [];
      let id = "";
      await updateRequests(uid, (d) => {
        const r = addRequests(d, { folder: SWAP_FOLDER, text, images, from: "studio" });
        id = r.added[0]?.id ?? "";
        return r.doc;
      });
      if (!id) return NextResponse.json({ error: "That exact swap is already in your queue." }, { status: 409 });
      const link = await inputUploadLink(uid, id);
      return NextResponse.json(link ? { id, url: link.url } : { id, local: true });
    }

    const id = typeof body?.id === "string" ? body.id : "";
    if (body?.op === "ready" && id) {
      const key = inputKey(uid, id);
      if (!(await hasBlob(key))) {
        return NextResponse.json({ error: "The clip didn't finish uploading. Try Make it again." }, { status: 409 });
      }
      const doc = await updateRequests(uid, (d) => attachInput(d, id, key, "this browser"));
      return NextResponse.json({ ok: true, doc });
    }
    if (body?.op === "cancel" && id) {
      const doc = await updateRequests(uid, (d) => removeRequest(d, id));
      return NextResponse.json({ ok: true, doc });
    }
    return NextResponse.json({ error: "Unknown op." }, { status: 400 });
  } catch (e) {
    if (e instanceof RequestError) return NextResponse.json({ error: e.message }, { status: 400 });
    return NextResponse.json({ error: e instanceof Error ? e.message : "Couldn't file the swap." }, { status: 500 });
  }
}
