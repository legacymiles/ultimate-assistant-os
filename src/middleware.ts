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
  if (!user && !isAuthRoute) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    return NextResponse.redirect(url);
  }
  if (user && path.startsWith("/login")) {
    const url = request.nextUrl.clone();
    url.pathname = "/";
    return NextResponse.redirect(url);
  }
  return response;
}

export const config = {
  // Run on app routes; skip static assets and the API.
  matcher: ["/((?!_next/static|_next/image|favicon.ico|api|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)"],
};
