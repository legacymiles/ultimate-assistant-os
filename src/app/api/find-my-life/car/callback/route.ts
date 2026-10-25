import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { linkVehicles } from "@/lib/find-my-life/server/run";
import { readCar, writeCar } from "@/lib/find-my-life/server/store";
import { browserUid } from "@/lib/new-jarvis/server/requestsAuth";

// Smartcar sends the owner back here with their user_id (or an error). The
// state must match the one we made for this account in the last 15 minutes.

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

function same(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const back = (q: string) => NextResponse.redirect(`${url.origin}/apps/find-my-life?car=${q}`);
  const uid = await browserUid();
  if (!uid) return back("signin");
  const saved = await readCar(uid);
  const state = url.searchParams.get("state") ?? "";
  if (!saved.state || !state || !same(saved.state, state) || Date.now() - (saved.stateAt ?? 0) > 15 * 60_000) return back("expired");
  const error = url.searchParams.get("error");
  if (error) {
    await writeCar(uid, { ...saved, state: undefined, stateAt: undefined });
    return back(error === "access_denied" ? "cancelled" : "unsupported");
  }
  const scUserId = url.searchParams.get("user_id") ?? "";
  if (!/^[a-zA-Z0-9._-]{4,100}$/.test(scUserId)) return back("failed");
  await writeCar(uid, { scUserId, state: undefined, stateAt: undefined });
  try {
    const n = await linkVehicles(uid, scUserId);
    return back(n ? "connected" : "none");
  } catch (e) {
    console.error("find-my-life car link failed:", e);
    return back("failed");
  }
}
