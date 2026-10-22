import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { receive } from "@/lib/dashboard/inbox";

// POST /api/dashboard/inbox/upload — a photo waiting in Camera Autopilot on
// ONE device (added with the upload button, or brought in before photos were
// shared) goes up to the inbox, so every other device gets it too and the
// phone and the laptop show the same photos. Session-gated by middleware.
//
// Multipart: `photo` (the file), optional `takenAt` (ISO) and `name`.
// Answers { id } — the inbox id the photo now has (or the waiting copy it
// matches) — or { id: null } when it's a copy of one already filed.

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(req: Request) {
  const uid = (await cookies()).get("hub_uid")?.value ?? "local";
  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json({ error: "Couldn't read the photo." }, { status: 400 });
  }
  const file = form.get("photo");
  if (!(file instanceof File) || !file.size) return NextResponse.json({ error: "No photo sent." }, { status: 400 });
  const name = String(form.get("name") || file.name || "photo.jpg");
  const takenAt = String(form.get("takenAt") || "") || undefined;

  const out = await receive(
    uid,
    [{ deviceId: "", name, contentType: file.type || "image/jpeg", takenAt, body: Buffer.from(await file.arrayBuffer()) }],
    { fromBrowser: true },
  );
  if (out.rejected.length) return NextResponse.json({ error: out.rejected[0].reason }, { status: 422 });
  return NextResponse.json({ id: out.ids[0] ?? null });
}
