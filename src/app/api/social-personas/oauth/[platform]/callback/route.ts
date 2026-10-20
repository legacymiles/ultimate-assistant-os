import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { config, deleteConnection, exchangeCode, loadConnection, saveConnection } from "@/lib/social-personas/server/connectors";
import { asPlatform, fail, publicOrigin, viewerUid } from "@/lib/social-personas/server/http";

export const runtime = "nodejs";

interface State {
  persona?: string;
  nonce?: string;
  platform?: string;
  posting?: boolean;
  inbox?: boolean;
  replace?: string;
  postingRefused?: boolean;
  inboxRefused?: boolean;
  tab?: string;
}

// GET /api/social-personas/oauth/<platform>/callback?code&state
// Swaps the code for a token, stores it server-side, and sends the browser back
// to the persona with the new connection id; the page then runs the first sync.
export async function GET(req: Request, { params }: { params: Promise<{ platform: string }> }) {
  const platform = asPlatform((await params).platform);
  if (!platform) return fail(404, "Unknown platform.");
  const url = new URL(req.url);
  const origin = publicOrigin(req);

  let state: State = {};
  try {
    state = JSON.parse(Buffer.from(url.searchParams.get("state") ?? "", "base64url").toString("utf8"));
  } catch {
    /* handled below */
  }
  const back = (q: Record<string, string>) =>
    NextResponse.redirect(`${origin}/apps/personas-studio?${new URLSearchParams({ persona: state.persona ?? "", ...(state.tab ? { tab: state.tab } : {}), ...q })}`);

  const denied = url.searchParams.get("error_description") || url.searchParams.get("error");
  if (denied) {
    // Connect asks for syncing, posting and the inbox in one login. If the
    // platform refuses only because a permission isn't switched on for the
    // developer app yet, quietly retry without it — inbox first, then posting —
    // so the person still gets connected, and the account shows what's waiting.
    const cancelled = /access_denied|user_denied|cancel/i.test(url.searchParams.get("error") ?? "") && !/scope/i.test(denied);
    const scopeProblem = !cancelled && /scope|permission|invalid_request|unauthori/i.test(denied);
    if (scopeProblem && (state.inbox || state.posting)) {
      const dropInbox = Boolean(state.inbox);
      const retry = new URLSearchParams({
        persona: state.persona ?? "",
        ...(state.replace ? { replace: state.replace } : {}),
        ...(state.tab ? { tab: state.tab } : {}),
        ...(dropInbox || state.inboxRefused ? { inboxRefused: "1" } : {}),
        ...(!dropInbox || state.postingRefused ? { postingRefused: "1" } : {}),
        ...(state.posting === false && !state.postingRefused ? { posting: "0" } : {}),
      });
      return NextResponse.redirect(`${origin}/api/social-personas/oauth/${platform}/start?${retry}`);
    }
    if (cancelled) return back({ oauthError: "Connect was cancelled — nothing changed." });
    return back({ oauthError: denied });
  }

  const jar = await cookies();
  if (!state.nonce || state.nonce !== jar.get("sp_oauth")?.value || state.platform !== platform) {
    return back({ oauthError: "The login link expired or came from another browser. Try Connect again." });
  }
  const code = url.searchParams.get("code");
  if (!code) return back({ oauthError: "The platform didn't send a login code." });

  try {
    const got = await exchangeCode(platform, code, origin);
    const id = "c" + crypto.randomUUID().replace(/-/g, "");
    const uid = await viewerUid();
    // A part is on only if it was asked for AND (where the platform says which
    // scopes it granted) the person didn't untick it.
    const granted = (scopes: string) => {
      const first = scopes.split(",")[0];
      return !first || !got.scopes || got.scopes.split(",").includes(first) || got.scopes.includes(first);
    };
    const canPost = Boolean(state.posting) && granted(config(platform).postScopes);
    const canInbox = Boolean(state.inbox) && granted(config(platform).inboxScopes);
    const saved = await saveConnection({ ...got, id, ownerUid: uid, canPost, canInbox, createdAt: new Date().toISOString() });
    if (!saved) return back({ oauthError: "Connected, but the server couldn't store the login. Set SUPABASE_SERVICE_ROLE_KEY." });
    // Reconnecting (for auto-post or the inbox) makes a fresh login; the old
    // one is retired so a stale token never lingers on the server.
    if (state.replace) {
      const old = await loadConnection(state.replace);
      if (old && old.ownerUid === uid) await deleteConnection(old.id);
    }
    const res = back({
      connected: id,
      platform,
      ...(state.replace ? { replaced: state.replace } : {}),
      ...(canPost ? { posting: "1" } : {}),
      ...(canInbox ? { inbox: "1" } : {}),
      ...(state.postingRefused ? { postingRefused: "1" } : {}),
      ...(state.inboxRefused ? { inboxRefused: "1" } : {}),
    });
    res.cookies.set("sp_oauth", "", { path: "/", maxAge: 0 });
    return res;
  } catch (err) {
    console.error("[social-personas] oauth callback failed:", err);
    return back({ oauthError: (err as Error).message.slice(0, 300) });
  }
}
