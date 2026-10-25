import { randomBytes } from "node:crypto";
import { NextResponse } from "next/server";
import { connectUrl, smartcarConfigured } from "@/lib/find-my-life/server/smartcar";
import { readCar, writeCar } from "@/lib/find-my-life/server/store";
import { browserUid } from "@/lib/new-jarvis/server/requestsAuth";

// "Connect car" → Smartcar's own sign-in, where the owner picks their car brand
// and approves location, fuel/charge and locks. Comes back to ./callback.

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const origin = new URL(req.url).origin;
  const back = (q: string) => NextResponse.redirect(`${origin}/apps/find-my-life?car=${q}`);
  const uid = await browserUid();
  if (!uid) return back("signin");
  if (!smartcarConfigured()) return back("keys");
  const state = randomBytes(16).toString("hex");
  await writeCar(uid, { ...(await readCar(uid)), state, stateAt: Date.now() });
  return NextResponse.redirect(connectUrl(origin, state));
}
