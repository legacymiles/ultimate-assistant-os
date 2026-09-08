import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { hasToken, mintToken } from "@/lib/dashboard/inbox";

// POST /api/dashboard/inbox/token — mint or rotate this user's device token.
//
// Returned in the clear exactly once. Only its hash is stored, so this endpoint
// cannot show you a token you already have — it can only replace it, which is
// also what makes rotation meaningful if a Shortcut is ever shared.

export const runtime = "nodejs";

export async function GET() {
  const uid = (await cookies()).get("hub_uid")?.value ?? "local";
  return NextResponse.json({ linked: await hasToken(uid) });
}

export async function POST() {
  const uid = (await cookies()).get("hub_uid")?.value ?? "local";
  const token = await mintToken(uid);
  if (!token) {
    return NextResponse.json(
      { error: "Could not save the token. On a deployed host this needs SUPABASE_SERVICE_ROLE_KEY." },
      { status: 500 },
    );
  }
  return NextResponse.json({ token });
}
