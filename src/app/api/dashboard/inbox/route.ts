import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { pending, phoneStatus } from "@/lib/dashboard/inbox";
import { currentViewer } from "@/lib/client-review/viewer";

// GET /api/dashboard/inbox — what this user's phone has pushed and not yet
// claimed. Session-gated by middleware; the uid cookie identifies whose.

export const runtime = "nodejs";

async function currentUid(): Promise<string> {
  return (await cookies()).get("hub_uid")?.value ?? "local";
}

export async function GET() {
  const uid = await currentUid();
  const entries = await pending(uid);
  const viewer = await currentViewer().catch(() => null);
  const owner = viewer === "none" || Boolean(viewer && viewer.owner);
  // What the phone has been doing — last send, last check-in, an old link,
  // a send turned away — so Camera Autopilot can say WHY nothing came.
  const phone = await phoneStatus(uid, { owner });
  return NextResponse.json({
    ...phone,
    entries: entries.map((e) => ({
      id: e.id,
      name: e.name,
      bytes: e.bytes,
      takenAt: e.takenAt,
      receivedAt: e.receivedAt,
    })),
  });
}
