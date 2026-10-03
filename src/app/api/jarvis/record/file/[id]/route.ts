// GET /api/jarvis/record/file/<id> — the picture itself.
//
// Streamed through the route rather than handed out as a signed URL. A signed
// link to a photograph of an insurance card is a bearer token for that card:
// anyone holding the string has it, with no session and no second check. Here
// the caller is re-checked on every view, and the key is built from THEIR id,
// so asking for someone else's picture reads a path that does not exist.

import { NextResponse } from "next/server";
import { currentUid, getRecordFile, validId } from "@/lib/jarvis/record/server/files";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const uid = await currentUid();
  if (!uid) return NextResponse.json({ error: "Sign in first." }, { status: 401 });

  const { id } = await ctx.params;
  if (!validId(id)) return NextResponse.json({ error: "Bad file id." }, { status: 400 });

  const found = await getRecordFile(uid, id);
  if (!found) return NextResponse.json({ error: "No such picture." }, { status: 404 });

  return new NextResponse(new Uint8Array(found.body), {
    headers: {
      "Content-Type": found.mime,
      "Content-Length": String(found.body.length),
      // Private and short: this may be an SSN card, and a shared cache or a
      // disk copy of it outliving the tab is exactly what should not happen.
      "Cache-Control": "private, max-age=60, no-store",
      "Content-Disposition": "inline",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
