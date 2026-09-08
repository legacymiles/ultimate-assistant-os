import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { hasToken, pending } from "@/lib/dashboard/inbox";

// GET /api/dashboard/inbox — what this user's phone has pushed and not yet
// claimed. Session-gated by middleware; the uid cookie identifies whose.

export const runtime = "nodejs";

export async function currentUid(): Promise<string> {
  return (await cookies()).get("hub_uid")?.value ?? "local";
}

export async function GET() {
  const uid = await currentUid();
  const entries = await pending(uid);
  return NextResponse.json({
    linked: await hasToken(uid),
    entries: entries.map((e) => ({
      id: e.id,
      name: e.name,
      bytes: e.bytes,
      takenAt: e.takenAt,
      receivedAt: e.receivedAt,
    })),
  });
}
