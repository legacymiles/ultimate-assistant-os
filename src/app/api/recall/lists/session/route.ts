import { NextResponse } from "next/server";
import { fail, readJson } from "@/lib/recall/lists/api";
import { signIn } from "@/lib/recall/lists/store";
import { MEMBER_COOKIE, MEMBER_MAX_AGE, mintMemberToken } from "@/lib/recall/lists/session";

// Member sign-in and sign-out, for people who already accepted an invite.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** POST { name, password } → start a member session. */
export async function POST(req: Request) {
  try {
    const body = await readJson<{ name?: string; password?: string }>(req);
    const member = await signIn(body.name ?? "", body.password ?? "");
    // One message for both a wrong name and a wrong password, so this cannot be
    // used to enumerate who is on the board.
    if (!member) {
      return NextResponse.json(
        { ok: false, error: "That name and password do not match." },
        { status: 401 },
      );
    }
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

/** DELETE → sign out of the member session. */
export async function DELETE() {
  const res = NextResponse.json({ ok: true });
  res.cookies.set(MEMBER_COOKIE, "", { path: "/", maxAge: 0 });
  return res;
}
