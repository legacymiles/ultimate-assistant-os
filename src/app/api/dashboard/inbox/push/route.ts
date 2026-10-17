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

  // Forgiving on purpose. Shortcuts is fiddly to wire, and every way of
  // sending a picture should land: a form field named anything ("photos",
  // "Photos", "photo", "file"…), several files at once, or the picture as the
  // whole request body ("Request Body: File"). Only text with no picture in it
  // is refused, and the error says which of those it saw.
  const type = req.headers.get("content-type") ?? "";
  const files: File[] = [];
  let ids: string[] = [];
  let taken: string[] = [];
  const sawText: string[] = [];

  if (type.includes("multipart/form-data") || type.includes("application/x-www-form-urlencoded")) {
    let form: FormData;
    try {
      form = await req.formData();
    } catch {
      return NextResponse.json({ error: "Couldn't read the form. In Get Contents of URL set Request Body to Form (or File)." }, { status: 400 });
    }
    for (const [key, value] of form.entries()) {
      if (value instanceof File) {
        if (value.size > 0) files.push(value);
      } else if (key === "deviceIds") ids = String(value).split(",");
      else if (key === "takenAt") taken = String(value).split(",");
      else sawText.push(key);
    }
  } else {
    // A raw picture as the body.
    const buf = Buffer.from(await req.arrayBuffer());
    if (buf.length) {
      const url = new URL(req.url);
      const name = url.searchParams.get("name") || `photo-${Date.now()}.${type.includes("png") ? "png" : type.includes("heic") ? "heic" : "jpg"}`;
      files.push(new File([buf], name, { type: type.startsWith("image/") ? type : "image/jpeg" }));
    }
  }

  if (!files.length) {
    return NextResponse.json(
      {
        error: sawText.length
          ? `No photos sent — the field "${sawText[0]}" arrived as text. In Get Contents of URL › Request Body, delete it and use Add new field › File, then pick the image.`
          : "No photos sent — the request was empty. Check the photos field points at the image (Converted Image).",
      },
      { status: 400 },
    );
  }

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
