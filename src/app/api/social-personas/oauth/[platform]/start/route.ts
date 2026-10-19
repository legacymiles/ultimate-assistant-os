import { NextResponse } from "next/server";
import { authorizeUrl, isConfigured } from "@/lib/social-personas/server/connectors";
import { asPlatform, fail, publicOrigin } from "@/lib/social-personas/server/http";

export const runtime = "nodejs";

// GET /api/social-personas/oauth/<platform>/start?persona=<id>[&posting=1]
// Sends the browser to the platform's login. The nonce cookie ties the
// callback back to this browser. `posting=1` also asks for the scopes that let
// Personas Studio post for the account (auto-post).
export async function GET(req: Request, { params }: { params: Promise<{ platform: string }> }) {
  const platform = asPlatform((await params).platform);
  if (!platform) return fail(404, "Unknown platform.");
  const q = new URL(req.url).searchParams;
  const persona = (q.get("persona") ?? "").slice(0, 64);
  const posting = q.get("posting") === "1";
  const replace = (q.get("replace") ?? "").replace(/[^a-z0-9_]/gi, "").slice(0, 64);
  if (!isConfigured(platform)) {
    return NextResponse.redirect(`${publicOrigin(req)}/apps/personas-studio?persona=${encodeURIComponent(persona)}&oauthError=${encodeURIComponent("not-configured:" + platform)}`);
  }
  const nonce = crypto.randomUUID();
  const state = Buffer.from(JSON.stringify({ persona, nonce, platform, posting, replace })).toString("base64url");
  const res = NextResponse.redirect(authorizeUrl(platform, publicOrigin(req), state, posting));
  res.cookies.set("sp_oauth", nonce, { httpOnly: true, sameSite: "lax", secure: true, path: "/", maxAge: 600 });
  return res;
}
