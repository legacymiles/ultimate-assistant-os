import { NextResponse } from "next/server";
import {
  ackRing,
  addDevice,
  cleanFix,
  FindError,
  pingUrl,
  removeDevice,
  removePlace,
  renameDevice,
  ring,
  savePlace,
  setBtName,
  setCar,
  setLost,
  setShareLink,
  setTag,
  type Doc,
} from "@/lib/find-my-life/engine";
import { refreshCars, recordFix } from "@/lib/find-my-life/server/run";
import { smartcarConfigured } from "@/lib/find-my-life/server/smartcar";
import { pingKeyFor, readCar, readFind, updateFind, wipeFind, writeCar } from "@/lib/find-my-life/server/store";
import { browserUid } from "@/lib/new-jarvis/server/requestsAuth";

// ---------------------------------------------------------------------------
// Find My Life, for the browser.
//
//   GET                       -> view (devices, places, ping base, car status)
//   POST { action, ... }      -> the same view, after the change
//
// Actions: device.add {kind, name?, tag?, btName?, id?} · device.rename {id, name}
// · device.remove {id} · device.tag {id, tag} · device.bt {id, btName}
// · device.share {id, url|null} · device.lost {id, lost} · device.ring {id}
// · device.ack {id} · fix.self {id, fix} (this browser reports itself)
// · fix.manual {id, lat, lng} · place.save {name, lat, lng} · place.remove {id}
// · car.refresh · car.disconnect · key.rotate · all.delete
// ---------------------------------------------------------------------------

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

const MAX_BODY = 20_000;

function signIn() {
  return NextResponse.json({ error: "Sign in to Jarvis to see your devices." }, { status: 401 });
}

async function view(req: Request, uid: string, doc: Doc, extra: { carError?: string; rotate?: boolean } = {}) {
  const origin = new URL(req.url).origin;
  let ping = "";
  let pingError = "";
  try {
    const key = await pingKeyFor(uid, extra.rotate);
    // The template with a placeholder id; the page swaps in each device's id.
    ping = pingUrl(origin, key, "DEVICE");
  } catch (e) {
    pingError = e instanceof Error ? e.message : "Couldn't make your Shortcut link.";
  }
  const car = await readCar(uid);
  return NextResponse.json({
    doc,
    ping,
    pingError,
    car: { configured: smartcarConfigured(), connected: Boolean(car.scUserId), error: extra.carError },
    now: new Date().toISOString(),
  });
}

export async function GET(req: Request) {
  const uid = await browserUid();
  if (!uid) return signIn();
  try {
    const { doc, error } = await refreshCars(uid, await readFind(uid));
    return await view(req, uid, doc, { carError: error });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Couldn't open your devices." }, { status: 500 });
  }
}

export async function POST(req: Request) {
  const uid = await browserUid();
  if (!uid) return signIn();
  if (Number(req.headers.get("content-length") ?? 0) > MAX_BODY) return NextResponse.json({ error: "That's too much at once." }, { status: 413 });
  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body || typeof body.action !== "string") return NextResponse.json({ error: "Nothing to do." }, { status: 400 });
  const id = typeof body.id === "string" ? body.id : "";

  try {
    const change = (fn: (doc: Doc) => Doc) => updateFind(uid, (doc) => ({ doc: fn(doc), out: null })).then((r) => r.doc);
    let doc: Doc;
    let carError: string | undefined;
    switch (body.action) {
      case "device.add": {
        const { doc: next } = await updateFind(uid, (d) => {
          const r = addDevice(d, { kind: body.kind as never, name: body.name as string, tag: body.tag as never, btName: body.btName as string, id: body.id as string });
          return { doc: r.doc, out: r.device };
        });
        doc = next;
        break;
      }
      case "device.rename":
        doc = await change((d) => renameDevice(d, id, body.name));
        break;
      case "device.remove":
        doc = await change((d) => removeDevice(d, id));
        break;
      case "device.tag":
        doc = await change((d) => setTag(d, id, body.tag));
        break;
      case "device.bt":
        doc = await change((d) => setBtName(d, id, body.btName));
        break;
      case "device.share":
        doc = await change((d) => setShareLink(d, id, body.url));
        break;
      case "device.lost":
        doc = await change((d) => setLost(d, id, body.lost === true));
        break;
      case "device.ring":
        doc = await change((d) => ring(d, id));
        break;
      case "device.ack":
        doc = await change((d) => ackRing(d, id));
        break;
      case "fix.self":
      case "fix.manual": {
        const source = body.action === "fix.self" ? "self" : "manual";
        const raw = body.action === "fix.self" ? body.fix : { lat: body.lat, lng: body.lng, detail: "Pinned by you" };
        const fix = cleanFix(raw, source);
        if (!fix) throw new FindError("That location didn't come through. Allow location for this site and try again.");
        doc = await recordFix(uid, id, fix, await readFind(uid));
        break;
      }
      case "place.save":
        doc = await change((d) => savePlace(d, { name: body.name, lat: body.lat, lng: body.lng }));
        break;
      case "place.remove":
        doc = await change((d) => removePlace(d, id));
        break;
      case "car.refresh": {
        const r = await refreshCars(uid, await readFind(uid), true);
        doc = r.doc;
        carError = r.error;
        break;
      }
      case "car.disconnect": {
        await writeCar(uid, {});
        doc = await change((d) => d.devices.reduce((acc, dev) => (dev.carId ? setCar(acc, dev.id, undefined) : acc), d));
        break;
      }
      case "key.rotate":
        return await view(req, uid, await readFind(uid), { rotate: true });
      case "all.delete":
        await wipeFind(uid);
        doc = await readFind(uid);
        break;
      default:
        return NextResponse.json({ error: "Unknown action." }, { status: 400 });
    }
    return await view(req, uid, doc, { carError });
  } catch (e) {
    const status = e instanceof FindError ? e.status : 500;
    if (status === 500) console.error("find-my-life failed:", e);
    return NextResponse.json({ error: e instanceof Error ? e.message : "That didn't work. Try again." }, { status });
  }
}
