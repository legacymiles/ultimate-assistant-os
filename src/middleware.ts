import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";
const supabaseConfigured = Boolean(SUPABASE_URL && SUPABASE_ANON_KEY);

const TIMELINE_PASSWORD = process.env.TIMELINE_PASSWORD ?? "";
const TIMELINE_PROTECTED_PREFIX = "/apps/projects-timeline";
const TIMELINE_COOKIE = "timeline_auth";

// Hash used both for the cookie value and the expected check. Edge-runtime
// safe (Web Crypto only). Versioned so we can invalidate sessions later.
export async function timelineHash(password: string): Promise<string> {
  const data = new TextEncoder().encode(`v1:${password}`);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let mismatch = 0;
  for (let i = 0; i < a.length; i++) mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return mismatch === 0;
}

export async function middleware(request: NextRequest) {
  const path = request.nextUrl.pathname;

  // ----- Timeline private-workspace gate ----------------------------------
  // Only enforced when TIMELINE_PASSWORD is configured. Without it, the app
  // stays open (so local dev works out of the box).
  if (TIMELINE_PASSWORD && path.startsWith(TIMELINE_PROTECTED_PREFIX)) {
    const cookie = request.cookies.get(TIMELINE_COOKIE)?.value ?? "";
    const expected = await timelineHash(TIMELINE_PASSWORD);
    if (!cookie || !constantTimeEqual(cookie, expected)) {
      const url = request.nextUrl.clone();
      url.pathname = "/timeline-unlock";
      url.searchParams.set("next", path);
      return NextResponse.redirect(url);
    }
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
