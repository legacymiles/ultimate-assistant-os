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
export const CLIENT_REVIEW_PUBLIC = [
  // The one Client Review page. Clients and the owner share it; the page asks
  // /api/client-review/portal/me who is looking and keeps the Admin tab locked
  // for everyone but the owner. The admin API below stays owner-only here.
  "/apps/client-review",
  "/review",
  "/api/client-review/portal",
  "/client-review-sw.js",
];

/** The crash reporter client sites load. A static script with no data in it. */
export const ERROR_SCRIPT = "/jarvis-errors.js";

/**
 * Privacy policy, terms and data-deletion pages. TikTok and Meta require
 * these to be publicly reachable before they'll approve a developer app.
 * Static text with no data in it.
 */
export const LEGAL_PAGES = "/legal";

/**
 * AI Rankings is a public leaderboard the owner curates. Only the page and the
 * board route open up: the board route checks the owner itself before any
 * write, and the analyzer and classify routes stay owner-only because each
 * call spends the owner's AI credits.
 */
export const AI_RANKINGS_PUBLIC = ["/apps/ai-rankings", "/api/ai-rankings/board"];

const PUBLIC_PREFIXES = [
  PUBLIC_HOME,
  "/api/fno",
  ...CLIENT_REVIEW_PUBLIC,
  LEGAL_PAGES,
  ...AI_RANKINGS_PUBLIC,
];

/**
 * Public as exact paths, with nothing underneath them.
 *
 * A single file does not belong in the prefix list: a prefix also opens
 * everything that merely starts with it, so the file's own path plus `..` and
 * a neighbouring filename would read as public. Next normalises `..` out of a
 * path before middleware sees it, which is the only reason that was never a
 * hole — not a thing to build on.
 */
/**
 * Home-screen manifests. Chrome fetches a manifest without the session cookie,
 * so a gated one redirects to /login and the app will not install. They hold a
 * name, colours and an icon path, nothing else.
 */
export const MANIFESTS_PUBLIC = ["/apps/baby-no-scroll/manifest.webmanifest"];

const PUBLIC_EXACT = [ERROR_SCRIPT, ...MANIFESTS_PUBLIC];
const AUTH_PREFIXES = ["/login", "/auth"];

function underPrefix(path: string, prefix: string): boolean {
  return path === prefix || path.startsWith(prefix + "/");
}

export function routeAccess(path: string, tokenPaths: ReadonlySet<string>): RouteAccess {
  if (tokenPaths.has(path)) return "token";
  if (PUBLIC_EXACT.includes(path)) return "public";
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
