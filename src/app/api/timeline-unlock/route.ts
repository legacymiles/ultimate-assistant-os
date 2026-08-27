import { NextResponse } from "next/server";
import { timelineHash } from "@/middleware";

export const runtime = "nodejs";

// POST { password: string }
// 200 → sets the `timeline_auth` cookie with a hash of the password.
// 401 → password doesn't match (or no password configured server-side).
export async function POST(req: Request) {
  const env = process.env.TIMELINE_PASSWORD ?? "";
  if (!env) {
    // No password configured = workspace isn't private. Treat as success so the
    // unlock page doesn't lock the user out in local dev.
    return NextResponse.json({ ok: true, configured: false });
  }

  let body: { password?: string };
  try {
    body = (await req.json()) as { password?: string };
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid body" }, { status: 400 });
  }
  if (!body.password) {
    return NextResponse.json({ ok: false, error: "Missing password" }, { status: 400 });
  }
  if (body.password !== env) {
    return NextResponse.json({ ok: false, error: "Wrong password" }, { status: 401 });
  }

  const hash = await timelineHash(env);
  const res = NextResponse.json({ ok: true, configured: true });
  res.cookies.set("timeline_auth", hash, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 24 * 30, // 30 days
  });
  return res;
}

// DELETE = sign out of the timeline workspace.
export async function DELETE() {
  const res = NextResponse.json({ ok: true });
  res.cookies.set("timeline_auth", "", { path: "/", maxAge: 0 });
  return res;
}
