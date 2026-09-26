import { NextResponse } from "next/server";
import { hasToken, mintToken, revokeToken } from "@/lib/jarvis/record/inbox";
import { sessionUid, storageFailed } from "@/lib/jarvis/record/http";

// GET    — is a browser connected?
// POST   — mint or rotate the extension token. Returned in the clear once.
// DELETE — revoke it, which stops the extension dead.
//
// Session-authenticated: only the signed-in owner may mint their own token.

export const runtime = "nodejs";

export async function GET() {
  return NextResponse.json({ connected: await hasToken(await sessionUid()) });
}

export async function POST() {
  const token = await mintToken(await sessionUid());
  if (!token) return storageFailed();
  return NextResponse.json({ token });
}

export async function DELETE() {
  const ok = await revokeToken(await sessionUid());
  if (!ok) return storageFailed();
  return NextResponse.json({ connected: false });
}
