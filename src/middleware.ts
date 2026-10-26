import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { APP_GATES, constantTimeEqual, gateHash } from "@/lib/appGate";
import { PUBLIC_HOME, isOwner, parseOwnerEmails, routeAccess } from "@/lib/hubAccess";

/** Emails allowed into the private hub. Unset = nobody (fail-closed). */
const OWNER_EMAILS = parseOwnerEmails(process.env.HUB_OWNER_EMAILS);

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";
const supabaseConfigured = Boolean(SUPABASE_URL && SUPABASE_ANON_KEY);

/**
 * Re-exported for the existing /api/timeline-unlock route, which imported it
 * from here before the gate logic moved to lib/appGate.
 */
export { gateHash as timelineHash };

/**
 * Name of the cookie carrying the signed-in account id to the browser.
 *
 * The client needs to know WHICH account it is rendering for before it reads
 * localStorage, and it needs to know synchronously — the stores read during
 * render, and awaiting supabase.auth.getUser() would let one frame paint the
 * previous account's data. Middleware has already resolved the user here, so
 * it hands the answer over in a readable cookie. See lib/sync/identity.ts.
 *
 * Deliberately NOT httpOnly: client code must read it. That is safe because
 * the id is not a credential — the browser can already ask Supabase for it —
 * and the session tokens stay httpOnly.
 */
const UID_COOKIE = "hub_uid";

/** API paths authenticated by a per-user token instead of a session. Exact matches only. */
const TOKEN_AUTH_PATHS = new Set([
  // Crash reports: public append-only ingest (client sites have no session),
  // and the bearer-token feed super-board reads. Both verify in the route.
  "/api/site-errors/report",
  "/api/site-errors/feed",
  // Contradicting's recorder webhook (the Omi pendant/app has no session).
  // The per-account key in the URL is checked in the route.
  "/api/contradicting/omi",
  // Find My Life's background ping (iPhone Shortcuts has no session). The
  // per-account key in the URL is checked in the route.
  "/api/find-my-life/ping",
  // iPhone Notes' Shortcut ("Notes to Jarvis") has no session either. The
  // per-account key in the URL is checked in the route; it only stores notes,
  // and nothing it stores runs without the owner's Approve.
  "/api/iphone-notes/push",
  // Personas Studio's scheduler tick (GitHub Actions). Only sends posts their
  // owners already scheduled, behind a per-job lock; optional bearer token.
  "/api/social-personas/publish/tick",
  "/api/dashboard/inbox/push",
  "/api/dashboard/inbox/cursor",
  "/api/dashboard/inbox/present",
  "/api/game-creator/builder/claim",
  "/api/game-creator/builder/progress",
  "/api/game-creator/builder/screenshot",
  "/api/game-creator/builder/fail",
  "/api/game-creator/builder/messages",
  "/api/studio3d/builder/claim",
  "/api/studio3d/builder/progress",
  "/api/studio3d/builder/media",
  "/api/studio3d/builder/fail",
  "/api/video-studio/runner/claim",
  "/api/video-studio/runner/progress",
  "/api/video-studio/runner/clip",
  "/api/video-studio/runner/fail",
  "/api/mp3-download/runner/claim",
  "/api/mp3-download/runner/result",
  "/api/mp3-download/runner/fail",
  // The Record browser extension. It runs inside other people's websites, so
  // it has no session here and is authenticated by its own token instead.
  "/api/jarvis/record/capture/push",
  "/api/jarvis/record/snapshot/pull",
  "/api/jarvis/record/map",
  // The same extension's "Connect Facebook & Instagram" button — sends the
  // signed-in session that video imports use. Verifies the token in the route.
  "/api/social-import/cookies/push",
  // Shared memory over MCP. Claude Code on the PC and the VPS, and a
  // claude.ai connector, are not browsers and have no session here. The route
  // verifies JARVIS_MCP_TOKEN itself and is pinned to one account id read
  // from the environment, so the session gate has nothing to add — it only
  // turned every client's first call into "Sign in to use this endpoint."
  "/api/jarvis/memory/mcp",
  // The skill store for scripts/skill-sync.mjs on the PC and VPS — same token
  // and same pinned account as the memory MCP above, verified in the route.
  "/api/jarvis/skills",
  // Skill call counts from the same script's Claude Code hook — same token and
  // pinned account, verified in the route.
  "/api/jarvis/skills/usage",
  // A picture attached to an In Queue request, fetched by the Claude Code
  // session working it — same token and pinned account as the memory MCP.
  "/api/new-jarvis/requests/image",
  // The finished video for a request, sent back by that same session.
  "/api/new-jarvis/requests/video",
]);

