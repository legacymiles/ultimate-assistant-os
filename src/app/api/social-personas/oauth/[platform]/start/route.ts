import { NextResponse } from "next/server";
import { authorizeUrl, isConfigured } from "@/lib/social-personas/server/connectors";
import { asPlatform, fail, publicOrigin } from "@/lib/social-personas/server/http";

export const runtime = "nodejs";

// GET /api/social-personas/oauth/<platform>/start?persona=<id>
// Sends the browser to the platform's login. The nonce cookie ties the
// callback back to this browser.
export async function GET(req: Request, { params }: { params: Promise<{ platform: string }> }) {
  const platform = asPlatform((await params).platform);
  if (!platform) return fail(404, "Unknown platform.");
  const persona = new URL(req.url).searchParams.get("persona") ?? "";
  if (!isConfigured(platform)) {
    return NextResponse.redirect(`${publicOrigin(req)}/apps/social-personas?persona=${encodeURIComponent(persona)}&oauthError=${encodeURIComponent("not-configured:" + platform)}`);
  }
  const nonce = crypto.randomUUID();
  const state = Buffer.from(JSON.stringify({ persona, nonce, platform })).toString("base64url");
  const res = NextResponse.redirect(authorizeUrl(platform, publicOrigin(req), state));
  res.cookies.set("sp_oauth", nonce, { httpOnly: true, sameSite: "lax", secure: true, path: "/", maxAge: 600 });
  return res;
}
