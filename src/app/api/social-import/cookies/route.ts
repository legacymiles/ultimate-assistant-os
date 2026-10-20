import { NextResponse } from "next/server";
import { checkSession } from "@/lib/social-import/cookiesTxt";
import { clearCookies, cookieStatus, isCookieSite, saveCookies } from "@/lib/social-import/cookieStore";

// The signed-in sessions video imports use for Facebook and Instagram.
//
//   GET     → [{ site, connected, fromEnv, updatedAt, via }] — never the cookies
//   POST    { site, cookies } — a pasted cookies.txt / JSON export / Cookie header
//   DELETE  ?site=facebook
//
// Owner-only: middleware keeps every /api route that isn't listed as public or
// token-authenticated behind the owner's session. The Record extension sends
// cookies to ./push instead, with its own token.

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json({ sites: await cookieStatus() }, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as { site?: string; cookies?: unknown };
  const site = String(body.site ?? "");
  if (!isCookieSite(site)) return NextResponse.json({ error: "Pick Facebook or Instagram." }, { status: 400 });
  const checked = checkSession(body.cookies, site);
  if (!checked.ok) return NextResponse.json({ error: checked.error }, { status: 422 });
  const ok = await saveCookies(site, checked.cookies, checked.count, "paste");
  if (!ok) return NextResponse.json({ error: "Couldn't save that. On the live site this needs SUPABASE_SERVICE_ROLE_KEY." }, { status: 500 });
  return NextResponse.json({ ok: true, sites: await cookieStatus() });
}

export async function DELETE(req: Request) {
  const site = new URL(req.url).searchParams.get("site") ?? "";
  if (!isCookieSite(site)) return NextResponse.json({ error: "Pick Facebook or Instagram." }, { status: 400 });
  await clearCookies(site);
  return NextResponse.json({ ok: true, sites: await cookieStatus() });
}
