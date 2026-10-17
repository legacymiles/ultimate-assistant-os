import { NextResponse } from "next/server";
import { MAX_PER_REQUEST, receive, uidForToken, type IncomingPhoto } from "@/lib/dashboard/inbox";

// POST /api/dashboard/inbox/push
//
// What the iPhone Shortcut posts to. Authenticated by the X-Dashboard-Token
// header or a ?key= on the link, NOT by a session — a Shortcut is not a browser and will never have
// one. This is the only session-exempt API path in the hub (see middleware.ts).
//
// Multipart form-data. Each photo is a `photos` file part; the Shortcut may
// also send `deviceIds` and `takenAt` as parallel comma-separated fields so
// re-sends can be recognised and skipped.

export const runtime = "nodejs";
export const maxDuration = 120;

export async function POST(req: Request) {
  // The header is the original way. The key may also ride in the link itself
  // (?key=…), so building the Shortcut is ONE paste instead of a URL plus a
  // header — the step people got lost on. Same token, same check either way.
  const token = req.headers.get("x-dashboard-token") || new URL(req.url).searchParams.get("key") || "";
  const uid = await uidForToken(token);
  if (!uid) {
    return NextResponse.json(
      { error: "Unknown device token — the link is old or cut off. Make a new one in New Jarvis › Camera Autopilot › iPhone setup." },
      { status: 401 },
    );
  }

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json({ error: "Expected multipart form-data" }, { status: 400 });
  }

  const files = form.getAll("photos").filter((f): f is File => f instanceof File);
  if (!files.length) return NextResponse.json({ error: "No photos sent" }, { status: 400 });

  // Parallel metadata arrays, positionally matched to the files. Shortcuts can
  // build these far more easily than it can build per-file metadata parts.
  const ids = String(form.get("deviceIds") ?? "").split(",");
  const taken = String(form.get("takenAt") ?? "").split(",");

  const photos: IncomingPhoto[] = [];
  for (const [i, f] of files.slice(0, MAX_PER_REQUEST).entries()) {
    photos.push({
      deviceId: (ids[i] ?? "").trim() || `${f.name}:${f.size}`,
      name: f.name || `photo-${i + 1}.jpg`,
      contentType: f.type || "image/jpeg",
      takenAt: (taken[i] ?? "").trim() || undefined,
      body: Buffer.from(await f.arrayBuffer()),
    });
  }

  const result = await receive(uid, photos);
  return NextResponse.json(result);
}
