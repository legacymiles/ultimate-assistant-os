import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { APP_GATES, constantTimeEqual, gateHash } from "@/lib/appGate";

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
  // The iPhone Shortcut that pushes photos has no Supabase session and never
  // will — it is the Shortcuts app, not a browser. It presents a per-user
  // device token instead, which the route verifies against a stored hash.
  //
  // This is the ONLY session-exempt API path, and it is exempt by exact match,
  // not by prefix: /api/dashboard/inbox (list) and .../claim and .../token all
  // stay behind the session gate, because those read or mint secrets.
  if (path === "/api/dashboard/inbox/push") return NextResponse.next();

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

  const isAuthRoute = path.startsWith("/login") || path.startsWith("/auth");
  const isApi = path.startsWith("/api");

  if (!user && !isAuthRoute) {
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
  if (user && path.startsWith("/login")) {
    const url = request.nextUrl.clone();
    url.pathname = "/";
    return setUidCookie(NextResponse.redirect(url), user.id);
  }
  return setUidCookie(response, user?.id ?? null);
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
