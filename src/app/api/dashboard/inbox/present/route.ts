import { NextResponse } from "next/server";
import { noteCheckIn, noteRefused, prune, uidForToken } from "@/lib/dashboard/inbox";

// POST /api/dashboard/inbox/present
//
// "These are the photos still on my phone." The iPhone Shortcut sends the
// names of its recent photos (the last 30 days by default), and any photo
// waiting in Camera Autopilot from that window that isn't in the list was
// deleted on the phone — so it is deleted here too, and every device drops it
// on its next check. Same key as /push (header or ?key=), session-exempt.
//
// Body: form or JSON with `names` (comma- or newline-separated, or an array)
// and optionally `days`.

export const runtime = "nodejs";

export async function POST(req: Request) {
  const token = req.headers.get("x-dashboard-token") || new URL(req.url).searchParams.get("key") || "";
  const uid = await uidForToken(token);
  if (!uid) {
    await noteRefused(token, "still-on-phone").catch(() => undefined);
    return NextResponse.json({ error: "Unknown device token — make a new link in Jarvis › Camera Autopilot › iPhone setup." }, { status: 401 });
  }

  let raw: unknown = "";
  let days: unknown = 30;
  const type = req.headers.get("content-type") ?? "";
  try {
    if (type.includes("application/json")) {
      const body = await req.json();
      raw = body?.names;
      days = body?.days ?? 30;
    } else if (type.includes("form")) {
      const form = await req.formData();
      raw = form.get("names") ?? form.get("Names") ?? "";
      days = form.get("days") ?? 30;
    } else {
      raw = await req.text();
    }
  } catch {
    return NextResponse.json({ error: "Couldn't read the list of photos." }, { status: 400 });
  }

  const names = (Array.isArray(raw) ? raw.map(String) : String(raw ?? "").split(/[,\n]/)).map((s) => s.trim()).filter(Boolean);
  if (!names.length) return NextResponse.json({ error: "No photo names came through. Set the field to the combined names." }, { status: 400 });
  const window = Math.min(90, Math.max(1, Number(days) || 30));
  await noteCheckIn(uid).catch(() => undefined);
  const removed = await prune(uid, names, window);
  return NextResponse.json({ removed, checked: names.length });
}
