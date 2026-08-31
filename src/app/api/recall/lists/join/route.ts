import { NextResponse } from "next/server";
import { fail, readJson } from "@/lib/recall/lists/api";
import { checkInvite, consumeInvite } from "@/lib/recall/lists/store";
import { MEMBER_COOKIE, MEMBER_MAX_AGE, mintMemberToken } from "@/lib/recall/lists/session";

// Accepting an invite. Public by necessity — the token IS the authorisation.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET ?t=<token> → is this link usable, and which colours are still free.
 * Never distinguishes expired from consumed from never-existed: all three are
 * the same answer to whoever is holding the link.
 */
export async function GET(req: Request) {
  const token = new URL(req.url).searchParams.get("t") ?? "";
  try {
    return NextResponse.json(await checkInvite(token));
  } catch (err) {
    return fail(err);
  }
}

/** POST { token, name, colour, password } → become a member and sign in. */
export async function POST(req: Request) {
  try {
    const body = await readJson<{
      token?: string;
      name?: string;
      colour?: string;
      password?: string;
    }>(req);
    const member = await consumeInvite({
      token: body.token ?? "",
      name: body.name ?? "",
      colour: body.colour ?? "",
      password: body.password ?? "",
    });
    const res = NextResponse.json({ ok: true, name: member.name });
    res.cookies.set(MEMBER_COOKIE, await mintMemberToken(member.id), {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: MEMBER_MAX_AGE,
    });
    return res;
  } catch (err) {
    return fail(err);
  }
}
