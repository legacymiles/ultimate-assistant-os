import { NextResponse } from "next/server";
import { FindError, readPing } from "@/lib/find-my-life/engine";
import { recordFix } from "@/lib/find-my-life/server/run";
import { readFind, uidForPingKey } from "@/lib/find-my-life/server/store";

// ---------------------------------------------------------------------------
// The background door. An iPhone Shortcut (or any automation) calls this with
// the account's private key and a device id:
//
//   GET  /api/find-my-life/ping?k=<key>&d=<device>&lat=…&lng=…&b=<battery 0-100>
//        &e=disconnect|parked   (optional: a Bluetooth thing / CarPlay just dropped off)
//   POST the same fields as JSON or a form
//
// Session-exempt in middleware (exact path); the key is checked here.
// ---------------------------------------------------------------------------

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 15;

async function handle(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const query = Object.fromEntries(url.searchParams.entries());
  const uid = await uidForPingKey(query.k ?? "");
  if (!uid) return NextResponse.json({ ok: false, error: "This Shortcut link isn't valid any more. Copy a fresh one from Find My Life › Setup." }, { status: 401 });

  let body: unknown = null;
  if (req.method === "POST") {
    if (Number(req.headers.get("content-length") ?? 0) > 4000) return NextResponse.json({ ok: false, error: "Too much at once." }, { status: 413 });
    const type = req.headers.get("content-type") ?? "";
    body = type.includes("json")
      ? await req.json().catch(() => null)
      : Object.fromEntries((await req.formData().catch(() => new FormData())).entries());
  }

  const { deviceId, event, fix } = readPing(query, body);
  if (!deviceId) return NextResponse.json({ ok: false, error: "Which device? The link is missing its d= part." }, { status: 400 });
  if (!fix) {
    return NextResponse.json(
      { ok: false, error: "No location came through. In the Shortcut, make sure Latitude and Longitude are filled in from Get Current Location, and Location is allowed for Shortcuts." },
      { status: 400 },
    );
  }
  try {
    const doc = await recordFix(uid, deviceId, fix, await readFind(uid));
    const dev = doc.devices.find((d) => d.id === deviceId);
    const said = event === "parked" ? "Parked spot saved" : event === "disconnect" ? "Last-seen spot saved" : "Location saved";
    return NextResponse.json({ ok: true, message: `${said} for ${dev?.name ?? "your device"}.` });
  } catch (e) {
    const status = e instanceof FindError ? e.status : 500;
    if (status === 500) console.error("find-my-life ping failed:", e);
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : "Couldn't save that." }, { status });
  }
}

export const GET = handle;
export const POST = handle;
