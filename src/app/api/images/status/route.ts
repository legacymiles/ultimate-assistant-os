import { NextResponse } from "next/server";

import { freeLaneStatus } from "@/lib/images/server/draw";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/images/status?purpose=branded|placeholder
//
// Which lane would draw a picture right now, and why. The UI reads this to
// say "free, on your PC" instead of leaving the owner to guess whether the
// next picture costs money.
export async function GET(req: Request) {
  const purpose = new URL(req.url).searchParams.get("purpose") === "placeholder" ? "placeholder" : "branded";
  try {
    return NextResponse.json(await freeLaneStatus(purpose));
  } catch (err) {
    // Never a stack on a status endpoint (R3) — say it plainly and carry on.
    return NextResponse.json({
      localUp: false,
      freeAllowed: false,
      order: [],
      why: "Couldn't check the picture drawers.",
      detail: err instanceof Error ? err.message.slice(0, 200) : undefined,
    });
  }
}
