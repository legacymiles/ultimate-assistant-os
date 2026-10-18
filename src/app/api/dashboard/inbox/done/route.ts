import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { done } from "@/lib/dashboard/inbox";

// POST /api/dashboard/inbox/done { ids: string[] }
//
// The browser has read these photos into Camera Autopilot; delete them from
// the inbox. Session-gated by middleware like the rest of /api/dashboard/inbox.

export const runtime = "nodejs";

export async function POST(req: Request) {
  const uid = (await cookies()).get("hub_uid")?.value ?? "local";
  const body = (await req.json().catch(() => ({}))) as { ids?: string[] };
  const ids = Array.isArray(body.ids) ? body.ids.filter((s) => typeof s === "string") : [];
  return NextResponse.json({ removed: ids.length ? await done(uid, ids) : 0 });
}
