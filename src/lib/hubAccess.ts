// ---------------------------------------------------------------------------
// Who may reach which path.
//
// The hub used to let ANY signed-in Supabase user through, which was fine while
// the owner was the only account. Friends Night Out is now a public app with
// open sign-up, so a stranger's account must reach FNO and nothing else.
//
// Fail-closed: with HUB_OWNER_EMAILS unset nobody is the owner, so a missing env
// var locks the private apps rather than opening them to every sign-up.
// ---------------------------------------------------------------------------

export type RouteAccess = "public" | "token" | "auth" | "owner";

/** Where a signed-in non-owner is sent. */
export const PUBLIC_HOME = "/apps/friends-night-out";

/**
 * Client Review is the other surface a non-owner reaches: a client opens their
 * private link and signs in with their own Jarvis (Google) account. The route
 * itself (src/app/api/client-review/portal) requires that sign-in and checks
 * the account is the one that claimed the link; the owner's console stays
 * behind the owner gate at /api/client-review/admin.
 */
export const CLIENT_REVIEW_PUBLIC = ["/review", "/api/client-review/portal", "/client-review-sw.js"];

const PUBLIC_PREFIXES = [PUBLIC_HOME, "/api/fno", ...CLIENT_REVIEW_PUBLIC];
const AUTH_PREFIXES = ["/login", "/auth"];

function underPrefix(path: string, prefix: string): boolean {
  return path === prefix || path.startsWith(prefix + "/");
}

export function routeAccess(path: string, tokenPaths: ReadonlySet<string>): RouteAccess {
  if (tokenPaths.has(path)) return "token";
  if (PUBLIC_PREFIXES.some((p) => underPrefix(path, p))) return "public";
  if (AUTH_PREFIXES.some((p) => underPrefix(path, p))) return "auth";
  return "owner";
}

export function parseOwnerEmails(raw: string | undefined): string[] {
  return (raw ?? "")
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
}

export function isOwner(email: string | undefined | null, owners: readonly string[]): boolean {
  if (!email) return false;
  return owners.includes(email.trim().toLowerCase());
}
