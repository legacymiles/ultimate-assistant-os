import { NextResponse } from "next/server";
import {
  RequestError,
  addRequests,
  completeRequest,
  releaseRequest,
  removeRequest,
  reopenRequest,
  type RequestsDoc,
} from "@/lib/new-jarvis/requests";
import { readRequests, updateRequests } from "@/lib/new-jarvis/server/requestsStore";
import { browserUid } from "@/lib/new-jarvis/server/requestsAuth";

// ---------------------------------------------------------------------------
// In Queue requests, for the browser.
//
//   GET                                   -> { doc }
//   POST { action: "add", folder?, text, images?, from? }   -> { doc, added }
//   POST { action: "complete", id, result? }  — the owner's tick: it leaves the queue
//   POST { action: "remove" | "reopen" | "release", id }
//
// Claude Code reaches the same document through the jarvis-memory connector
// (queue_list / queue_start / queue_note / queue_complete), not through here.
// ---------------------------------------------------------------------------

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Big enough for four downscaled pictures; anything larger is refused before parsing. */
const MAX_BODY = 4_500_000;

function signIn() {
  return NextResponse.json({ error: "Sign in to use your queue." }, { status: 401 });
}

/** The whole doc, pictures included — the folder view shows them as thumbnails. */
export async function GET() {
  const uid = await browserUid();
  if (!uid) return signIn();
  try {
    return NextResponse.json({ doc: await readRequests(uid) });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Couldn't read your queue." }, { status: 500 });
  }
}

export async function POST(req: Request) {
  const uid = await browserUid();
  if (!uid) return signIn();
  const length = Number(req.headers.get("content-length") ?? 0);
  if (length > MAX_BODY) {
    return NextResponse.json({ error: "Those pictures are too big together. Try fewer or smaller ones." }, { status: 413 });
  }
  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body) return NextResponse.json({ error: "That request was empty." }, { status: 400 });
  const id = typeof body.id === "string" ? body.id : "";

  try {
    let added: unknown[] = [];
    const doc = await updateRequests(uid, (d): RequestsDoc => {
      switch (body.action) {
        case "add": {
          const r = addRequests(d, {
            folder: typeof body.folder === "string" ? body.folder : undefined,
            text: typeof body.text === "string" ? body.text : "",
            images: Array.isArray(body.images) ? (body.images as string[]) : [],
            from: body.from === "studio" ? "studio" : "you",
          });
          added = r.added;
          return r.doc;
        }
        case "complete":
          return completeRequest(d, id, "you", typeof body.result === "string" ? body.result : undefined);
        case "remove":
          return removeRequest(d, id);
        case "reopen":
          return reopenRequest(d, id);
        case "release":
          return releaseRequest(d, id);
        default:
          throw new RequestError("Unknown action.");
      }
    });
    return NextResponse.json({ doc, added });
  } catch (e) {
    if (e instanceof RequestError) return NextResponse.json({ error: e.message }, { status: 400 });
    return NextResponse.json({ error: e instanceof Error ? e.message : "Couldn't save that." }, { status: 500 });
  }
}
