import "server-only";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { uidForToken } from "./store";

// Who is asking. Browser routes use the account id middleware stamps into the
// hub_uid cookie; runner routes use the owner's runner token, because the
// program on the PC has no browser session and never will.

export async function sessionUid(): Promise<string> {
  return (await cookies()).get("hub_uid")?.value ?? "local";
}

export async function runnerUid(req: Request): Promise<string | null> {
  const header = req.headers.get("authorization") ?? "";
  const token = header.toLowerCase().startsWith("bearer ") ? header.slice(7).trim() : "";
  return uidForToken(token);
}

export function unauthorized() {
  return NextResponse.json(
    { error: "Unknown runner token. Copy a fresh one from Video Studio Arena › Integrations." },
    { status: 401 },
  );
}

export function notFound() {
  return NextResponse.json({ error: "No such project." }, { status: 404 });
}

export function bad(message: string) {
  return NextResponse.json({ error: message }, { status: 400 });
}

export function storageFailed() {
  return NextResponse.json(
    { error: "Could not save. On a deployed host this needs SUPABASE_SERVICE_ROLE_KEY." },
    { status: 500 },
  );
}
