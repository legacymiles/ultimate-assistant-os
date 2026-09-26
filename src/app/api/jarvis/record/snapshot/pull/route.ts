import { NextResponse } from "next/server";
import { snapshot } from "@/lib/jarvis/record/inbox";
import { cors, extensionUid, preflight, unauthorized } from "@/lib/jarvis/record/http";

// GET /api/jarvis/record/snapshot/pull
//
// What the extension fills forms from. Token-authenticated and session-exempt,
// for the same reason as /capture/push. It only ever holds non-sensitive
// values: publishSnapshot strips the Social Security number, the licence
// number and the member ID before any of this is written down, so there is
// nothing here for a leaked token to reach.

export const runtime = "nodejs";

export function OPTIONS() {
  return preflight();
}

export async function GET(req: Request) {
  const uid = await extensionUid(req);
  if (!uid) return cors(unauthorized());
  const snap = await snapshot(uid);
  return cors(NextResponse.json(snap ?? { values: {}, updatedAt: "" }));
}
