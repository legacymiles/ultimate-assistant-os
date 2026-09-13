import "server-only";

import { NextResponse } from "next/server";

import { currentUid } from "./library";

export function fail(message: string, status = 400): NextResponse {
  return NextResponse.json({ error: message }, { status });
}

/** The caller's id, or the 401 to return. */
export async function requireUid(): Promise<string | NextResponse> {
  const uid = await currentUid();
  return uid ?? fail("Sign in to use Dance Studio.", 401);
}

export async function readJson<T>(req: Request): Promise<T | null> {
  try {
    return (await req.json()) as T;
  } catch {
    return null;
  }
}

export function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export function nowIso(): string {
  return new Date().toISOString();
}

export function newId(prefix: string): string {
  return `${prefix}_${crypto.randomUUID().replace(/-/g, "").slice(0, 16)}`;
}
