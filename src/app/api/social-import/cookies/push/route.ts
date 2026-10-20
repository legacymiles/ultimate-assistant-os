import { NextResponse } from "next/server";
import { cors, extensionUid, preflight, unauthorized } from "@/lib/jarvis/record/http";
import { checkSession } from "@/lib/social-import/cookiesTxt";
import { isCookieSite, saveCookies } from "@/lib/social-import/cookieStore";

// POST /api/social-import/cookies/push   { site, cookies: chrome.cookies[] }
//
// The Jarvis Record extension's "Connect Facebook & Instagram" button. It reads
// the session the owner is already signed into in Chrome and sends it here, so
// video imports from login-only posts just work — no exporting, no pasting, no
// redeploy. Token-authenticated like the extension's other routes (the token is
// minted only by the signed-in owner), and listed in middleware's
// TOKEN_AUTH_PATHS.

export const runtime = "nodejs";

export function OPTIONS() {
  return preflight();
}

export async function POST(req: Request) {
  const uid = await extensionUid(req);
  if (!uid) return cors(unauthorized());
  const body = (await req.json().catch(() => ({}))) as { site?: string; cookies?: unknown };
  const site = String(body.site ?? "");
  if (!isCookieSite(site)) return cors(NextResponse.json({ error: "Unknown site." }, { status: 400 }));
  const checked = checkSession(body.cookies, site);
  if (!checked.ok) return cors(NextResponse.json({ error: checked.error }, { status: 422 }));
  const ok = await saveCookies(site, checked.cookies, checked.count, "extension");
  if (!ok) return cors(NextResponse.json({ error: "Couldn't save on the hub." }, { status: 500 }));
  return cors(NextResponse.json({ ok: true, count: checked.count }));
}
