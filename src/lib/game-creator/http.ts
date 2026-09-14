import "server-only";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { uidForToken } from "./store";

// Who is asking. Browser routes use the signed-in account id that middleware
// stamps into the hub_uid cookie (as the Dashboard inbox routes do); builder
// routes use the owner's builder token, because the program on the PC has no
// browser session and never will.

export async function sessionUid(): Promise<string> {
  return (await cookies()).get("hub_uid")?.value ?? "local";
}

export async function builderUid(req: Request): Promise<string | null> {
  const header = req.headers.get("authorization") ?? "";
  const token = header.toLowerCase().startsWith("bearer ") ? header.slice(7).trim() : "";
  return uidForToken(token);
}

export function unauthorized() {
  return NextResponse.json(
    { error: "Unknown builder token. Copy a fresh one from Game Creator › Connect your PC." },
    { status: 401 },
  );
}

export function notFound() {
  return NextResponse.json({ error: "No such game." }, { status: 404 });
}

export function storageFailed() {
  return NextResponse.json(
    { error: "Could not save. On a deployed host this needs SUPABASE_SERVICE_ROLE_KEY." },
    { status: 500 },
  );
}
