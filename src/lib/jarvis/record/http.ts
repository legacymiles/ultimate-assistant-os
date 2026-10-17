import "server-only";

// Who is asking a Record route.
//
// Browser routes use the signed-in account id that middleware stamps into the
// hub_uid cookie, exactly as the Dashboard inbox and Game Creator routes do.
// Extension routes use the owner's extension token, because a content script
// running on indeed.com has no session with this app and never will.

import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { tokenFrom, uidForToken } from "./inbox";

export async function sessionUid(): Promise<string> {
  return (await cookies()).get("hub_uid")?.value ?? "local";
}

export async function extensionUid(req: Request): Promise<string | null> {
  return uidForToken(tokenFrom(req));
}

export function unauthorized() {
  return NextResponse.json(
    { error: "Unknown token. Copy a fresh one from New Jarvis › Dashboard › Record › Connect your browser." },
    { status: 401 },
  );
}

export function storageFailed() {
  return NextResponse.json(
    { error: "Could not save. On a deployed host this needs SUPABASE_SERVICE_ROLE_KEY." },
    { status: 500 },
  );
}

/**
 * The extension runs on other people's websites, so every response it reads
 * needs CORS. The token is the only thing that authorises anything here —
 * these routes are cookie-blind — so a permissive origin cannot be used to
 * ride a logged-in session.
 */
export const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Jarvis-Token",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
} as const;

export function cors(res: NextResponse): NextResponse {
  for (const [k, v] of Object.entries(CORS)) res.headers.set(k, v);
  return res;
}

export function preflight(): Response {
  return new Response(null, { status: 204, headers: CORS });
}
