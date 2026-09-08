// ---------------------------------------------------------------------------
// Per-app password gates.
//
// Some apps in this hub are private workspaces holding the owner's real data.
// A gate keeps a visitor from browsing into one. Each gate is opt-in: with no
// password configured the app stays open, so local dev works out of the box.
//
// These gates read their password from an env var, so they are enforced here in
// edge middleware. Dashboard is NOT in this list: its password lives in a
// writable store so it can be changed in-app, which needs the Node runtime, so
// it gates itself in src/app/apps/dashboard/page.tsx instead.
//
// What a gate IS: a door on the route, enforced in middleware before the page
// renders. What it is NOT: encryption. The app's data still lives in the
// browser's own storage and anyone holding an unlocked device can read it with
// devtools. Nothing here encrypts anything.
// ---------------------------------------------------------------------------

export interface AppGate {
  /** Route prefix the gate protects. */
  prefix: string;
  /** Cookie holding the hashed password. */
  cookie: string;
  /** Where to send someone who is not through the gate yet. */
  unlockPath: string;
  /** Env var holding the password; empty/unset leaves the app open. */
  password: string;
  /** Shown on the unlock screen. */
  label: string;
}

export const APP_GATES: AppGate[] = [
  {
    prefix: "/apps/projects-timeline",
    cookie: "timeline_auth",
    unlockPath: "/timeline-unlock",
    password: process.env.TIMELINE_PASSWORD ?? "",
    label: "Projects Timeline",
  },
];

export function gateForPath(path: string): AppGate | undefined {
  return APP_GATES.find((g) => path.startsWith(g.prefix));
}

export function gateByCookie(cookie: string): AppGate | undefined {
  return APP_GATES.find((g) => g.cookie === cookie);
}

/**
 * Hash used both for the cookie value and the expected check.
 * Edge-runtime safe (Web Crypto only). Versioned so sessions can be
 * invalidated later by bumping the prefix.
 */
export async function gateHash(password: string): Promise<string> {
  const data = new TextEncoder().encode(`v1:${password}`);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/** Comparison that does not leak how much of the value matched. */
export function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let mismatch = 0;
  for (let i = 0; i < a.length; i++) mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return mismatch === 0;
}
