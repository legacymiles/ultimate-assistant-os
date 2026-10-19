import { NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { toCollect } from "@/lib/site-errors/log";
import { readLog } from "@/lib/site-errors/store";

// ---------------------------------------------------------------------------
// The open errors, for super-board's super-collect (`jarvis-errors` custom
// source in .claude/super-board/configs/ultimate-assistant-os.json).
//
// Session-exempt by exact path, so a script on the PC/VPS can read it — and
// therefore ONLY with the bearer token JARVIS_ERRORS_TOKEN. With no token set
// the feed is closed, never open.
// ---------------------------------------------------------------------------

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function tokenOk(header: string | null): boolean {
  const want = process.env.JARVIS_ERRORS_TOKEN ?? "";
  const got = (header ?? "").replace(/^Bearer\s+/i, "");
  if (!want || !got) return false;
  const a = Buffer.from(want);
  const b = Buffer.from(got);
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function GET(req: Request) {
  if (!process.env.JARVIS_ERRORS_TOKEN) {
    return NextResponse.json(
      { error: "The error feed is off. Add JARVIS_ERRORS_TOKEN in Vercel (any long random text) and the same value on the PC running the board." },
      { status: 503 },
    );
  }
  if (!tokenOk(req.headers.get("authorization"))) {
    return NextResponse.json({ error: "That token doesn't match." }, { status: 401 });
  }
  const origin = new URL(req.url).origin;
  return NextResponse.json(toCollect(await readLog(), origin));
}
