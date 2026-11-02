import { NextResponse } from "next/server";
import { noteCheckIn, noteRefused, noteSweep, prune, uidForToken } from "@/lib/dashboard/inbox";

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

  const names = (Array.isArray(raw) ? raw.map(String) : String(raw ?? "").split(/[,\n]/)).map((s) => s.trim()).filter(Boolean);
  if (!names.length)
    return NextResponse.json(
      { error: "No photo names came through. In the last Get Contents of URL, the form field's value must be the blue Combined Text variable — picked off the bar above the keyboard, not typed in." },
      { status: 400 },
    );
  const window = Math.min(90, Math.max(1, Number(days) || 30));
  await noteCheckIn(uid).catch(() => undefined);
  const { removed, refused } = await prune(uid, names, window);
  // Camera Autopilot says this in words, so the run can be checked without
  // reading the Shortcut's result box on a phone.
  await noteSweep(uid, names.length, removed).catch(() => undefined);
  // `refused` is the interesting case and it is read on a phone, in the
  // Shortcut's own result box, so it goes at the top as plain prose.
  if (refused) return NextResponse.json({ error: refused, removed: 0, checked: names.length });
  return NextResponse.json({ removed, checked: names.length });
}
