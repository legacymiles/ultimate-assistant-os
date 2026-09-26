import { NextResponse } from "next/server";
import { receive, type CapturedValue } from "@/lib/jarvis/record/inbox";
import { cors, extensionUid, preflight, unauthorized } from "@/lib/jarvis/record/http";

// POST /api/jarvis/record/capture/push
//
// What the browser extension posts when the owner saves a form they filled in.
// Authenticated by the extension token, NOT by a session — a content script
// running on someone else's website has no session with this app and never
// will. Its own path, rather than a verb on /capture, because the middleware
// exemption that lets it through is per-path: sharing a path with the Record
// tab's drain would have exempted that too.

export const runtime = "nodejs";
export const maxDuration = 60;

export function OPTIONS() {
  return preflight();
}

export async function POST(req: Request) {
  const uid = await extensionUid(req);
  if (!uid) return cors(unauthorized());

  const body = (await req.json().catch(() => ({}))) as {
    site?: unknown;
    title?: unknown;
    values?: unknown;
  };

  const values: CapturedValue[] = Array.isArray(body.values) ? (body.values as CapturedValue[]) : [];
  if (!values.length) {
    return cors(NextResponse.json({ error: "Nothing to capture." }, { status: 400 }));
  }

  const capture = await receive(uid, {
    site: typeof body.site === "string" ? body.site : "",
    title: typeof body.title === "string" ? body.title : "",
    values,
  });

  if (!capture) {
    return cors(NextResponse.json({ error: "Nothing usable in that capture." }, { status: 400 }));
  }

  return cors(NextResponse.json({ saved: capture.values.length, id: capture.id }));
}
