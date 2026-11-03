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
 * The ready-made Camera Autopilot Shortcut, as a file.
 *
 * Public on purpose, and only this one path — not the folder, which also holds
 * the owner's Expert Advisors. Behind the sign-in wall the file is close to
 * useless: a phone that has not signed in gets the login page saved under a
 * .shortcut name, and the import fails with nothing on screen to explain it.
 *
 * It carries no secret. The box its import question fills ships empty, and
 * every URL in it stops at `?key=` with a variable chip, so whoever installs
 * it supplies their own key. `scripts/check-shortcut-link.mjs` is what proves
 * that, and it has to pass before this file is ever replaced.
 */
export const SHORTCUT_FILE = "/downloads/send-to-jarvis.shortcut";

const PUBLIC_PREFIXES = [PUBLIC_HOME, "/api/fno", ...CLIENT_REVIEW_PUBLIC, LEGAL_PAGES];

/**
 * Public as exact paths, with nothing underneath them.
 *
 * A single file does not belong in the prefix list: a prefix also opens
 * everything that merely starts with it, so `…/send-to-jarvis.shortcut/..`
 * plus a neighbouring filename would read as public. Next normalises `..` out
 * of a path before middleware sees it, which is the only reason that is not a
 * hole today — not a thing to build on.
 */
const PUBLIC_EXACT = [ERROR_SCRIPT, SHORTCUT_FILE];
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
