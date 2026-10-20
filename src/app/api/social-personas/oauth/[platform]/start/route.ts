import { NextResponse } from "next/server";
import { authorizeUrl, isConfigured } from "@/lib/social-personas/server/connectors";
import { asPlatform, fail, publicOrigin } from "@/lib/social-personas/server/http";
import { canAutoPost, hasInbox } from "@/lib/social-personas/types";

export const runtime = "nodejs";

// GET /api/social-personas/oauth/<platform>/start?persona=<id>
// Sends the browser to the platform's login. The nonce cookie ties the
// callback back to this browser. One login asks for everything the platform
// allows: syncing, auto-post and the Message Inbox. `posting=0` / `inbox=0`
// leave a part out; `postingRefused=1` / `inboxRefused=1` are set by the
// callback when the developer app hasn't switched that permission on yet, so
// the person still gets connected for the rest. `tab=inbox` returns them to
// the Message Inbox instead of the Overview.
export async function GET(req: Request, { params }: { params: Promise<{ platform: string }> }) {
  const platform = asPlatform((await params).platform);
  if (!platform) return fail(404, "Unknown platform.");
  const q = new URLSearchParams(new URL(req.url).search);
  const persona = (q.get("persona") ?? "").slice(0, 64);
  const postingRefused = q.get("postingRefused") === "1";
  const inboxRefused = q.get("inboxRefused") === "1";
  const posting = canAutoPost(platform) && q.get("posting") !== "0" && !postingRefused;
  const inbox = hasInbox(platform) && q.get("inbox") !== "0" && !inboxRefused;
  const replace = (q.get("replace") ?? "").replace(/[^a-z0-9_]/gi, "").slice(0, 64);
  const tab = q.get("tab") === "inbox" ? "inbox" : "";
  if (!(await isConfigured(platform))) {
    const back = new URLSearchParams({ persona, oauthError: "not-configured:" + platform, ...(tab ? { tab } : {}) });
    return NextResponse.redirect(`${publicOrigin(req)}/apps/personas-studio?${back}`);
  }
  const nonce = crypto.randomUUID();
  const state = Buffer.from(JSON.stringify({ persona, nonce, platform, posting, inbox, replace, postingRefused, inboxRefused, tab })).toString("base64url");
  const res = NextResponse.redirect(await authorizeUrl(platform, publicOrigin(req), state, posting, inbox));
  res.cookies.set("sp_oauth", nonce, { httpOnly: true, sameSite: "lax", secure: true, path: "/", maxAge: 600 });
  return res;
}
