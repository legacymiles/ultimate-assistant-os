import { NextResponse } from "next/server";
import { claim, pending } from "@/lib/jarvis/record/inbox";
import { sessionUid } from "@/lib/jarvis/record/http";

// GET    — the Record tab drains the capture buffer.
// DELETE — the Record tab has dealt with these; drop them.
//
// Session-authenticated and behind the app gate, unlike the /push half that
// the extension uses.

export const runtime = "nodejs";

export async function GET() {
  return NextResponse.json({ captures: await pending(await sessionUid()) });
}

export async function DELETE(req: Request) {
  const { searchParams } = new URL(req.url);
  const ids = (searchParams.get("ids") ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  const dropped = await claim(await sessionUid(), ids.length ? ids : undefined);
  return NextResponse.json({ dropped });
}
