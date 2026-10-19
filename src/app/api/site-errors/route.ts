import { NextResponse } from "next/server";
import { openEntries, recentOpen } from "@/lib/site-errors/log";
import { readLog, setResolved } from "@/lib/site-errors/store";
import { isRemoteConfigured } from "@/lib/server/docStore";

// The owner's view of the site-error log (owner-gated in middleware like the
// rest of /api). GET lists; PATCH marks one fixed or re-opens it.

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const log = await readLog();
  const now = new Date();
  return NextResponse.json({
    open: openEntries(log).slice(0, 100),
    week: recentOpen(log, now, 7).length,
    total: log.entries.length,
    resolved: log.entries.filter((e) => e.resolvedAt).length,
    persistent: isRemoteConfigured(),
  });
}

export async function PATCH(req: Request) {
  let body: { id?: unknown; reopen?: unknown };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "That request didn't come through properly." }, { status: 400 });
  }
  if (typeof body.id !== "string" || !body.id) {
    return NextResponse.json({ error: "Which error? The request had no id." }, { status: 400 });
  }
  const log = await setResolved(body.id, body.reopen === true);
  return NextResponse.json({ open: openEntries(log).slice(0, 100) });
}
