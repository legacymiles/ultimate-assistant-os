import { NextResponse } from "next/server";
import { publishSnapshot } from "@/lib/jarvis/record/inbox";
import { coerceRecord } from "@/lib/jarvis/record/coerce";
import { sessionUid, storageFailed } from "@/lib/jarvis/record/http";

// POST — the Record tab publishes what the extension may type into a form.
//
// Session-authenticated. The body is run through coerceRecord first: a route
// that trusted this body would be trusting the network with the shape of the
// owner's record.

export const runtime = "nodejs";

export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  const record = coerceRecord((body as { record?: unknown })?.record);
  const ok = await publishSnapshot(await sessionUid(), record);
  if (!ok) return storageFailed();
  return NextResponse.json({ published: true });
}
