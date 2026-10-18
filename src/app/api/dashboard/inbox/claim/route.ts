import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { claim } from "@/lib/dashboard/inbox";

// POST /api/dashboard/inbox/claim { ids: string[], keep?: boolean }
//
// Hands the bytes to the browser. Without `keep` they are deleted in the same
// call. With `keep` (what the dashboard uses) they stay until the browser has
// read them in and calls /api/dashboard/inbox/done — so a failed read retries
// on the next check instead of losing the photo. The inbox is a transit
// buffer either way: once a device holds the pixels, the server lets go.
//
// Callers ask for a few photos at a time: a response over ~4.5 MB is refused
// by Vercel, and base64 makes every photo a third bigger.

export const runtime = "nodejs";
export const maxDuration = 120;

export async function POST(req: Request) {
  const uid = (await cookies()).get("hub_uid")?.value ?? "local";
  const body = (await req.json().catch(() => ({}))) as { ids?: string[]; keep?: boolean };
  const ids = Array.isArray(body.ids) ? body.ids.filter((s) => typeof s === "string") : [];
  if (!ids.length) return NextResponse.json({ photos: [] });
  return NextResponse.json({ photos: await claim(uid, ids, { keep: body.keep === true }) });
}
