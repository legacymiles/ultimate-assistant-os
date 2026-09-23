import "server-only";

import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { uidForToken } from "./bridge";

// Who is asking.
//
// Browser routes use the account id middleware stamps into the hub_uid cookie;
// runner routes use the owner's runner token, because a program on a PC has no
// browser session and never will.

export async function sessionUid(): Promise<string> {
  return (await cookies()).get("hub_uid")?.value ?? "local";
}

export async function runnerUid(request: Request): Promise<string | null> {
  const header = request.headers.get("authorization") ?? "";
  const token = header.toLowerCase().startsWith("bearer ") ? header.slice(7).trim() : "";
  return uidForToken(token);
}

export function unauthorized() {
  return NextResponse.json(
    { error: "Unknown runner token. Copy a fresh one from MP3 Download › Your PC." },
    { status: 401 },
  );
}

export function bad(message: string) {
  return NextResponse.json({ error: message }, { status: 400 });
}