/** Stamp (or clear) the account id the browser is allowed to render as. */
function setUidCookie(response: NextResponse, userId: string | null): NextResponse {
  if (userId) {
    response.cookies.set(UID_COOKIE, userId, {
      httpOnly: false,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
    });
  } else {
    response.cookies.set(UID_COOKIE, "", { path: "/", maxAge: 0 });
  }
  return response;
}

export async function middleware(request: NextRequest) {
  const path = request.nextUrl.pathname;

  // ----- Per-app private-workspace gates ----------------------------------
  // Only enforced for apps that have a password configured. Without one the
  // app stays open, so local dev works with no setup.
  for (const gate of APP_GATES) {
    if (!gate.password || !path.startsWith(gate.prefix)) continue;
    const cookie = request.cookies.get(gate.cookie)?.value ?? "";
    const expected = await gateHash(gate.password);
    if (!cookie || !constantTimeEqual(cookie, expected)) {
      const url = request.nextUrl.clone();
      url.pathname = gate.unlockPath;
      url.searchParams.set("next", path);
      return NextResponse.redirect(url);
    }
    break;
  }

  // ----- Token-authenticated ingest ---------------------------------------
  // Two callers have no Supabase session and never will, because they are not
  // browsers: the iPhone Shortcut that pushes photos, and the Game Creator
  // builder running on the owner's PC. Each presents a per-user token, which
  // its route verifies against a stored hash before touching anything.
  //
  // These are the ONLY session-exempt API paths, exempt by exact match, never
  // by prefix: /api/dashboard/inbox (list), .../claim, .../token, and every
  // /api/game-creator route outside builder/* stay behind the session gate,
  // because those read owner data or mint the tokens themselves.
  const access = routeAccess(path, TOKEN_AUTH_PATHS);
  if (access === "token") return NextResponse.next();

  // ----- Supabase session refresh + login gate ----------------------------
  if (!supabaseConfigured) return NextResponse.next();

  let response = NextResponse.next({ request });
  const supabase = createServerClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet: { name: string; value: string; options?: Record<string, unknown> }[]) {
        cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
        response = NextResponse.next({ request });
        cookiesToSet.forEach(({ name, value, options }) =>
          response.cookies.set(name, value, options),
        );
      },
    },
  });

  const {
    data: { user },
  } = await supabase.auth.getUser();
  const owner = isOwner(user?.email, OWNER_EMAILS);
  const isApi = path.startsWith("/api");

  // Friends Night Out is public: anyone may browse, signed in or not. The
  // session is still refreshed so a signed-in visitor stays signed in.
  if (access === "public") return setUidCookie(response, user?.id ?? null);

  if (access === "auth") {
    if (user && path.startsWith("/login")) {
      const url = request.nextUrl.clone();
      url.pathname = owner ? "/" : PUBLIC_HOME;
      return setUidCookie(NextResponse.redirect(url), user.id);
    }
    return setUidCookie(response, user?.id ?? null);
  }

  // ----- Owner-only: the rest of the hub ---------------------------------
  if (!user) {
    // An API call gets a status it can act on. Redirecting it to /login would
    // hand fetch() a 200 and a page of HTML, which every caller here would try
    // to parse as JSON and report as a confusing failure.
    if (isApi) {
      return setUidCookie(
        NextResponse.json({ error: "Sign in to use this endpoint." }, { status: 401 }),
        null,
      );
    }
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    return setUidCookie(NextResponse.redirect(url), null);
  }
  if (!owner) {
    // A Friends Night Out member (or anyone who signed up) is not the owner.
    // They get FNO and nothing else — never Tap Safe, Dashboard, the AI proxy.
    if (isApi) {
      return setUidCookie(
        NextResponse.json({ error: "This endpoint is private." }, { status: 403 }),
        user.id,
      );
    }
    const url = request.nextUrl.clone();
    url.pathname = PUBLIC_HOME;
    url.search = "";
    return setUidCookie(NextResponse.redirect(url), user.id);
  }
  return setUidCookie(response, user.id);
}

export const config = {
  // Run on app routes AND on /api. The API used to be excluded, which left
  // every route handler reachable with no session at all — including
  // /api/skills/scan, which reads the host's ~/.claude and would hand a
  // stranger the owner's personal skill prompts. The AI proxy routes were
  // likewise free for anyone to spend the owner's gateway credits on.
  //
  // Still skipped: static assets, which carry no data and would only add a
  // Supabase round trip to every image request.
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)"],
};
