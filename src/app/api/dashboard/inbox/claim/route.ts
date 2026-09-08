import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { claim } from "@/lib/dashboard/inbox";

// POST /api/dashboard/inbox/claim { ids: string[] }
//
// Hands the bytes to the browser and deletes them server-side in the same
// call. The inbox is a transit buffer: once a device holds the pixels, the
// server keeping a second copy is a liability, not a backup.

export const runtime = "nodejs";
export const maxDuration = 120;

export async function POST(req: Request) {
  const uid = (await cookies()).get("hub_uid")?.value ?? "local";
  const body = (await req.json().catch(() => ({}))) as { ids?: string[] };
  const ids = Array.isArray(body.ids) ? body.ids.filter((s) => typeof s === "string") : [];
  if (!ids.length) return NextResponse.json({ photos: [] });
  return NextResponse.json({ photos: await claim(uid, ids) });
}
