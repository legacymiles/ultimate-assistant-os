// ---------------------------------------------------------------------------
// Recall Lists — shared route plumbing.
// Every mutation route funnels through `withCaller` so no handler can forget to
// resolve, and every ListsError turns into its own status rather than a 500.
// ---------------------------------------------------------------------------

import { NextResponse } from "next/server";
import { ListsError, type Caller } from "./store";
import { resolveCaller } from "./session";

export async function readJson<T>(req: Request): Promise<T> {
  try {
    return (await req.json()) as T;
  } catch {
    throw new ListsError("Invalid body.", 400);
  }
}

export function fail(err: unknown): NextResponse {
  if (err instanceof ListsError) {
    return NextResponse.json({ ok: false, error: err.message }, { status: err.status });
  }
  return NextResponse.json({ ok: false, error: "Something went wrong." }, { status: 500 });
}

/**
 * Resolve the caller, run the handler, and map failures to status codes.
 * A caller of `null` is signed out — 401, so the client can bounce to the join
 * screen rather than render an empty board.
 */
export async function withCaller(
  fn: (caller: Caller) => Promise<unknown>,
): Promise<NextResponse> {
  try {
    const caller = await resolveCaller();
    if (!caller) {
      return NextResponse.json({ ok: false, error: "Sign in first." }, { status: 401 });
    }
    return NextResponse.json({ ok: true, ...(await fn(caller) as object) });
  } catch (err) {
    return fail(err);
  }
}
