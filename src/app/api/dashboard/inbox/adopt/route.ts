import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { adoptRefused } from "@/lib/dashboard/inbox";
import { currentViewer } from "@/lib/client-review/viewer";

// POST /api/dashboard/inbox/adopt { at } — "Yes, that's my iPhone".
//
// The phone's Shortcut was refused with a key Jarvis doesn't know (its send
// step can hold on to an old link however many new ones are pasted). The
// owner taps once in Camera Autopilot and that key becomes one of theirs, so
// the next run gets through with no Shortcut editing. Session-gated by
// middleware, owner-only here, and only for a send from the last hour.

export const runtime = "nodejs";

export async function POST(req: Request) {
  const viewer = await currentViewer().catch(() => null);
  const owner = viewer === "none" || Boolean(viewer && viewer.owner);
  if (!owner) return NextResponse.json({ error: "Only the owner can do this." }, { status: 403 });
  const uid = (await cookies()).get("hub_uid")?.value ?? "local";
  const body = (await req.json().catch(() => ({}))) as { at?: string };
  if (!body.at) return NextResponse.json({ error: "Which send? It came without a time." }, { status: 400 });
  const ok = await adoptRefused(uid, body.at);
  if (!ok) {
    return NextResponse.json(
      { error: "Couldn't take that link — it's over an hour old or belongs to someone else. Run the Shortcut again, then tap this." },
      { status: 409 },
    );
  }
  return NextResponse.json({ ok: true });
}
