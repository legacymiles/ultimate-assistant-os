import { cursorFor, noteCheckIn, noteRefused, uidForToken } from "@/lib/dashboard/inbox";

// GET /api/dashboard/inbox/cursor — "where did I get up to?"
//
// The iPhone Shortcut calls this first, then finds photos taken AFTER the date
// it gets back, oldest first, so each run picks up exactly where the last one
// stopped. Plain text, because that is what Shortcuts turns into a date most
// reliably. Same key as /push (header or ?key=), and session-exempt like it.
//
// Before the phone has ever sent a date there is no bookmark, so it answers
// "24 hours ago" (ISO, unambiguous on any phone) rather than the dawn of time —
// oldest-first from nothing would upload the whole camera roll.

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const token = req.headers.get("x-dashboard-token") || new URL(req.url).searchParams.get("key") || "";
  const uid = await uidForToken(token);
  if (!uid) {
    await noteRefused(token).catch(() => undefined);
    return new Response("Unknown device token — make a new link in New Jarvis › Camera Autopilot › iPhone setup.", {
      status: 401,
      headers: { "Content-Type": "text/plain; charset=utf-8" },
    });
  }
  // The Shortcut is running — if it then sends nothing, Jarvis can say
  // "checked in but found no new photos" instead of looking dead.
  await noteCheckIn(uid).catch(() => undefined);
  const raw = (await cursorFor(uid)) ?? new Date(Date.now() - 86_400_000).toISOString();
  return new Response(raw, { headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" } });
}
