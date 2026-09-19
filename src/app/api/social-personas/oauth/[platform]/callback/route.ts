import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { exchangeCode, saveConnection } from "@/lib/social-personas/server/connectors";
import { asPlatform, fail, publicOrigin, viewerUid } from "@/lib/social-personas/server/http";

export const runtime = "nodejs";

// GET /api/social-personas/oauth/<platform>/callback?code&state
// Swaps the code for a token, stores it server-side, and sends the browser back
// to the persona with the new connection id; the page then runs the first sync.
export async function GET(req: Request, { params }: { params: Promise<{ platform: string }> }) {
  const platform = asPlatform((await params).platform);
  if (!platform) return fail(404, "Unknown platform.");
  const url = new URL(req.url);
  const origin = publicOrigin(req);

  let state: { persona?: string; nonce?: string; platform?: string } = {};
  try {
    state = JSON.parse(Buffer.from(url.searchParams.get("state") ?? "", "base64url").toString("utf8"));
  } catch {
    /* handled below */
  }
  const back = (q: Record<string, string>) =>
    NextResponse.redirect(`${origin}/apps/social-personas?${new URLSearchParams({ persona: state.persona ?? "", ...q })}`);

  const denied = url.searchParams.get("error_description") || url.searchParams.get("error");
  if (denied) return back({ oauthError: denied });

  const jar = await cookies();
  if (!state.nonce || state.nonce !== jar.get("sp_oauth")?.value || state.platform !== platform) {
    return back({ oauthError: "The login link expired or came from another browser. Try Connect again." });
  }
  const code = url.searchParams.get("code");
  if (!code) return back({ oauthError: "The platform didn't send a login code." });

  try {
    const got = await exchangeCode(platform, code, origin);
    const id = "c" + crypto.randomUUID().replace(/-/g, "");
    const saved = await saveConnection({ ...got, id, ownerUid: await viewerUid(), createdAt: new Date().toISOString() });
    if (!saved) return back({ oauthError: "Connected, but the server couldn't store the login. Set SUPABASE_SERVICE_ROLE_KEY." });
    const res = back({ connected: id, platform });
    res.cookies.set("sp_oauth", "", { path: "/", maxAge: 0 });
    return res;
  } catch (err) {
    console.error("[social-personas] oauth callback failed:", err);
    return back({ oauthError: (err as Error).message.slice(0, 300) });
  }
}
