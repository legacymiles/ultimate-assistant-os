import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { fail, readJson } from "@/lib/stdsafe/api";
import { COOKIE_OPTIONS, SESSION_COOKIE, mintToken } from "@/lib/stdsafe/session";
import { StdSafeError, mePayload, signIn, signUp } from "@/lib/stdsafe/store";

// Sign up, sign in, sign out. One route, because they all end the same way:
// setting or clearing one cookie.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface Body {
  action?: "signup" | "signin" | "signout";
  handle?: string;
  password?: string;
  displayName?: string;
}

export async function POST(req: Request) {
  try {
    const body = await readJson<Body>(req);
    const jar = await cookies();

    if (body.action === "signout") {
      jar.set(SESSION_COOKIE, "", { ...COOKIE_OPTIONS, maxAge: 0 });
      return NextResponse.json({ ok: true });
    }

    const handle = (body.handle ?? "").trim();
    const password = body.password ?? "";
    if (!handle || !password) throw new StdSafeError("A handle and a passphrase are required.", 400);

    const user =
      body.action === "signup"
        ? (await signUp(handle, password, body.displayName)).user
        : await signIn(handle, password);

    jar.set(SESSION_COOKIE, await mintToken(user.id), COOKIE_OPTIONS);
    // Return the full dashboard so the client renders in one round trip
    // instead of flashing an empty shell between auth and the first load.
    return NextResponse.json({
      ok: true,
      ...(await mePayload({ userId: user.id, handle: user.handle })),
    });
  } catch (err) {
    return fail(err);
  }
}
