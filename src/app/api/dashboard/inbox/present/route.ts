import { NextResponse } from "next/server";
import { noteRefused, uidForToken } from "@/lib/dashboard/inbox";
import { stillOnPhone } from "@/lib/dashboard/stillOnPhone";

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
      days = form.get("days") ?? 30;
      raw = form.get("names") ?? form.get("Names") ?? "";
      // The field name is typed by hand in the Shortcut, so it comes in
      // spelled every way there is. The names are the only thing we are ever
      // sent, so take whatever single text field turned up instead of
      // failing over a label.
      if (!String(raw).trim()) {
        for (const [key, value] of form.entries()) {
          if (key.toLowerCase() === "days") continue;
          if (typeof value === "string" && value.trim()) {
            raw = value;
            break;
          }
        }
      }
    } else {
      raw = await req.text();
    }
  } catch {
    return NextResponse.json({ error: "Couldn't read the list of photos." }, { status: 400 });
  }

  // The same step /inbox/push runs when the clean-up is pointed at the
  // sending link, so the two cannot drift apart.
  const { status, body } = await stillOnPhone(uid, raw, days);
  return NextResponse.json(body, { status });
}
