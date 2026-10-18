import { NextResponse } from "next/server";
import { currentViewer } from "@/lib/client-review/viewer";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/client-review/portal/me — who is looking at the Client Review page,
// so it knows whether to unlock the Admin tab. This only decides what the page
// SHOWS: the admin API itself is owner-only in middleware, so a client who
// forces the tab open gets nothing but "This endpoint is private."
//
// With accounts off (local demo mode) everyone is the owner, as everywhere
// else in the hub.

export async function GET() {
  const viewer = await currentViewer();
  if (viewer === "none") return NextResponse.json({ signedIn: true, owner: true, email: null, accounts: false });
  if (!viewer) return NextResponse.json({ signedIn: false, owner: false, email: null, accounts: true });
  return NextResponse.json(
    { signedIn: true, owner: viewer.owner, email: viewer.email, accounts: true },
    { headers: { "Cache-Control": "no-store" } },
  );
}
