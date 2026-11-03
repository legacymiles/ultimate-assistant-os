// ---------------------------------------------------------------------------
// The ready-made "Send to Jarvis" Shortcut.
//
// Setting the phone up by hand is an eight-block build in Apple's Shortcuts
// app, and every block is somewhere to get it wrong: a typed word where a blue
// variable chip belongs, the sending link pasted into the clean-up action, a
// File field left as Text. Every one of those has actually happened. A
// Shortcut built once and shared removes the whole class of mistake — iOS asks
// the installer a single question on import, they paste one key, and all three
// URL actions fill themselves in from it.
//
// The link lives in the repo rather than in an env var because it is a plain
// iCloud address with no secret in it, and because pasting it here is then the
// entire setup: no dashboard visit, no redeploy dance. The env var still wins
// when it is set, so a replacement Shortcut can be tried before it is
// committed.
// ---------------------------------------------------------------------------

import { SHORTCUT_FILE } from "@/lib/hubAccess";

/**
 * Paste the shared Shortcut's iCloud link here.
 *
 * It has to be a Shortcut whose key sits in ONE empty Text action at the very
 * top with an import question attached, and whose three URL actions end in
 * `?key=` followed by that action's variable. A key typed into the Shortcut
 * instead is handed to everyone who installs it, so before pasting a link
 * here, run it past the thing that checks:
 *
 *     node scripts/check-shortcut-link.mjs <link>
 *
 * Empty is a supported state: the guide then teaches the manual build, which
 * is what every user got before this existed.
 */
const SHARED_SHORTCUT = "";

export const SHORTCUT_LINK = process.env.NEXT_PUBLIC_IPHONE_SHORTCUT_URL || SHARED_SHORTCUT;

/**
 * Only an iCloud Shortcuts link can be installed by tapping it. Anything else
 * — a typo, a shortened link, a Drive file — renders as a button that opens a
 * dead end, so the guide checks before offering it and teaches the manual
 * build instead.
 */
export function isShortcutLink(url: string): boolean {
  let u: URL;
  try {
    u = new URL(url.trim());
  } catch {
    return false;
  }
  if (u.protocol !== "https:") return false;
  const host = u.hostname.toLowerCase();
  if (host !== "icloud.com" && !host.endsWith(".icloud.com")) return false;
  // `/shortcuts/<32 hex>`; the id is what Apple signs, and a link without one
  // opens the Shortcuts marketing page rather than an installable Shortcut.
  return /^\/shortcuts\/[0-9a-f]{8,}\/?$/i.test(u.pathname);
}

/** Is there a signed Shortcut to hand out? Installing one is two taps. */
export const READY_MADE = isShortcutLink(SHORTCUT_LINK);

/**
 * The same Shortcut as a file, served straight off this site.
 *
 * Apple signs a Shortcut when it is shared from a phone, and only a signed one
 * installs by tapping a link. A file cannot be signed from here, so importing
 * this one costs the user a switch — Settings › Shortcuts › Advanced › Allow
 * Untrusted Shortcuts — which is why it is the second choice and not the
 * first. It is still far ahead of building eight blocks by hand, and it is the
 * only route that exists before anyone has shared a link.
 *
 * Its path comes from the sign-in wall rather than being written again here:
 * the file has to be reachable without an account, and a second spelling of it
 * would be the one that is still gated.
 */
export { SHORTCUT_FILE };

/**
 * Either route means nobody has to build the thing, which is what decides how
 * the guide reads: one key instead of three links, and the hand-build folded
 * away rather than laid out as the way to do it.
 */
export const SKIP_BUILD = READY_MADE || Boolean(SHORTCUT_FILE);
