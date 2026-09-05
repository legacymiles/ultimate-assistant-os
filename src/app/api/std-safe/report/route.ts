import { NextResponse } from "next/server";
import { fail } from "@/lib/stdsafe/api";
import { resolveCaller } from "@/lib/stdsafe/session";
import { contentTypeFor, readReport } from "@/lib/stdsafe/reports";

// Serve a stored lab report — to its owner and nobody else.
//
// The owner is taken from the session, never from the URL, so there is no id to
// tamper with that would reach another person's file. A requester with an
// approved grant still cannot reach this route: a shared view carries results,
// never the document, which has a legal name and a date of birth on it.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  try {
    const caller = await resolveCaller();
    if (!caller) return NextResponse.json({ ok: false, error: "Sign in first." }, { status: 401 });

    const fileId = new URL(req.url).searchParams.get("id") ?? "";
    const bytes = await readReport(caller.userId, fileId);
    if (!bytes) return NextResponse.json({ ok: false, error: "No such file." }, { status: 404 });

    return new NextResponse(new Uint8Array(bytes), {
      headers: {
        "Content-Type": contentTypeFor(fileId),
        "Content-Disposition": "inline",
        // Health data must not sit in a shared or proxy cache.
        "Cache-Control": "private, no-store",
      },
    });
  } catch (err) {
    return fail(err);
  }
}
