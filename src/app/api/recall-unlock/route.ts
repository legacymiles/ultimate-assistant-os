import { NextResponse } from "next/server";
import {
  clearPassword,
  sessionToken,
  setPassword,
  status,
  verify,
} from "@/lib/recall/gateStore";

export const runtime = "nodejs";

const COOKIE = "recall_auth";
const MAX_AGE = 60 * 60 * 24 * 30; // 30 days

function withSession(res: NextResponse, token: string) {
  res.cookies.set(COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: MAX_AGE,
  });
  return res;
}

/** GET → is Recall gated, where does the password live, will a change persist. */
export async function GET() {
  return NextResponse.json(await status());
}

/** POST { password } → verify and start a session. */
export async function POST(req: Request) {
  const gate = await status();
  if (!gate.gated) return NextResponse.json({ ok: true, configured: false });

  let body: { password?: string };
  try {
    body = (await req.json()) as { password?: string };
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid body" }, { status: 400 });
  }
  if (!body.password) {
    return NextResponse.json({ ok: false, error: "Missing password" }, { status: 400 });
  }
  if (!(await verify(body.password))) {
    return NextResponse.json({ ok: false, error: "Wrong password" }, { status: 401 });
  }
  return withSession(NextResponse.json({ ok: true, configured: true }), await sessionToken());
}

/**
 * PUT { current, next } → change the app password.
 * Requires the current password even though the caller already holds a session,
 * so a walk-up on an unlocked screen cannot lock the owner out.
 * Changing it invalidates every other session, since the cookie is derived from
 * the secret — the caller is re-issued a fresh one.
 */
export async function PUT(req: Request) {
  let body: { current?: string; next?: string };
  try {
    body = (await req.json()) as { current?: string; next?: string };
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid body" }, { status: 400 });
  }

  const gate = await status();
  // When a password already exists, prove you know it.
  if (gate.gated && !(await verify(body.current ?? ""))) {
    return NextResponse.json({ ok: false, error: "Current password is wrong." }, { status: 401 });
  }

  // An empty `next` removes the password and reopens the app.
  if (!body.next) {
    await clearPassword();
    const res = NextResponse.json({ ok: true, gated: false });
    res.cookies.set(COOKIE, "", { path: "/", maxAge: 0 });
    return res;
  }

  try {
    await setPassword(body.next);
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : "Could not save." },
      { status: 500 },
    );
  }
  return withSession(
    NextResponse.json({ ok: true, ...(await status()) }),
    await sessionToken(),
  );
}

/** DELETE = sign out of Recall. */
export async function DELETE() {
  const res = NextResponse.json({ ok: true });
  res.cookies.set(COOKIE, "", { path: "/", maxAge: 0 });
  return res;
}
